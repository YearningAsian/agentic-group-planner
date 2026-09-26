"""HTTP contract of the optimizer: auth, validation limits, and the plan stub's response shape."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app

TOKEN = "test-token"
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


def test_plan_stub_returns_valid_response(client: TestClient) -> None:
    body = plan_request()
    response = post_plan(client, body)
    assert response.status_code == 200
    data = response.json()
    assert data["request_id"] == "call_123"
    assert data["engine"] == "enumeration"
    assert data["status"] == "feasible"
    assert len(data["plans"]) == 1
    assignments = data["plans"][0]["assignments"]
    assert [a["slot_key"] for a in assignments] == ["morning", "lunch", "afternoon"]
    for assignment, requested in zip(assignments, body["slots"], strict=True):
        assert len(assignment["groups"]) == 1
        group = assignment["groups"][0]
        assert sorted(group["member_ids"]) == sorted(MEMBERS)
        assert group["place_id"] == requested["candidates"][0]["place_id"]
    options = {s["slot_key"]: s["groups"][0]["options"] for s in data["slot_options"]}
    assert [o["rank"] for o in options["morning"]] == [1, 2, 3]
    assert [o["place_id"] for o in options["lunch"]] == [place(4), place(5)]


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
