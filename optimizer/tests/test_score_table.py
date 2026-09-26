"""The scoring/engine contract: the ScoreTable, and plan_score, the one objective both engines maximize.

Hand computation for fixtures/small_table.json (weights: preference 1.0, cost 0.6, travel 0.4,
fairness 0.8, split penalty 0.3). Members M1..M4 are indices 0..3.

Per member and slot, v = 1.0·preference − 0.6·cost − 0.4·travel. A member's score is the mean v over
their slots, rescaled from [−(0.6 + 0.4), 1.0] to 0..1: score = (mean v + 1) / 2.

  lunch (travel 0)       L1 (cost 1.0)        L2 (cost 0.5)
    M1                   0.5  − 0.6 = −0.10   1.0 − 0.3 = 0.70
    M2 (vegetarian)      0.85 − 0.6 =  0.25   not allowed (L2 has no vegetarian tag)
    M3, M4               0.15 − 0.6 = −0.45   0.3 − 0.3 = 0.00

  afternoon (together)   A1 from L1 (cost 1, travel 20/45)   A2 from L1 (cost 0, 10/45)   A2 from L2 (30/45)
    M1                   0.575 − 0.6 − 0.1778 = −0.2028      0 − 0.0889 = −0.0889         −0.2667
    M2                   0.225 − 0.6 − 0.1778 = −0.5528      −0.0889                      (never at L2)
    M3                   −0.5528                              0.7 − 0.0889 = 0.6111        0.4333
    M4                   −0.5528                              −0.0889                      −0.2667
  A3 closes at 14:00, before 13:30 + 60 min, so nobody may go. A1 from L2 arrives 13:50, past 13:45.

Feasible plans. M2 must lunch at L1, lunch groups have at least 2 members, and at most 2 groups.
A1 is reachable only from L1, so it needs everyone at L1 (M4 then spends 4000 of 4000):
  P1 all L1 → A1        scores .4243 .4243 .2493 .2493   mean .3368 + .8 × .2493            = .5363
  P2 all L1 → A2        scores .4528 .5403 .5403 .3653   mean .4747 + .8 × .3653            = .7669
  P3 M1 M2 @L1, M3 M4 @L2 → A2   .4528 .5403 .6083 .4333   mean .5087 + .8 × .4333 − .3 = .5553
  P4 M2 M3 @L1, M1 M4 @L2 → A2   .6083 .5403 .5403 .4333   mean .5306 + .8 × .4333 − .3 = .5772
  P5 M2 M4 @L1, M1 M3 @L2 → A2   .6083 .5403 .6083 .3653   mean .5306 + .8 × .3653 − .3 = .5228
Top 3, as in small_expected.json: P2, P4, P3.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from statistics import mean
from typing import Any

import pytest

from app.models import Weights
from app.score_table import Assignment, Group, ScoreTable, plan_score

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def assignment_from_json(raw: list[list[dict[str, Any]]]) -> Assignment:
    return tuple(tuple(Group(candidate=g["candidate"], members=tuple(g["members"])) for g in slot) for slot in raw)


@pytest.fixture
def table() -> ScoreTable:
    return ScoreTable.from_json(load("small_table.json"))


def test_small_table_round_trips_from_json(table: ScoreTable) -> None:
    assert table.to_json() == load("small_table.json")
    assert table.preference[(1, 0, 0)] == 0.85
    assert table.allowed[(1, 0, 1)] is False
    assert table.budget == (5000, 5000, None, 4000)
    assert table.utility(0, 0, 1) == pytest.approx(1.0 - 0.6 * 0.5)


def test_plan_score_matches_the_hand_computed_values_in_small_expected(table: ScoreTable) -> None:
    for expected in load("small_expected.json"):
        score = plan_score(table, assignment_from_json(expected["assignment"]))

        assert score.total == pytest.approx(expected["total"], abs=1e-6)
        assert score.fairness == pytest.approx(expected["fairness"], abs=1e-6)
        assert score.split_slots == expected["split_slots"]
        assert score.split is (expected["split_slots"] > 0)
        assert [m.score for m in score.members] == pytest.approx(expected["member_scores"], abs=1e-6)

    # The response reports each member's mean terms: rank 2 has M1 at L2 (pref 1.0, cost 0.5), then
    # A2 (pref 0, cost 0) after 30 minutes of travel.
    rank2 = plan_score(table, assignment_from_json(load("small_expected.json")[1]["assignment"]))
    assert rank2.members[0].preference == pytest.approx(0.5)
    assert rank2.members[0].cost == pytest.approx(0.25)
    assert rank2.members[0].travel == pytest.approx(1 / 3)


def test_plan_score_adds_fairness_and_subtracts_the_split_penalty(table: ScoreTable) -> None:
    split_plan = assignment_from_json(load("small_expected.json")[2]["assignment"])
    plain = dataclasses.replace(table, weights=Weights(fairness=0.0, split_penalty=0.0))

    base = plan_score(plain, split_plan)
    full = plan_score(table, split_plan)

    assert base.total == pytest.approx(mean(m.score for m in base.members))
    assert [m.score for m in full.members] == pytest.approx([m.score for m in base.members])
    assert full.total == pytest.approx(base.total + 0.8 * base.fairness - 0.3 * 1)
