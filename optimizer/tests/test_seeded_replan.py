"""The seeded replan (design §11.3, item 3): dinner booked at 19:45 moves the afternoon to 15:00–18:00
Atlanta time. The request builder computed the shift; these tests assert it and that the rank-1
plan keeps every stop open for its whole visit."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parents[2] / "web" / "scripts" / "demo" / "fixtures"


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def test_seeded_replan_shifts_the_afternoon() -> None:
    initial = {s["key"]: s for s in _fixture("requests/saturday-initial.json")["slots"]}
    replan = {s["key"]: s for s in _fixture("requests/saturday-replan.json")["slots"]}
    # 15:00–18:00 in Atlanta (EDT, UTC-4).
    afternoon = replan["afternoon"]
    assert (afternoon["starts_at"], afternoon["ends_at"]) == ("2026-10-03T19:00:00.000Z", "2026-10-03T22:00:00.000Z")
    for key in ("morning", "lunch"):
        before, after = initial[key], replan[key]
        assert (after["starts_at"], after["ends_at"]) == (before["starts_at"], before["ends_at"]), key


def test_seeded_replan_respects_opening_hours(post_plan: Any) -> None:
    request = _fixture("requests/saturday-replan.json")
    response = post_plan(request)
    assert response.status_code == 200, response.text
    plans = response.json()["plans"]
    assert plans, "the replan found no plan"
    rank1 = next(p for p in plans if p["rank"] == 1)
    slots = {s["key"]: s for s in request["slots"]}
    for assignment in rank1["assignments"]:
        slot = slots[assignment["slot_key"]]
        candidates = {c["place_id"]: c for c in slot["candidates"]}
        start = _at(slot["starts_at"])
        for group in assignment["groups"]:
            place = candidates[group["place_id"]]
            end = start + timedelta(minutes=place["duration_min"])
            if place.get("open_from"):
                assert _at(place["open_from"]) <= start, (slot["key"], place["place_id"])
            if place.get("open_until"):
                assert end <= _at(place["open_until"]), (slot["key"], place["place_id"])
