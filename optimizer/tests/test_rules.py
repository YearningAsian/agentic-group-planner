"""Hard-constraint predicates shared by both engines (design §2.2)."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.models import Candidate
from app.rules import arrival_ok, budget_ok, dietary_ok, is_food, open_ok

START = datetime.fromisoformat("2026-10-03T10:30:00-04:00")


def candidate(open_from: str | None, open_until: str | None, duration_min: int) -> Candidate:
    return Candidate(
        place_id="00000000-0000-4000-8000-000000000101",
        price_cents=0,
        open_from=open_from and datetime.fromisoformat(open_from),
        open_until=open_until and datetime.fromisoformat(open_until),
        duration_min=duration_min,
    )


def test_dietary_needs_tags_on_food_slots_only() -> None:
    assert is_food("food")
    assert is_food("dessert")
    assert not is_food("activity")
    assert not is_food(None)

    # Outside a food slot, dietary needs don't restrict anything.
    assert dietary_ok(["vegetarian"], [], food=False)
    # In a food slot, every need must be covered by the candidate's tags.
    assert not dietary_ok(["vegetarian"], [], food=True)
    assert dietary_ok(["vegetarian"], ["vegetarian", "vegan"], food=True)
    assert not dietary_ok(["vegan", "gluten_free"], ["vegan"], food=True)
    assert dietary_ok([], [], food=True)


def test_null_budget_means_unlimited() -> None:
    assert budget_ok(1_000_000_00, None)
    assert budget_ok(8000, 8000)
    assert not budget_ok(8001, 8000)


def test_open_through_start_plus_duration() -> None:
    # 10:30 + 90 min is 12:00, exactly when it closes.
    assert open_ok(candidate("2026-10-03T09:00:00-04:00", "2026-10-03T12:00:00-04:00", 90), START)
    assert not open_ok(candidate("2026-10-03T09:00:00-04:00", "2026-10-03T12:00:00-04:00", 91), START)
    assert not open_ok(candidate("2026-10-03T10:31:00-04:00", None, 30), START)
    assert open_ok(candidate(None, None, 600), START)
    # Hours in another offset compare as instants.
    assert open_ok(candidate("2026-10-03T14:30:00+00:00", "2026-10-03T16:00:00+00:00", 90), START)


def test_arrival_allows_15_minutes_late() -> None:
    previous_end = datetime.fromisoformat("2026-10-03T12:00:00-04:00")
    slot_start = datetime.fromisoformat("2026-10-03T12:15:00-04:00")
    assert arrival_ok(previous_end, 30, slot_start)  # 12:30, 15 min late
    assert not arrival_ok(previous_end, 31, slot_start)
    assert arrival_ok(previous_end - timedelta(hours=1), 0, slot_start)  # early is fine
