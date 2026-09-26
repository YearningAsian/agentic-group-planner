"""The ScoreTable contract and the objective, plan_score, checked against hand-computed fixtures.

Hand computation of small_expected.json from small_table.json
==============================================================

Weights: w_p 1.0, w_c 0.6, w_t 0.4, w_f 0.8, split_penalty 0.1 (lowered from 0.3 so a split can win).
Members m0..m3 are Person 1..4. Slot 0 is the morning (museum c0, zoo c1, park c2; groups may split).
Slot 1 is lunch (cafe c0, grill c1, bistro c2), together.

A member's value in a slot is v = utility − w_t × travel, where travel is 0 in the first slot.
member score = (mean of v over the member's slots + w_c + w_t) ÷ (w_p + w_c + w_t) = (v_morning + v_lunch) ÷ 4 + 0.5
plan score   = mean(member scores) + 0.8 × min(member scores) − 0.1 × split slots

Hard constraints that bite:
- The grill (lunch c1) is not allowed for m1 (vegetarian), and lunch is together, so nobody eats there.
- The zoo → bistro arrival is not ok (12:36 is past 12:15 + 15 min).
- m3's budget is 5000: the zoo (4000) plus any lunch (at least 1500) is over it, so m3 never goes to the zoo.

The cafe beats the bistro from every morning place (utility −0.15 vs −0.375, travel equal or lower), so the
top plans all lunch at the cafe. v at the cafe after each morning place: museum −0.15 − 0.4 × 0.2 = −0.23,
zoo −0.15 − 0.4 × 0.4 = −0.31, park −0.23.

Member scores with lunch at the cafe, v_morning + v_cafe:
          museum                        zoo                            park
  m0   0.55 − 0.23 = 0.32   → 0.58     −0.3 − 0.31 = −0.61 → 0.3475   0 − 0.23 = −0.23    → 0.4425
  m1  −0.15 − 0.23 = −0.38  → 0.405     0.4 − 0.31 = 0.09  → 0.5225   0.35 − 0.23 = 0.12  → 0.53
  m2  −0.38                 → 0.405     0.09               → 0.5225   −0.23               → 0.4425
  m3   0.32                 → 0.58     (over budget)                  −0.23               → 0.4425

Rank 1: m0, m3 at the museum; m1, m2 at the zoo (1 split slot)
  scores 0.58, 0.5225, 0.5225, 0.58 → mean 0.55125, min 0.5225
  0.55125 + 0.8 × 0.5225 − 0.1 = 0.55125 + 0.418 − 0.1 = 0.86925
Rank 2: everyone at the park
  scores 0.4425, 0.53, 0.4425, 0.4425 → mean 0.464375, min 0.4425
  0.464375 + 0.8 × 0.4425 = 0.464375 + 0.354 = 0.818375
Rank 3: everyone at the museum
  scores 0.58, 0.405, 0.405, 0.58 → mean 0.4925, min 0.405
  0.4925 + 0.8 × 0.405 = 0.4925 + 0.324 = 0.8165
Next best, for the record: m0, m3 at the museum and m1, m2 at the park: 0.533125 + 0.354 − 0.1 = 0.787125.
Every other split pairs someone who likes the museum with someone who doesn't, and together at the zoo breaks
m3's budget. 22 plans are feasible in all.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from app.models import Weights
from app.score_table import ScoreTable, SlotInfo, plan_score

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def as_assignment(rows: list[list[int | None]]) -> tuple[tuple[int | None, ...], ...]:
    return tuple(tuple(row) for row in rows)


@pytest.fixture
def small_table() -> ScoreTable:
    return ScoreTable.from_json(load("small_table.json"))


def test_small_table_round_trips_from_json() -> None:
    raw = load("small_table.json")
    table = ScoreTable.from_json(raw)
    assert table.to_json() == raw
    # Keys come back as index tuples, not strings.
    assert table.utility[(1, 0, 1)] == 0.4
    assert table.allowed[(1, 1, 1)] is False
    assert table.arrival_ok[(1, 1, 2)] is False
    assert table.price[(0, 1)] == 4000
    assert table.budget == [8000, 8000, None, 5000]
    assert table.weights.split_penalty == 0.1
    assert table.slots[1] == SlotInfo(key="lunch", together=True, candidates=raw["slots"][1]["candidates"])


def test_plan_score_matches_the_hand_computed_values_in_small_expected(small_table: ScoreTable) -> None:
    for expected in load("small_expected.json")["plans"]:
        score = plan_score(small_table, as_assignment(expected["assignment"]))
        assert score.total == pytest.approx(expected["total_score"], abs=1e-9)
        assert score.fairness == pytest.approx(expected["fairness"], abs=1e-9)
        assert score.split_slots == expected["split_slots"]
        assert [m.score for m in score.members] == pytest.approx(expected["member_scores"], abs=1e-9)


def test_plan_score_adds_fairness_and_subtracts_the_split_penalty(small_table: ScoreTable) -> None:
    split_plan, _, together_plan = (as_assignment(p["assignment"]) for p in load("small_expected.json")["plans"])
    neutral = Weights(preference=1.0, cost=0.6, travel=0.4, fairness=0.0, split_penalty=0.0)
    neutral_table = replace(small_table, weights=neutral)

    base = plan_score(neutral_table, split_plan)
    assert base.total == pytest.approx(0.55125)  # the mean alone
    full = plan_score(small_table, split_plan)
    assert full.total - base.total == pytest.approx(0.8 * 0.5225 - 0.1 * 1)

    base = plan_score(neutral_table, together_plan)
    full = plan_score(small_table, together_plan)
    assert full.split_slots == 0
    assert full.total - base.total == pytest.approx(0.8 * 0.405)


def test_plan_score_reports_each_members_mean_breakdown(small_table: ScoreTable) -> None:
    score = plan_score(small_table, as_assignment([[0, 1, 1, 0], [0, 0, 0, 0]]))
    person_1, person_2 = score.members[0], score.members[1]
    # Person 1: museum then cafe. Person 2: zoo then cafe.
    assert (person_1.preference, person_1.cost, person_1.travel) == pytest.approx((0.5, 0.5, 0.1))
    assert (person_2.preference, person_2.cost, person_2.travel) == pytest.approx((0.575, 0.75, 0.2))


def test_a_member_outside_a_pinned_slot_skips_it_and_its_travel() -> None:
    # Slot 0 is pinned with m0 only; slot 1 is open. m1 isn't at slot 0, so where m1 comes from is unknown:
    # m1's score counts slot 1 alone, with no travel term.
    table = ScoreTable(
        members=["m0", "m1"],
        slots=[
            SlotInfo(key="brunch", together=True, candidates=["p0"], pinned_members=[0]),
            SlotInfo(key="walk", together=True, candidates=["p1"]),
        ],
        utility={(0, 0, 0): 0.2, (1, 0, 0): 0.2, (0, 1, 0): 0.6, (1, 1, 0): 0.6},
        allowed={(0, 0, 0): True, (1, 0, 0): True, (0, 1, 0): True, (1, 1, 0): True},
        travel={(1, 0, 0): 0.5},
        arrival_ok={(1, 0, 0): True},
        price={(0, 0): 0, (1, 0): 0},
        budget=[None, None],
        weights=Weights(),
        infeasible_reasons=[],
    )
    score = plan_score(table, ((0, None), (0, 0)))
    # m0: (0.2 + (0.6 − 0.4 × 0.5)) ÷ 2 = 0.3 → (0.3 + 1.0) ÷ 2 = 0.65. m1: 0.6 → (0.6 + 1.0) ÷ 2 = 0.8.
    assert [m.score for m in score.members] == pytest.approx([0.65, 0.8])
    assert score.members[1].travel == 0.0
