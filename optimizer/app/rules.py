"""Hard constraints (design §2.2). Each predicate is pure; scoring.build_score_table applies them."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.models import Candidate, Member

#: Place categories with a menu. The request builder puts the place's category in its tags.
FOOD_TAGS = frozenset({"food", "dessert"})
LATE_ARRIVAL = timedelta(minutes=15)


def dietary_ok(member: Member, candidate: Candidate) -> bool:
    """Every dietary need is covered by the candidate's dietary tags. Only food stops have a menu."""
    if FOOD_TAGS.isdisjoint(candidate.tags):
        return True
    return set(member.dietary) <= set(candidate.dietary_tags)


def budget_ok(budget_cents: int | None, total_cents: int) -> bool:
    """None means no budget was set, so anything fits."""
    return budget_cents is None or total_cents <= budget_cents


def open_ok(candidate: Candidate, starts_at: datetime) -> bool:
    """Open from the slot's start through start + the visit's duration. Unknown hours count as open."""
    ends_at = starts_at + timedelta(minutes=candidate.duration_min)
    opens_in_time = candidate.open_from is None or candidate.open_from <= starts_at
    stays_open = candidate.open_until is None or ends_at <= candidate.open_until
    return opens_in_time and stays_open


def arrival_ok(left_previous_at: datetime, travel_minutes: int, starts_at: datetime) -> bool:
    """Arrives no later than 15 minutes after the slot starts."""
    return left_previous_at + timedelta(minutes=travel_minutes) <= starts_at + LATE_ARRIVAL
