"""Exhaustive enumeration engine, the fallback when CP-SAT can't answer (design §2.2). It reads only a
ScoreTable and ranks plans by plan_score."""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from app.models import Params
from app.score_table import (
    Assignment,
    EngineResult,
    RankedPlan,
    ScoreTable,
    assignment_key,
    combine,
    member_score,
    plan_score,
    too_large,
)

Choice = tuple[int | None, ...]
# Plans whose scores differ by less than this are ties, and the first one found keeps its place. Without it,
# a table full of identical candidates would defeat the bound and visit every plan.
TIE = 1e-9
NO_BUDGET = np.iinfo(np.int64).max
TIMED_OUT_REASON = "The planner ran out of time before it found a plan"

_clock = time.perf_counter  # swapped in tests


def enumerate_plans(table: ScoreTable, params: Params) -> EngineResult:
    """Every feasible plan ranked by plan_score; the best `params.max_plans` come back, best first.

    Per slot, the choices are each partition of the members into at most `max_groups_per_slot` groups of at
    least `min_group_size`, times each group's candidate, pruned by the allowed mask and by budget. A
    depth-first product across slots checks arrival and running totals, and skips a branch once even its
    best case can't beat the plans kept so far (branch and bound), so the result stays exact.

    It stops at `params.time_limit_ms` as a safety net and returns what it has with status feasible.
    """
    reasons = list(table.infeasible_reasons)
    if too_large(table):
        return EngineResult("enumeration", "too_large", [], reasons)
    search = _Search(table, params, deadline=_clock() + params.time_limit_ms / 1000)
    found = search.run()
    plans = [RankedPlan(assignment, plan_score(table, assignment)) for assignment in found]
    if not plans:
        if search.timed_out:
            reasons.append(TIMED_OUT_REASON)
        return EngineResult("enumeration", "infeasible", [], reasons)
    return EngineResult("enumeration", "feasible" if search.timed_out else "optimal", plans, reasons)


@dataclass(frozen=True)
class _Slot:
    """One slot's choices as arrays, one row per choice and one column per member."""

    choices: list[Choice]
    candidate: npt.NDArray[np.int64]  # −1 where the member isn't in the slot
    utility: npt.NDArray[np.float64]
    price: npt.NDArray[np.int64]
    split: npt.NDArray[np.int64]
    present: npt.NDArray[np.bool_]  # per member
    travel: npt.NDArray[np.float64] | None  # [previous candidate, candidate]; None for the first slot
    arrival_ok: npt.NDArray[np.bool_] | None
    # [member, previous candidate]: the most the member can add here coming from there, or −inf when no
    # choice is reachable in time. The last column is for a member with no previous stop.
    best_from: npt.NDArray[np.float64]


class _Search:
    def __init__(self, table: ScoreTable, params: Params, deadline: float) -> None:
        self.table = table
        self.params = params
        self.deadline = deadline
        self.n = len(table.members)
        self.slots = [self._compile(s) for s in range(len(table.slots))]
        self.slot_counts = np.array(
            [sum(1 for s in table.slots if s.pinned_members is None or m in s.pinned_members) for m in range(self.n)]
        )
        self.budget = np.array([NO_BUDGET if b is None else b for b in table.budget], dtype=np.int64)
        # The bound needs the sign of every term fixed: with a negative weight, a better member score or
        # fewer splits could lower the plan score, so the search visits everything instead.
        self.prune = all(value >= 0 for value in table.weights.model_dump().values())
        self.rest = self._best_remaining()
        self.kept: list[tuple[float, Assignment]] = []
        self.timed_out = False

    def run(self) -> list[Assignment]:
        if all(slot.choices for slot in self.slots):
            start = np.zeros(self.n)
            self._visit(0, start, np.zeros(self.n, dtype=np.int64), np.full(self.n, -1), 0, [])
        return [assignment for _, assignment in self.kept]

    def _visit(
        self,
        s: int,
        values: npt.NDArray[np.float64],
        spent: npt.NDArray[np.int64],
        previous: npt.NDArray[np.int64],
        splits: int,
        path: list[Choice],
    ) -> None:
        """Try every choice for slot s after the path so far, best bound first."""
        if _clock() > self.deadline:
            self.timed_out = True
            return
        slot = self.slots[s]
        next_values, next_spent, next_previous, ok = self._step(s, values, spent, previous)
        next_splits = splits + slot.split
        if self.prune:
            bound = self._bound(s, next_values, next_previous, next_splits)
            candidates = np.flatnonzero(ok & (bound > self._floor()))
            candidates = candidates[np.argsort(-bound[candidates], kind="stable")]
        else:
            candidates = np.flatnonzero(ok)
        last = s == len(self.slots) - 1
        for i in candidates:
            if self.timed_out:
                return
            if self.prune and bound[i] <= self._floor():
                break  # sorted by bound, so nothing after this can do better
            path.append(slot.choices[i])
            if last:
                self._offer(tuple(path), next_values[i], int(next_splits[i]))
            else:
                self._visit(s + 1, next_values[i], next_spent[i], next_previous[i], int(next_splits[i]), path)
            path.pop()

    def _step(
        self, s: int, values: npt.NDArray[np.float64], spent: npt.NDArray[np.int64], previous: npt.NDArray[np.int64]
    ) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.int64], npt.NDArray[np.int64], npt.NDArray[np.bool_]]:
        """Each choice's running values, spend, and positions after slot s, and whether it's still feasible."""
        slot, w = self.slots[s], self.table.weights
        ok = np.ones(len(slot.choices), dtype=bool)
        value = slot.utility
        # Travel applies to members who were at the slot right before this one.
        moving = slot.present & (previous >= 0)
        if slot.travel is not None and slot.arrival_ok is not None and moving.any():
            origin = np.where(moving, previous, 0)[None, :]
            target = np.maximum(slot.candidate, 0)
            travel = np.where(moving[None, :], slot.travel[origin, target], 0.0)
            ok &= np.where(moving[None, :], slot.arrival_ok[origin, target], True).all(axis=1)
            # Same expression as plan_score, so a finished plan's total matches it exactly.
            value = slot.utility - w.travel * travel
        next_values = values[None, :] + np.where(slot.present[None, :], value, 0.0)
        next_spent = spent[None, :] + slot.price
        ok &= (next_spent <= self.budget[None, :]).all(axis=1)
        next_previous = np.where(slot.present[None, :], slot.candidate, -1)
        return next_values, next_spent, next_previous, ok

    def _bound(
        self,
        s: int,
        values: npt.NDArray[np.float64],
        previous: npt.NDArray[np.int64],
        splits: npt.NDArray[np.int64],
    ) -> npt.NDArray[np.float64]:
        """The best plan score each choice for slot s could still lead to. The next slot counts from where
        each member actually is; later slots count their best utility, since travel only subtracts."""
        if s + 1 == len(self.slots):
            return self._totals(values, splits)
        ahead = self.slots[s + 1].best_from
        column = np.where(previous >= 0, previous, ahead.shape[1] - 1)
        reachable = ahead[np.arange(self.n)[None, :], column]
        return self._totals(values + reachable + self.rest[s + 2], splits)

    def _totals(self, values: npt.NDArray[np.float64], splits: npt.NDArray[np.int64]) -> npt.NDArray[np.float64]:
        """plan_score over rows of summed member values, vectorized. Used only for bounds."""
        w = self.table.weights
        span = (w.preference + w.cost + w.travel) or 1.0
        counted = self.slot_counts > 0
        scores = np.where(counted, (values / np.maximum(self.slot_counts, 1) + w.cost + w.travel) / span, 0.0)
        return scores.mean(axis=1) + w.fairness * scores.min(axis=1) - w.split_penalty * splits

    def _floor(self) -> float:
        """A new plan must beat this to be kept."""
        if len(self.kept) < self.params.max_plans:
            return -np.inf
        return self.kept[-1][0] + TIE

    def _offer(self, assignment: Assignment, values: npt.NDArray[np.float64], splits: int) -> None:
        w = self.table.weights
        scores = [member_score(w, float(values[m]), int(self.slot_counts[m])) for m in range(self.n)]
        total = combine(w, scores, splits)
        if total <= self._floor():
            return
        self.kept.append((total, assignment))
        self.kept.sort(key=lambda entry: (-entry[0], assignment_key(entry[1])))
        del self.kept[self.params.max_plans :]

    def _compile(self, s: int) -> _Slot:
        table, info = self.table, self.table.slots[s]
        choices = self._slot_choices(s)
        candidate = np.array([[-1 if c is None else c for c in choice] for choice, _ in choices], dtype=np.int64)
        candidate = candidate.reshape(len(choices), self.n)
        utility = np.zeros(candidate.shape)
        price = np.zeros(candidate.shape, dtype=np.int64)
        for row, (choice, _) in enumerate(choices):
            for m, c in enumerate(choice):
                if c is not None:
                    utility[row, m] = table.utility[(m, s, c)]
                    price[row, m] = table.price[(s, c)]
        travel = arrival = None
        if s > 0:
            shape = (len(table.slots[s - 1].candidates), len(info.candidates))
            travel = np.array([[table.travel[(s, p, c)] for c in range(shape[1])] for p in range(shape[0])])
            arrival = np.array([[table.arrival_ok[(s, p, c)] for c in range(shape[1])] for p in range(shape[0])])
        present = np.array([info.pinned_members is None or m in info.pinned_members for m in range(self.n)])
        split = np.array([split for _, split in choices], dtype=np.int64)

        previous_count = len(table.slots[s - 1].candidates) if s > 0 else 0
        best_from = np.zeros((self.n, previous_count + 1))
        for m in np.flatnonzero(present):
            gains = {int(c): table.utility[(m, s, int(c))] for c in set(candidate[:, m])}
            best_from[m, previous_count] = max(gains.values(), default=-np.inf)
            for p in range(previous_count):
                reachable = [
                    gain - table.weights.travel * table.travel[(s, p, c)]
                    for c, gain in gains.items()
                    if table.arrival_ok[(s, p, c)]
                ]
                best_from[m, p] = max(reachable, default=-np.inf)
        return _Slot(
            [choice for choice, _ in choices], candidate, utility, price, split, present, travel, arrival, best_from
        )

    def _slot_choices(self, s: int) -> list[tuple[Choice, int]]:
        """Each way the members can attend slot s, with 1 if it splits them. Better choices come first, which
        settles ties between equal plans the same way every time."""
        table, slot, n = self.table, self.table.slots[s], self.n
        if slot.pinned_members is not None:
            return [(tuple(0 if m in slot.pinned_members else None for m in range(n)), 0)]

        def fits(group: list[int], c: int) -> bool:
            price = table.price[(s, c)]
            return all(
                table.allowed[(m, s, c)] and (table.budget[m] is None or price <= table.budget[m]) for m in group
            )

        choices: list[tuple[Choice, int]] = []
        for groups in self._partitions(slot.together):
            options = [[c for c in range(len(slot.candidates)) if fits(group, c)] for group in groups]
            for picked in itertools.product(*options):
                if len(set(picked)) < len(picked):
                    continue  # two groups at one place are one group, which the merged partition covers
                choice: list[int | None] = [None] * n
                for group, c in zip(groups, picked, strict=True):
                    for m in group:
                        choice[m] = c
                choices.append((tuple(choice), 1 if len(groups) > 1 else 0))

        def optimism(entry: tuple[Choice, int]) -> float:
            choice, split = entry
            gain = sum(table.utility[(m, s, c)] for m, c in enumerate(choice) if c is not None)
            return gain - table.weights.split_penalty * split

        return sorted(choices, key=optimism, reverse=True)

    def _partitions(self, together: bool) -> list[list[list[int]]]:
        """Everyone in one group, plus each split into two groups when the slot allows it."""
        members, smallest = list(range(self.n)), self.params.min_group_size
        partitions = [[members]] if self.n >= smallest else []
        if together or self.params.max_groups_per_slot < 2:
            return partitions
        # Member 0's group is always the first, so each split is listed once.
        for mask in range(1 << (self.n - 1)):
            first = [0] + [m for m in range(1, self.n) if mask >> (m - 1) & 1]
            second = [m for m in range(1, self.n) if not mask >> (m - 1) & 1]
            if len(first) >= smallest and len(second) >= smallest:
                partitions.append([first, second])
        return partitions

    def _best_remaining(self) -> list[npt.NDArray[np.float64]]:
        """rest[s][m]: the most member m could still add from slot s on. Travel only subtracts, so the best
        utility among a slot's choices bounds what the slot adds."""
        rest = [np.zeros(self.n) for _ in range(len(self.slots) + 1)]
        for s in reversed(range(len(self.slots))):
            utility = self.slots[s].utility
            best = utility.max(axis=0) if len(utility) else np.zeros(self.n)
            rest[s] = rest[s + 1] + best
        return rest
