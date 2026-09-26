"""Pin the seeded Saturday plan to the intended cast, places, and mock recording."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parents[2] / "web" / "scripts" / "demo" / "fixtures"
PERSON_1 = "5936e905-f9d3-5ac6-8ade-02c279857732"
PERSON_2 = "a09069ed-aa32-5c6f-8768-ffad25a08b96"
PERSON_3 = "e259b2b9-c227-52e0-a468-b84631bbc1b9"
PERSON_4 = "7d55bc2d-262d-5e3b-b2fb-8a56a418b9af"
AQUARIUM = "49c6f996-2da3-5ffa-b782-c7a12b116fc4"
PONCE_CITY_MARKET = "35e4c36e-dee7-5d8a-a60e-2344516d1ed4"
HIGH_MUSEUM = "6e432f26-57db-5b3f-a907-f34d2c0be7f4"
PIEDMONT_PARK = "cc0fdcb1-e474-5ae2-befc-197cec2a2943"


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _groups(plan: dict[str, Any]) -> dict[str, set[tuple[str, tuple[str, ...]]]]:
    """Compare assignments without depending on the engine's group or member ordering."""
    return {
        slot["slot_key"]: {
            (group["place_id"], tuple(sorted(group["member_ids"]))) for group in slot["groups"]
        }
        for slot in plan["assignments"]
    }


def _seeded_response(post_plan: Any) -> dict[str, Any]:
    request = _fixture("requests/saturday-initial.json")
    response = post_plan(request)
    assert response.status_code == 200, response.text
    return response.json()


def test_seeded_trip_plan(post_plan: Any) -> None:
    result = _seeded_response(post_plan)
    assert result["engine"] == "cp_sat"
    assert result["status"] == "optimal"
    assert result["solve_ms"] < 2000
    assert result["plans"]
    everyone = tuple(sorted((PERSON_1, PERSON_2, PERSON_3, PERSON_4)))
    assert _groups(result["plans"][0]) == {
        "morning": {(AQUARIUM, everyone)},
        "lunch": {(PONCE_CITY_MARKET, everyone)},
        "afternoon": {
            (HIGH_MUSEUM, tuple(sorted((PERSON_1, PERSON_4)))),
            (PIEDMONT_PARK, tuple(sorted((PERSON_2, PERSON_3)))),
        },
    }
    lunch = next(slot for slot in _fixture("requests/saturday-initial.json")["slots"] if slot["key"] == "lunch")
    chosen_lunch = next(candidate for candidate in lunch["candidates"] if candidate["place_id"] == PONCE_CITY_MARKET)
    assert "vegetarian" in chosen_lunch["dietary_tags"]


def test_mock_plan_matches_engine(post_plan: Any) -> None:
    actual = _seeded_response(post_plan)["plans"][0]
    recorded = _fixture("mock-plan.json")["response"]["plans"][0]
    assert _groups(recorded) == _groups(actual)
