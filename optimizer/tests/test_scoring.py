"""Scoring terms and build_score_table (design §2.2), checked against the hand-computed small fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.models import Candidate, Member, PlanRequest
from app.score_table import ScoreTable
from app.scoring import build_score_table, cost, preference, travel

FIXTURES = Path(__file__).parent / "fixtures"
M2 = "00000000-0000-4000-8000-000000000002"
M4 = "00000000-0000-4000-8000-000000000004"


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def small_request() -> dict[str, Any]:
    return load("small_request.json")


def test_preference_formula() -> None:
    member = Member.model_validate(
        {"id": "00000000-0000-4000-8000-000000000001", "interests": ["art", "history", "food"]}
    )
    museum = Candidate.model_validate(
        {"place_id": "00000000-0000-4000-8000-000000000101", "price_cents": 0, "duration_min": 60}
        | {"tags": ["art"], "rating": 4.5}
    )

    assert preference(member, museum) == pytest.approx(0.7 * 1 / 3 + 0.3 * 0.75)
    assert preference(member, museum) == pytest.approx(0.4583, abs=1e-4)


def test_cost_is_zero_when_every_candidate_is_free() -> None:
    assert cost(0, 0) == 0.0
    assert cost(1500, 2000) == 0.75


def test_travel_caps_at_45_minutes() -> None:
    assert travel(0) == 0.0
    assert travel(30) == pytest.approx(2 / 3)
    assert travel(45) == 1.0
    assert travel(90) == 1.0


def test_build_score_table_on_small_request_equals_small_table() -> None:
    built = build_score_table(PlanRequest.model_validate(small_request())).to_json()
    expected = load("small_table.json")

    for field in ("members", "slots", "allowed", "arrival_ok", "price", "budget", "weights", "infeasible_reasons"):
        assert built[field] == expected[field], field
    for field in ("preference", "cost", "travel"):
        assert built[field].keys() == expected[field].keys(), field
        for key, value in expected[field].items():
            assert built[field][key] == pytest.approx(value, abs=1e-6), f"{field}[{key}]"


def test_infeasible_reason_names_the_member() -> None:
    raw = small_request()
    raw["slots"][0]["candidates"][0]["dietary_tags"] = []  # no vegetarian lunch anywhere

    table = build_score_table(PlanRequest.model_validate(raw))

    assert table.infeasible_reasons == (f"{{member:{M2}}} has no lunch option that fits their dietary needs",)


def test_infeasible_reason_when_nothing_is_open() -> None:
    raw = small_request()
    for option in raw["slots"][0]["candidates"]:
        option["open_from"], option["open_until"] = "2026-10-03T17:00:00Z", "2026-10-03T22:00:00Z"

    table = build_score_table(PlanRequest.model_validate(raw))

    assert table.infeasible_reasons == ("No lunch option is open then",)


def test_infeasible_reasons_name_a_member_whose_budget_falls_short() -> None:
    one_slot = small_request()
    one_slot["members"][3]["budget_cents"] = 999  # the cheapest lunch is 1000
    too_little = build_score_table(PlanRequest.model_validate(one_slot))

    both_slots = small_request()
    both_slots["members"][3]["budget_cents"] = 1000
    both_slots["slots"][1]["candidates"][1]["price_cents"] = 500  # cheapest afternoon is now 500
    short_overall = build_score_table(PlanRequest.model_validate(both_slots))

    assert too_little.infeasible_reasons == (f"{{member:{M4}}}'s budget can't cover any lunch option",)
    assert short_overall.infeasible_reasons == (f"{{member:{M4}}}'s budget can't cover a stop in every slot",)


def test_a_missing_travel_edge_is_an_error() -> None:
    raw = small_request()
    raw["travel"] = raw["travel"][1:]

    with pytest.raises(ValueError, match="no travel time"):
        build_score_table(PlanRequest.model_validate(raw))


def test_pinned_slot_members_become_indices() -> None:
    raw = small_request()
    afternoon = raw["slots"][1]
    afternoon["candidates"] = afternoon["candidates"][1:2]
    afternoon["pinned"] = {"place_id": afternoon["candidates"][0]["place_id"], "member_ids": [M2, M4]}

    table: ScoreTable = build_score_table(PlanRequest.model_validate(raw))

    assert table.slots[1].pinned_members == (1, 3)
    assert table.slots[0].pinned_members is None
