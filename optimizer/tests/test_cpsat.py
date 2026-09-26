"""The CP-SAT engine: it reads only a ScoreTable and finds the top plans through no-good cuts."""

from __future__ import annotations

import time
from dataclasses import replace

import pytest
from ortools.sat.python import cp_model

from app.models import Params, Weights
from app.plan_cpsat import solve_plans
from app.plan_enumerate import enumerate_plans
from app.score_table import EngineUnavailable, ScoreTable, SlotInfo, is_feasible
from tests.tables import as_assignment, random_table, small_expected, small_table

PARAMS = Params()
def test_top_plan_on_small_table_equals_small_expected() -> None:
    result = solve_plans(small_table(), PARAMS)
    expected = small_expected()
    assert result.engine == "cp_sat"
    assert result.status == "optimal"
    assert [p.assignment for p in result.plans] == [as_assignment(e["assignment"]) for e in expected]
    assert [p.score.total for p in result.plans] == pytest.approx([e["total_score"] for e in expected], abs=1e-9)


def test_three_distinct_plans_via_nogood_cuts() -> None:
    # A pinned slot in the middle for 3 of 5 members, a together slot, and a binding budget.
    table = random_table(
        members=5, open_slots=3, candidates=4, seed=21, together=(2,), pinned=(1, [0, 2, 4]), budget=7000
    )
    result = solve_plans(table, PARAMS)
    assignments = [p.assignment for p in result.plans]
    assert len(assignments) == 3
    assert len(set(assignments)) == 3
    assert all(is_feasible(table, a, PARAMS.min_group_size, PARAMS.max_groups_per_slot) for a in assignments)
    totals = [p.score.total for p in result.plans]
    assert totals == sorted(totals, reverse=True)
    exhaustive = enumerate_plans(table, PARAMS)
    assert assignments[0] == exhaustive.plans[0].assignment
    assert totals == pytest.approx([p.score.total for p in exhaustive.plans], abs=1e-3)


def test_fairness_term_raises_the_lowest_member() -> None:
    # One together slot. Place 0 delights three members and fails the fourth; place 1 suits everyone a little.
    table = ScoreTable(
        members=["m0", "m1", "m2", "m3"],
        slots=[SlotInfo(key="afternoon", together=True, candidates=["place-0", "place-1"])],
        utility={
            **{(m, 0, 0): 0.9 for m in range(3)},
            (3, 0, 0): -0.9,
            **{(m, 0, 1): 0.3 for m in range(4)},
        },
        allowed={(m, 0, c): True for m in range(4) for c in range(2)},
        travel={},
        arrival_ok={},
        price={(0, 0): 0, (0, 1): 0},
        budget=[None] * 4,
        weights=Weights(fairness=0.0),
        infeasible_reasons=[],
    )
    unfair = solve_plans(table, PARAMS).plans[0]
    fair = solve_plans(replace(table, weights=Weights(fairness=0.8)), PARAMS).plans[0]
    # Without the term the mean wins: 0.725 at place 0, whose lowest member scores 0.05.
    assert unfair.assignment == ((0, 0, 0, 0),)
    assert unfair.score.fairness == pytest.approx(0.05)
    # With it, place 1 wins: 0.65 + 0.8 × 0.65 = 1.17 beats 0.725 + 0.8 × 0.05 = 0.765.
    assert fair.assignment == ((1, 1, 1, 1),)
    assert fair.score.fairness == pytest.approx(0.65)


def test_respects_the_time_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    limits: list[float] = []
    solve = cp_model.CpSolver.solve

    def spy(self: cp_model.CpSolver, model: cp_model.CpModel, *args: object) -> object:
        limits.append(self.parameters.max_time_in_seconds)
        return solve(self, model, *args)

    monkeypatch.setattr(cp_model.CpSolver, "solve", spy)
    # Keep the solver-call budget assertion independent of machine load: the larger random
    # instance can exhaust its 200 ms slice before finding even one feasible plan on Windows.
    table = small_table()
    started = time.perf_counter()
    result = solve_plans(table, Params(time_limit_ms=600, max_plans=3))
    elapsed = time.perf_counter() - started

    assert limits == pytest.approx([0.2, 0.2, 0.2])  # time_limit_ms ÷ max_plans, per solve
    assert elapsed < 0.6 + 0.5  # plus model building
    assert result.status in ("optimal", "feasible")
    assert len(result.plans) == 3


def test_no_plan_returns_infeasible_with_the_table_reasons() -> None:
    table = small_table()
    reason = "No lunch option meets {member:00000000-0000-4000-8000-000000000002}'s dietary needs (vegetarian)"
    table = replace(
        table, allowed={**table.allowed, **{(1, 1, c): False for c in range(3)}}, infeasible_reasons=[reason]
    )
    result = solve_plans(table, PARAMS)
    assert result.status == "infeasible"
    assert result.plans == []
    assert result.infeasible_reasons == [reason]


def test_an_unknown_solver_status_raises_engine_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cp_model.CpSolver, "solve", lambda self, model, *args: cp_model.UNKNOWN)
    with pytest.raises(EngineUnavailable, match="UNKNOWN"):
        solve_plans(small_table(), PARAMS)
