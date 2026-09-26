"""HTTP contract of the optimizer: auth, validation limits, and the plan response."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import main
from app.main import app

TOKEN = "test-token"
FIXTURES = Path(__file__).parent / "fixtures"
MEMBERS = [f"00000000-0000-4000-8000-00000000000{n}" for n in range(1, 5)]


def place(n: int) -> str:
    return f"00000000-0000-4000-8000-0000000001{n:02d}"


def candidate(n: int, price_cents: int = 1000) -> dict[str, Any]:
    return {
        "place_id": place(n),
        "price_cents": price_cents,
        "tags": ["animals"],
        "dietary_tags": [],
        "rating": 4.5,
        "open_from": None,
        "open_until": None,
        "duration_min": 90,
    }


def slot(key: str, hour: int, candidates: list[int], pinned: bool = False) -> dict[str, Any]:
    return {
        "key": key,
        "starts_at": f"2026-09-26T{hour:02d}:00:00-04:00",
        "ends_at": f"2026-09-26T{hour + 2:02d}:00:00-04:00",
        "together": True,
        "pinned": {"place_id": place(candidates[0]), "member_ids": MEMBERS} if pinned else None,
        "candidates": [candidate(c) for c in candidates],
    }


def plan_request() -> dict[str, Any]:
    return {
        "request_id": "call_123",
        "mode": "initial",
        "members": [{"id": m, "budget_cents": 8000, "dietary": [], "interests": ["animals"]} for m in MEMBERS],
        "slots": [slot("morning", 10, [1, 2, 3]), slot("lunch", 12, [4, 5]), slot("afternoon", 14, [6, 7, 8])],
        "travel": [{"from_place_id": place(1), "to_place_id": place(4), "minutes": 12}],
    }


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("OPTIMIZER_TOKEN", TOKEN)
    return TestClient(app)


def post_plan(client: TestClient, body: dict[str, Any], token: str | None = TOKEN):
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.post("/v1/plan", json=body, headers=headers)


def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_plan_requires_bearer(client: TestClient) -> None:
    for token in (None, "wrong-token"):
        response = post_plan(client, plan_request(), token=token)
        assert response.status_code == 401
        assert response.json() == {"error": {"code": "unauthorized"}}


def test_plan_returns_a_valid_response(client: TestClient) -> None:
    body = plan_request()
    response = post_plan(client, body)
    assert response.status_code == 200
    data = response.json()
    assert data["request_id"] == "call_123"
    assert data["engine"] == "cp_sat"
    assert data["status"] == "optimal"
    assert [p["rank"] for p in data["plans"]] == list(range(1, len(data["plans"]) + 1))
    totals = [p["total_score"] for p in data["plans"]]
    assert totals == sorted(totals, reverse=True)
    for plan in data["plans"]:
        assignments = plan["assignments"]
        assert [a["slot_key"] for a in assignments] == ["morning", "lunch", "afternoon"]
        for assignment, requested in zip(assignments, body["slots"], strict=True):
            assert len(assignment["groups"]) == 1  # every slot here is together
            group = assignment["groups"][0]
            assert sorted(group["member_ids"]) == sorted(MEMBERS)
            assert group["place_id"] in [c["place_id"] for c in requested["candidates"]]
    top = {a["slot_key"]: a["groups"][0]["place_id"] for a in data["plans"][0]["assignments"]}
    options = {s["slot_key"]: s["groups"][0]["options"] for s in data["slot_options"]}
    assert list(options) == ["morning", "lunch", "afternoon"]
    for key, slot_options in options.items():
        assert [o["rank"] for o in slot_options] == list(range(1, len(slot_options) + 1))
        assert slot_options[0]["place_id"] == top[key]
    assert len(options["morning"]) == 3
    assert {o["place_id"] for o in options["lunch"]} == {place(4), place(5)}


def test_plan_on_the_small_request_matches_the_hand_computed_plan(client: TestClient) -> None:
    """The response for tests/fixtures/small_request.json; the numbers are worked out in test_score_table.py."""
    body = json.loads((FIXTURES / "small_request.json").read_text())
    data = post_plan(client, body).json()
    person = [f"00000000-0000-4000-8000-00000000000{n}" for n in range(1, 5)]
    museum, zoo, park, cafe = (f"00000000-0000-4000-8000-00000000010{n}" for n in (1, 2, 3, 4))

    top = data["plans"][0]
    assert (top["rank"], top["split"]) == (1, True)
    assert top["total_score"] == pytest.approx(0.86925)
    assert top["fairness"] == pytest.approx(0.5225)
    assert top["assignments"] == [
        {
            "slot_key": "morning",
            "groups": [
                {"place_id": museum, "member_ids": [person[0], person[3]]},
                {"place_id": zoo, "member_ids": [person[1], person[2]]},
            ],
        },
        {"slot_key": "lunch", "groups": [{"place_id": cafe, "member_ids": person}]},
    ]
    assert top["member_scores"][0] == pytest.approx(
        {"member_id": person[0], "score": 0.58, "preference": 0.5, "cost": 0.5, "travel": 0.1}
    )
    assert [p["total_score"] for p in data["plans"]] == pytest.approx([0.86925, 0.818375, 0.8165])

    # Options per group: its own place first, then each free place it could switch to, scored as that plan.
    # The lunch grill fails Person 2's diet, and the bistro can't be reached from the zoo in time.
    morning, lunch = data["slot_options"]
    assert morning["slot_key"] == "morning"
    art, animals = morning["groups"]
    assert art["member_ids"] == [person[0], person[3]]
    assert [(o["place_id"], o["rank"]) for o in art["options"]] == [(museum, 1), (park, 2)]
    assert art["options"][0] == pytest.approx(
        {
            "place_id": museum,
            "rank": 1,
            "score": 0.86925,
            "preference": 0.85,
            "cost": 0.5,
            "travel": 0.0,
            "fairness": 0.5225,
        }
    )
    assert art["options"][1]["score"] == pytest.approx(0.7365)
    assert [(o["place_id"], o["rank"]) for o in animals["options"]] == [(zoo, 1), (park, 2)]
    assert animals["options"][1]["score"] == pytest.approx(0.787125)
    assert animals["options"][1]["preference"] == pytest.approx(0.175)
    assert lunch["groups"] == [
        {
            "member_ids": person,
            "options": [
                pytest.approx(
                    {
                        "place_id": cafe,
                        "rank": 1,
                        "score": 0.86925,
                        "preference": 0.15,
                        "cost": 0.5,
                        "travel": 0.3,
                        "fairness": 0.5225,
                    }
                )
            ],
        }
    ]


def test_infeasible_plan_is_a_200_with_reasons(client: TestClient) -> None:
    body = json.loads((FIXTURES / "small_request.json").read_text())
    for candidate in body["slots"][1]["candidates"]:
        candidate["dietary_tags"] = []
    response = post_plan(client, body)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "infeasible"
    assert data["plans"] == []
    assert data["slot_options"] == []
    assert data["infeasible_reasons"] == [
        "No lunch option meets {member:00000000-0000-4000-8000-000000000002}'s dietary needs (vegetarian)"
    ]


def test_beyond_the_engine_limits_is_a_422_too_large(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # The request model caps members, slots, and candidates at the same limits, so force the engine's check.
    monkeypatch.setattr(main, "too_large", lambda table: True)
    response = post_plan(client, plan_request())
    assert response.status_code == 422
    assert response.json() == {"error": {"code": "too_large"}}


def test_rejects_four_unpinned_slots(client: TestClient) -> None:
    body = plan_request()
    body["slots"].append(slot("evening", 17, [9]))
    assert post_plan(client, body).status_code == 422
    # A fourth slot is fine when it's pinned context.
    pinned = copy.deepcopy(plan_request())
    pinned["slots"].append(slot("dinner", 19, [9], pinned=True))
    assert post_plan(client, pinned).status_code == 200


def test_pinned_slot_must_have_one_candidate(client: TestClient) -> None:
    body = plan_request()
    body["slots"].append(slot("dinner", 19, [9, 10], pinned=True))
    assert post_plan(client, body).status_code == 422


def test_pinned_members_must_be_request_members(client: TestClient) -> None:
    body = plan_request()
    body["slots"].append(slot("dinner", 19, [9], pinned=True))
    body["slots"][-1]["pinned"]["member_ids"] = [MEMBERS[0], "00000000-0000-4000-8000-000000000099"]
    assert post_plan(client, body).status_code == 422
