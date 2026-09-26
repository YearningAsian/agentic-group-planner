"""The exhaustive enumeration engine: it reads only a ScoreTable and returns the top plans by plan_score."""

from __future__ import annotations

import itertools
from dataclasses import replace

import pytest

from app import plan_enumerate
from app.models import Params, Weights
from app.plan_enumerate import enumerate_plans
from app.score_table import Assignment, ScoreTable, is_feasible, plan_score, slot_groups
from tests.tables import as_assignment, random_table, small_expected, small_table

PARAMS = Params()
SPLIT_FRIENDLY = Weights(split_penalty=0.0)


def brute_force(table: ScoreTable, params: Params) -> list[tuple[float, Assignment]]:
    """Every assignment, filtered by is_feasible and ranked by plan_score: the slow reference."""
    per_slot = []
    for slot in table.slots:
        if slot.pinned_members is not None:
            per_slot.append([tuple(0 if m in slot.pinned_members else None for m in range(len(table.members)))])
        else:
            per_slot.append(list(itertools.product(range(len(slot.candidates)), repeat=len(table.members))))
    ranked = [
        (plan_score(table, a).total, a)
        for a in itertools.product(*per_slot)
        if is_feasible(table, a, params.min_group_size, params.max_groups_per_slot)
    ]
    return sorted(ranked, key=lambda p: -p[0])


def test_top3_sorted_by_plan_score() -> None:
    table = small_table()
    result = enumerate_plans(table, PARAMS)
    assert result.engine == "enumeration"
    assert result.status == "optimal"
    totals = [p.score.total for p in result.plans]
    assert len(totals) == 3
    assert totals == sorted(totals, reverse=True)
    for plan in result.plans:
        assert plan.score == plan_score(table, plan.assignment)


def test_together_slot_has_one_group() -> None:
    table = random_table(members=5, open_slots=3, candidates=4, seed=3, together=(1,), weights=SPLIT_FRIENDLY)
    result = enumerate_plans(table, PARAMS)
    assert result.plans
    for plan in result.plans:
        groups = slot_groups(plan.assignment[1])
        assert len(groups) == 1
        assert groups[0][1] == [0, 1, 2, 3, 4]


def test_groups_have_at_least_two_members_and_at_most_two_groups() -> None:
    table = random_table(members=6, open_slots=3, candidates=5, seed=11, weights=SPLIT_FRIENDLY)
    result = enumerate_plans(table, PARAMS)
    assert any(p.score.split_slots for p in result.plans), "the table should make splitting worth it"
    for plan in result.plans:
        for choice in plan.assignment:
            groups = slot_groups(choice)
            assert 1 <= len(groups) <= 2
            assert all(len(members) >= 2 for _, members in groups)
    # A larger minimum group rules splits out for 5 members: 3 + 3 doesn't fit.
    table = random_table(members=5, open_slots=2, candidates=4, seed=11, weights=SPLIT_FRIENDLY)
    result = enumerate_plans(table, Params(min_group_size=3))
    assert result.plans
    assert all(p.score.split_slots == 0 for p in result.plans)


def test_pinned_slot_keeps_its_place_and_members() -> None:
    table = random_table(members=4, open_slots=2, candidates=3, seed=5, pinned=(1, [0, 2]))
    result = enumerate_plans(table, PARAMS)
    assert result.plans
    for plan in result.plans:
        assert plan.assignment[1] == (0, None, 0, None)


def test_top_plan_on_small_table_equals_small_expected() -> None:
    result = enumerate_plans(small_table(), PARAMS)
    expected = small_expected()
    assert [p.assignment for p in result.plans] == [as_assignment(e["assignment"]) for e in expected]
    assert [p.score.total for p in result.plans] == pytest.approx([e["total_score"] for e in expected], abs=1e-9)


@pytest.mark.parametrize(
    "size",
    [
        {"members": 7, "open_slots": 3, "candidates": 6},
        {"members": 6, "open_slots": 4, "candidates": 6},
        {"members": 6, "open_slots": 3, "candidates": 7},
    ],
)
def test_too_large_beyond_limits(size: dict[str, int]) -> None:
    result = enumerate_plans(random_table(**size), PARAMS)
    assert result.status == "too_large"
    assert result.plans == []


def test_no_plan_returns_infeasible_with_the_table_reasons() -> None:
    table = small_table()
    reason = "No lunch option meets {member:00000000-0000-4000-8000-000000000002}'s dietary needs (vegetarian)"
    allowed = {**table.allowed, **{(1, 1, c): False for c in range(3)}}
    table = replace(table, allowed=allowed, infeasible_reasons=[reason])
    result = enumerate_plans(table, PARAMS)
    assert result.status == "infeasible"
    assert result.plans == []
    assert result.infeasible_reasons == [reason]


@pytest.mark.parametrize("seed", range(8))
def test_matches_brute_force_on_random_tables(seed: int) -> None:
    pinned = (1, [1, 2, 3]) if seed % 2 else None
    table = random_table(members=4, open_slots=2, candidates=3, seed=seed, pinned=pinned, budget=6000)
    if seed % 3 == 0:
        table = replace(table, weights=SPLIT_FRIENDLY)
    expected = brute_force(table, PARAMS)[:3]
    result = enumerate_plans(table, PARAMS)
    assert [p.score.total for p in result.plans] == pytest.approx([total for total, _ in expected], abs=1e-12)
    if expected:
        assert result.plans[0].assignment == expected[0][1]


def test_finishes_at_the_limits() -> None:
    table = random_table(members=6, open_slots=3, candidates=6, seed=7, pinned=(3, [0, 1, 2]), weights=SPLIT_FRIENDLY)
    result = enumerate_plans(table, PARAMS)
    assert result.status == "optimal"  # not cut short by the 2 s default time limit
    assert len(result.plans) == 3


def test_time_limit_returns_the_best_so_far(monkeypatch: pytest.MonkeyPatch) -> None:
    table = random_table(members=6, open_slots=3, candidates=6, seed=7, weights=SPLIT_FRIENDLY)
    readings = itertools.chain([0.0] * 12, itertools.repeat(10.0))  # time runs out after a few branches
    monkeypatch.setattr(plan_enumerate, "_clock", lambda: next(readings))
    result = enumerate_plans(table, Params(time_limit_ms=1000))
    assert result.status == "feasible"
    assert 1 <= len(result.plans) <= 3

    monkeypatch.setattr(plan_enumerate, "_clock", itertools.count(0.0, 10.0).__next__)  # out of time at once
    result = enumerate_plans(table, Params(time_limit_ms=1000))
    assert result.status == "infeasible"
    assert result.infeasible_reasons == [plan_enumerate.TIMED_OUT_REASON]
