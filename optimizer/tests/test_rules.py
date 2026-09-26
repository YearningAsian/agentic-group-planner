"""Hard-constraint predicates (design §2.2): dietary needs, budget, opening hours, and arrival."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.models import Candidate, Member
from app.rules import arrival_ok, budget_ok, dietary_ok, open_ok

NOON = datetime.fromisoformat("2026-10-03T12:00:00+00:00")


def member(**overrides: Any) -> Member:
    return Member.model_validate({"id": "00000000-0000-4000-8000-000000000001", **overrides})


def candidate(**overrides: Any) -> Candidate:
    fields: dict[str, Any] = {
        "place_id": "00000000-0000-4000-8000-000000000101",
        "price_cents": 1000,
        "duration_min": 60,
    }
    return Candidate.model_validate({**fields, **overrides})


def test_dietary_needs_tags_on_food_slots_only() -> None:
    vegetarian = member(dietary=["vegetarian"])

    assert dietary_ok(vegetarian, candidate(tags=["food"], dietary_tags=["vegetarian", "vegan"]))
    assert not dietary_ok(vegetarian, candidate(tags=["food"], dietary_tags=[]))
    assert not dietary_ok(vegetarian, candidate(tags=["dessert"], dietary_tags=["gluten_free"]))
    # A museum has no menu, so dietary needs don't apply.
    assert dietary_ok(vegetarian, candidate(tags=["art"], dietary_tags=[]))
    assert dietary_ok(member(dietary=[]), candidate(tags=["food"], dietary_tags=[]))


def test_null_budget_means_unlimited() -> None:
    assert budget_ok(None, 1_000_000)
    assert budget_ok(4000, 4000)
    assert not budget_ok(4000, 4001)


def test_open_through_start_plus_duration() -> None:
    hours = {"open_from": "2026-10-03T11:00:00Z", "open_until": "2026-10-03T13:00:00Z"}

    assert open_ok(candidate(**hours, duration_min=60), NOON)
    assert not open_ok(candidate(**hours, duration_min=61), NOON)
    assert not open_ok(candidate(**hours), NOON - timedelta(hours=1, minutes=1))
    assert open_ok(candidate(open_from=None, open_until=None, duration_min=600), NOON)


def test_arrival_allows_15_minutes_late() -> None:
    left_at = NOON - timedelta(minutes=30)

    assert arrival_ok(left_at, 45, NOON)
    assert not arrival_ok(left_at, 46, NOON)
    assert arrival_ok(left_at, 0, NOON)
