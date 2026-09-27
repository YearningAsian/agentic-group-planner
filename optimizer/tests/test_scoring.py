"""The design §2.2 scoring terms, and build_score_table against the hand-checked small fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.models import PlanRequest
from app.score_table import ScoreTable
from app.scoring import build_score_table, cost, preference, travel

FIXTURES = Path(__file__).parent / "fixtures"
PERSON_2 = "00000000-0000-4000-8000-000000000002"


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def test_preference_formula() -> None:
    # 0.7 × 1/3 + 0.3 × (4.5 − 3) ÷ 2 = 0.2333 + 0.225
    assert preference(["art", "history", "food"], ["art"], 4.5) == pytest.approx(0.4583, abs=1e-4)
    assert preference([], ["art"], 5.0) == pytest.approx(0.3)  # no interests: rating only
    assert preference(["art"], ["art"], None) == pytest.approx(0.7)  # no rating counts as neutral
    assert preference(["art"], [], 2.0) == 0.0  # below 3 stars clamps to 0


def test_cost_is_zero_when_every_candidate_is_free() -> None:
    assert cost(0, 0) == 0.0
    assert cost(1500, 3000) == 0.5
    assert cost(3000, 3000) == 1.0


def test_travel_caps_at_45_minutes() -> None:
    assert travel(0) == 0.0
    assert travel(9) == pytest.approx(0.2)
    assert travel(45) == 1.0
    assert travel(90) == 1.0


def test_build_score_table_on_small_request_equals_small_table() -> None:
    built = build_score_table(PlanRequest.model_validate(load("small_request.json")))
    expected = ScoreTable.from_json(load("small_table.json"))

    assert built.members == expected.members
    assert built.slots == expected.slots
    assert built.allowed == expected.allowed
    assert built.arrival_ok == expected.arrival_ok
    assert built.price == expected.price
    assert built.budget == expected.budget
    assert built.weights == expected.weights
    assert built.infeasible_reasons == expected.infeasible_reasons
    for name in ("utility", "travel", "preference", "cost"):
        assert getattr(built, name) == pytest.approx(getattr(expected, name), abs=1e-6), name


def test_infeasible_reason_names_the_member() -> None:
    body = load("small_request.json")
    lunch = body["slots"][1]
    for candidate in lunch["candidates"]:
        candidate["dietary_tags"] = []  # no vegetarian lunch anywhere
    table = build_score_table(PlanRequest.model_validate(body))
    assert table.infeasible_reasons == [f"No lunch option meets {{member:{PERSON_2}}}'s dietary needs (vegetarian)"]


def test_infeasible_reason_for_a_budget_below_every_option() -> None:
    body = load("small_request.json")
    body["members"][1]["budget_cents"] = 1000  # the cheapest lunch is 1500
    table = build_score_table(PlanRequest.model_validate(body))
    assert table.infeasible_reasons == [f"{{member:{PERSON_2}}}'s budget can't cover any lunch option"]


def test_pinned_slot_members_become_indices() -> None:
    body = load("small_request.json")
    lunch = body["slots"][1]
    lunch["candidates"] = lunch["candidates"][:1]
    lunch["pinned"] = {"place_id": lunch["candidates"][0]["place_id"], "member_ids": [PERSON_2]}
    table = build_score_table(PlanRequest.model_validate(body))
    assert table.slots[1].pinned_members == [1]
