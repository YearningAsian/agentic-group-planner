"""Hard-constraint predicates (design §2.2). Scoring applies them when it builds the ScoreTable, so both
engines enforce exactly the same rules."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta

from app.models import Candidate

ARRIVAL_GRACE = timedelta(minutes=15)
# A dessert stop serves food too, and the needs most likely to rule a place out (vegan, nut-free,
# dairy-free) matter there as much as at lunch.
FOOD_CATEGORIES = frozenset({"food", "dessert"})


def is_food(category: str | None) -> bool:
    """Whether dietary needs apply in a slot of this category. An unknown category is not a food slot."""
    return category in FOOD_CATEGORIES


def dietary_ok(needs: Iterable[str], dietary_tags: Iterable[str], food: bool) -> bool:
    """In a food slot, the candidate's dietary tags must cover every one of the member's needs."""
    return not food or set(needs) <= set(dietary_tags)


def budget_ok(total_cents: int, budget_cents: int | None) -> bool:
    """A member's total fits their budget. None means unlimited."""
    return budget_cents is None or total_cents <= budget_cents


def open_ok(candidate: Candidate, start: datetime) -> bool:
    """The candidate is open from the slot's start through start + its duration. Missing hours mean open."""
    end = start + timedelta(minutes=candidate.duration_min)
    opens_in_time = candidate.open_from is None or candidate.open_from <= start
    stays_open = candidate.open_until is None or end <= candidate.open_until
    return opens_in_time and stays_open


def arrival_ok(previous_end: datetime, travel_minutes: int, slot_start: datetime) -> bool:
    """Arriving (previous end + travel) no later than 15 minutes after the slot starts."""
    return previous_end + timedelta(minutes=travel_minutes) <= slot_start + ARRIVAL_GRACE
