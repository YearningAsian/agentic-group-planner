"""No member visits the same place twice in a day, in either engine or in is_feasible (design §2.2)."""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.models import Params, Weights
from app.plan_cpsat import solve_plans
from app.plan_enumerate import enumerate_plans
from app.score_table import Assignment, ScoreTable, SlotInfo, is_feasible
from tests.tables import random_table
from tests.test_enumerate import brute_force

PARAMS = Params()


def _repeats(table: ScoreTable, assignment: Assignment) -> bool:
    for m in range(len(table.members)):
        places = [table.slots[s].candidates[c] for s, choice in enumerate(assignment) if (c := choice[m]) is not None]
        if len(places) != len(set(places)):
            return True
    return False


def _one_great_place() -> ScoreTable:
    """Two open slots offering the same two places; place A beats place B in both."""
    return ScoreTable(
        members=["m0", "m1"],
        slots=[SlotInfo("morning", True, ["A", "B"]), SlotInfo("afternoon", True, ["A", "B"])],
        utility={(m, s, c): 0.9 if c == 0 else 0.2 for m in range(2) for s in range(2) for c in range(2)},
        allowed={(m, s, c): True for m in range(2) for s in range(2) for c in range(2)},
        travel={(1, p, c): 0.0 for p in range(2) for c in range(2)},
        arrival_ok={(1, p, c): True for p in range(2) for c in range(2)},
        price={(s, c): 0 for s in range(2) for c in range(2)},
        budget=[None, None],
        weights=Weights(),
        infeasible_reasons=[],
    )


def test_is_feasible_rejects_a_member_at_one_place_twice() -> None:
    table = _one_great_place()
    assert not is_feasible(table, ((0, 0), (0, 0)), 1, 2)
    assert is_feasible(table, ((0, 0), (1, 1)), 1, 2)


def test_is_feasible_counts_a_pinned_slots_place() -> None:
    table = random_table(members=4, open_slots=2, candidates=3, seed=1, pinned=(1, [0, 1]), shared_places=True)
    table = replace(
        table,
        allowed=dict.fromkeys(table.allowed, True),
        arrival_ok=dict.fromkeys(table.arrival_ok, True),
    )
    # Members 0 and 1 are pinned at place-0 in slot 1, so neither may pick place-0 (candidate 0) in slot 0.
    assert not is_feasible(table, ((0, 0, 0, 0), (0, 0, None, None), (1, 1, 1, 1)), 2, 2)
    assert is_feasible(table, ((2, 2, 0, 0), (0, 0, None, None), (1, 1, 1, 1)), 2, 2)


@pytest.mark.parametrize("engine", [enumerate_plans, solve_plans])
def test_the_best_place_fills_one_slot_not_both(engine: object) -> None:
    result = engine(_one_great_place(), PARAMS)  # type: ignore[operator]
    assert result.plans
    assert all(not _repeats(_one_great_place(), p.assignment) for p in result.plans)
    assert result.plans[0].assignment in (((0, 0), (1, 1)), ((1, 1), (0, 0)))


@pytest.mark.parametrize("seed", [7, 11])
def test_enumeration_finishes_at_the_limits_when_places_repeat(seed: int) -> None:
    # A pinned last slot at a shared place, and every open slot offering the same six places.
    table = random_table(
        members=6,
        open_slots=3,
        candidates=6,
        seed=seed,
        pinned=(3, [0, 1, 2]),
        weights=Weights(split_penalty=0.0),
        shared_places=True,
    )
    result = enumerate_plans(table, PARAMS)
    assert result.status == "optimal"  # not cut short by the 2 s default time limit
    assert len(result.plans) == 3
    assert all(not _repeats(table, p.assignment) for p in result.plans)


@pytest.mark.parametrize("seed", range(8))
def test_both_engines_match_brute_force_when_places_repeat(seed: int) -> None:
    pinned = (1, [1, 2, 3]) if seed % 2 else None
    table = random_table(
        members=4, open_slots=2, candidates=3, seed=seed, pinned=pinned, budget=6000, shared_places=True
    )
    if seed % 3 == 0:
        table = replace(table, weights=Weights(split_penalty=0.0))
    expected = brute_force(table, PARAMS)[:3]
    for result, tolerance in ((enumerate_plans(table, PARAMS), 1e-12), (solve_plans(table, PARAMS), 1e-3)):
        assert [p.score.total for p in result.plans] == pytest.approx([t for t, _ in expected], abs=tolerance)
        assert all(not _repeats(table, p.assignment) for p in result.plans)
