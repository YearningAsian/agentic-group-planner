"""CP-SAT engine (design §2.2). It reads only a ScoreTable, maximizes plan_score scaled to integers, and finds
the next-best plans through no-good cuts. Importing this module fails without ortools, and the caller then
falls back to enumeration."""

from __future__ import annotations

import math

from ortools.sat.python import cp_model

from app.models import Params
from app.score_table import (
    Assignment,
    EngineResult,
    EngineUnavailable,
    RankedPlan,
    ScoreTable,
    plan_score,
    rank_key,
)

# Slot values become integers in thousandths, so plans closer than about 0.001 may trade places while
# searching. The found plans are re-ranked by the exact plan_score before they're returned.
SCALE = 1000
# The fairness and split weights multiply integer terms, so they're scaled to integers too.
WEIGHT_SCALE = 1000

BoolTerm = cp_model.IntVar | int  # a decision, or a constant 0 or 1 in a pinned slot


def solve_plans(table: ScoreTable, params: Params) -> EngineResult:
    """The top `params.max_plans` plans by plan_score, best first.

    Each solve gets `time_limit_ms ÷ max_plans`. After each plan, a no-good cut rules out its exact
    assignment and the model is solved again. Status is feasible if any solve ran out of time before
    proving its plan optimal. An invalid model or an unknown status raises EngineUnavailable.
    """
    reasons = list(table.infeasible_reasons)
    plan_model = _PlanModel(table, params)
    if plan_model.impossible:
        return EngineResult("cp_sat", "infeasible", [], reasons)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = params.time_limit_ms / params.max_plans / 1000
    # One worker keeps ties and time-limited runs reproducible; these models are small.
    solver.parameters.num_workers = 1
    found: list[Assignment] = []
    proven = True
    for _ in range(params.max_plans):
        status = solver.solve(plan_model.model)
        if status == cp_model.INFEASIBLE:
            break
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            raise EngineUnavailable(f"CP-SAT returned {solver.status_name(status)}")
        proven = proven and status == cp_model.OPTIMAL
        found.append(plan_model.read(solver))
        plan_model.exclude_current(solver)

    if not found:
        return EngineResult("cp_sat", "infeasible", [], reasons)
    plans = sorted((RankedPlan(a, plan_score(table, a)) for a in found), key=rank_key)
    return EngineResult("cp_sat", "optimal" if proven else "feasible", plans, reasons)


class _PlanModel:
    """The design §2.2 model: x[m,s,c] = member m attends candidate c in slot s, y[s,c] = someone does.

    Constraints: Σc x = 1 per member and open slot; Σc y ≤ max groups (1 when together); Σm x ≥ min group × y;
    x ≤ y. Travel and arrival need both stops of a member, so each consecutive pair gets an AND variable.
    """

    def __init__(self, table: ScoreTable, params: Params) -> None:
        self.table = table
        self.model = cp_model.CpModel()
        self.impossible = False
        self.x: dict[tuple[int, int, int], cp_model.IntVar] = {}
        n = len(table.members)
        # at[s][m][c]: whether m is at c in s, as a variable, or as a constant for pinned slots.
        self.at: list[list[list[BoolTerm]]] = []
        splits: list[cp_model.IntVar] = []
        for s, slot in enumerate(table.slots):
            candidates = range(len(slot.candidates))
            if slot.pinned_members is not None:
                pinned = slot.pinned_members
                self.at.append([[1 if m in pinned and c == 0 else 0 for c in candidates] for m in range(n)])
                continue
            attends: list[list[BoolTerm]] = []
            for m in range(n):
                row: list[BoolTerm] = []
                for c in candidates:
                    if table.allowed[(m, s, c)]:
                        self.x[(m, s, c)] = self.model.new_bool_var(f"x[{m},{s},{c}]")
                        row.append(self.x[(m, s, c)])
                    else:
                        row.append(0)
                attends.append(row)
                self.model.add_exactly_one(v for v in row if not isinstance(v, int))
            used = [self.model.new_bool_var(f"y[{s},{c}]") for c in candidates]
            for c in candidates:
                here = [attends[m][c] for m in range(n) if not isinstance(attends[m][c], int)]
                for v in here:
                    self.model.add_implication(v, used[c])
                self.model.add(sum(here) >= params.min_group_size * used[c])
            split = self.model.new_bool_var(f"split[{s}]")
            self.model.add(sum(used) <= (1 if slot.together else params.max_groups_per_slot))
            self.model.add(sum(used) == 1 + split)
            splits.append(split)
            self.at.append(attends)

        values = [self._member_value(m) for m in range(n)]
        self._budgets()
        if not self.impossible:
            self._objective(values, splits)

    def _member_value(self, m: int) -> tuple[list[cp_model.IntVar], list[int], int]:
        """Member m's summed slot values ×SCALE, as (variables, coefficients, constant)."""
        table, w = self.table, self.table.weights
        variables: list[cp_model.IntVar] = []
        coefficients: list[int] = []
        constant = 0

        def add(literal: BoolTerm, coefficient: int) -> None:
            nonlocal constant
            if isinstance(literal, int):
                constant += coefficient * literal
            elif coefficient:
                variables.append(literal)
                coefficients.append(coefficient)

        for s, slot in enumerate(table.slots):
            for c in range(len(slot.candidates)):
                add(self.at[s][m][c], round(SCALE * table.utility[(m, s, c)]))
            if s == 0 or not self._attends(m, s) or not self._attends(m, s - 1):
                continue
            for p in range(len(table.slots[s - 1].candidates)):
                for c in range(len(slot.candidates)):
                    before, now = self.at[s - 1][m][p], self.at[s][m][c]
                    if _never(before) or _never(now):
                        continue
                    if not table.arrival_ok[(s, p, c)]:
                        self._forbid_both(before, now)
                        continue
                    penalty = round(SCALE * w.travel * table.travel[(s, p, c)])
                    if penalty:
                        add(self._both(before, now), -penalty)
        return variables, coefficients, constant

    def _budgets(self) -> None:
        table = self.table
        for m, budget in enumerate(table.budget):
            if budget is None:
                continue
            variables, prices, fixed = [], [], 0
            for s, slot in enumerate(table.slots):
                for c in range(len(slot.candidates)):
                    literal = self.at[s][m][c]
                    if isinstance(literal, int):
                        fixed += table.price[(s, c)] * literal
                    else:
                        variables.append(literal)
                        prices.append(table.price[(s, c)])
            if fixed > budget:
                self.impossible = True
            elif variables:
                self.model.add(cp_model.LinearExpr.weighted_sum(variables, prices) <= budget - fixed)

    def _objective(
        self, values: list[tuple[list[cp_model.IntVar], list[int], int]], splits: list[cp_model.IntVar]
    ) -> None:
        """Maximize plan_score times a positive constant.

        With q_m = member m's mean slot value, score_m = (q_m + w_c + w_t) ÷ span. Scaling each member's sum
        by L ÷ n_m (L = lcm of the slot counts) gives T_m ≈ SCALE·L·q_m in integers. Then
        plan_score × M·span·SCALE·L = ΣT_m + M·w_f·min T_m − M·span·SCALE·L·split_penalty·splits + a constant.
        """
        table, w = self.table, self.table.weights
        n = len(table.members)
        counts = [sum(1 for s in range(len(table.slots)) if self._attends(m, s)) for m in range(n)]
        lcm = math.lcm(*(c for c in counts if c)) if any(counts) else 1
        span = (w.preference + w.cost + w.travel) or 1.0
        # With a negative span a higher value means a lower score, so flip the sign to keep T_m rising with it.
        sign = 1 if span > 0 else -1

        member_terms = []
        variables: list[cp_model.IntVar] = []
        coefficients: list[int] = []
        low = high = 0
        for m, (member_vars, member_coefficients, constant) in enumerate(values):
            if counts[m] == 0:
                # plan_score gives a member with no slots 0, which is q_m = −(w_c + w_t).
                fixed = sign * round(-(w.cost + w.travel) * SCALE * lcm)
                member_terms.append(fixed)
                low, high = min(low, fixed), max(high, fixed)
                continue
            factor = sign * (lcm // counts[m])
            scaled = [factor * c for c in member_coefficients]
            term = cp_model.LinearExpr.weighted_sum(member_vars, scaled) + factor * constant
            member_terms.append(term)
            low = min(low, factor * constant + sum(c for c in scaled if c < 0))
            high = max(high, factor * constant + sum(c for c in scaled if c > 0))
            variables.extend(member_vars)
            coefficients.extend(WEIGHT_SCALE * c for c in scaled)

        lowest = self.model.new_int_var(low, high, "lowest_member")
        if w.fairness >= 0:
            # The design's z ≤ T_m: maximizing pushes z up to the lowest member. It solves far faster than an
            # exact min, whose presolve can stall on the member sums' value sets.
            for term in member_terms:
                self.model.add(lowest <= term)
        else:
            self.model.add_min_equality(lowest, member_terms)  # z would sink otherwise
        variables.append(lowest)
        coefficients.append(round(WEIGHT_SCALE * n * w.fairness))
        split_cost = round(WEIGHT_SCALE * n * abs(span) * SCALE * lcm * w.split_penalty)
        variables.extend(splits)
        coefficients.extend(-split_cost for _ in splits)
        self.model.maximize(cp_model.LinearExpr.weighted_sum(variables, coefficients))

    def _attends(self, m: int, s: int) -> bool:
        pinned = self.table.slots[s].pinned_members
        return pinned is None or m in pinned

    def _both(self, a: BoolTerm, b: BoolTerm) -> BoolTerm:
        """A literal equal to a AND b."""
        if isinstance(a, int):
            return b if a else 0
        if isinstance(b, int):
            return a if b else 0
        both = self.model.new_bool_var("")
        self.model.add_implication(both, a)
        self.model.add_implication(both, b)
        self.model.add_bool_or([a.Not(), b.Not(), both])
        return both

    def _forbid_both(self, a: BoolTerm, b: BoolTerm) -> None:
        if isinstance(a, int) and isinstance(b, int):
            self.impossible = self.impossible or bool(a and b)
        elif isinstance(a, int):
            if a:
                self.model.add(b == 0)
        elif isinstance(b, int):
            if b:
                self.model.add(a == 0)
        else:
            self.model.add_bool_or([a.Not(), b.Not()])

    def read(self, solver: cp_model.CpSolver) -> Assignment:
        """The assignment in the solver's current solution."""
        rows: list[tuple[int | None, ...]] = []
        for slot_at in self.at:
            row: list[int | None] = []
            for member_at in slot_at:
                chosen = [c for c, v in enumerate(member_at) if (v if isinstance(v, int) else solver.value(v))]
                row.append(chosen[0] if chosen else None)
            rows.append(tuple(row))
        return tuple(rows)

    def exclude_current(self, solver: cp_model.CpSolver) -> None:
        """No-good cut: the next solve must change at least one member's choice somewhere."""
        chosen = [v for v in self.x.values() if solver.value(v)]
        self.model.add_bool_or([v.Not() for v in chosen])


def _never(literal: BoolTerm) -> bool:
    # `literal == 0` on a variable builds a constraint instead of comparing, so check the type first.
    return isinstance(literal, int) and literal == 0
