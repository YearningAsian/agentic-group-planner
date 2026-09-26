"""Scoring terms and build_score_table (design §2.2). Every term is normalized to 0..1, and the result
is deterministic for a given request."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from app.models import Candidate, Member, PlanRequest
from app.rules import arrival_ok, budget_ok, dietary_ok, open_ok
from app.score_table import Key2, Key3, ScoreTable, SlotInfo

TRAVEL_CAP_MINUTES = 45


def preference(member: Member, candidate: Candidate) -> float:
    """0.7 × the share of the member's interests the place matches + 0.3 × its rating above 3 stars."""
    interests = set(member.interests)
    matched = len(interests & set(candidate.tags)) / max(1, len(interests))
    rating = 0.0 if candidate.rating is None else min(1.0, max(0.0, (candidate.rating - 3) / 2))
    return 0.7 * matched + 0.3 * rating


def cost(price_cents: int, highest_price_cents: int) -> float:
    """The price relative to the slot's most expensive candidate; 0 when every candidate is free."""
    return 0.0 if highest_price_cents == 0 else price_cents / highest_price_cents


def travel(minutes: int) -> float:
    return min(1.0, minutes / TRAVEL_CAP_MINUTES)


def build_score_table(request: PlanRequest) -> ScoreTable:
    """Turns a request into the table both engines read. Raises ValueError when a travel time is missing."""
    members, slots = request.members, request.slots
    member_index = {member.id: m for m, member in enumerate(members)}
    edges = {(edge.from_place_id, edge.to_place_id): edge.minutes for edge in request.travel}

    def minutes_between(origin: UUID, destination: UUID) -> int:
        if origin == destination:
            return 0
        if (origin, destination) not in edges:
            raise ValueError(f"no travel time from {origin} to {destination}")
        return edges[(origin, destination)]

    preference_of: dict[Key3, float] = {}
    allowed: dict[Key3, bool] = {}
    cost_of: dict[Key2, float] = {}
    price: dict[Key2, int] = {}
    for s, slot in enumerate(slots):
        highest = max(option.price_cents for option in slot.candidates)
        for c, option in enumerate(slot.candidates):
            cost_of[(s, c)] = cost(option.price_cents, highest)
            price[(s, c)] = option.price_cents
            is_open = open_ok(option, slot.starts_at)
            for m, member in enumerate(members):
                preference_of[(m, s, c)] = preference(member, option)
                allowed[(m, s, c)] = is_open and dietary_ok(member, option)

    travel_of: dict[Key3, float] = {}
    arrives: dict[Key3, bool] = {}
    for s in range(1, len(slots)):
        before, slot = slots[s - 1], slots[s]
        for p, previous in enumerate(before.candidates):
            left_at = before.starts_at + timedelta(minutes=previous.duration_min)
            for c, option in enumerate(slot.candidates):
                minutes = minutes_between(previous.place_id, option.place_id)
                travel_of[(s, p, c)] = travel(minutes)
                arrives[(s, p, c)] = arrival_ok(left_at, minutes, slot.starts_at)

    return ScoreTable(
        members=tuple(str(member.id) for member in members),
        slots=tuple(
            SlotInfo(
                key=slot.key,
                together=slot.together,
                pinned_members=None
                if slot.pinned is None
                else tuple(member_index[member_id] for member_id in slot.pinned.member_ids),
                candidates=tuple(str(option.place_id) for option in slot.candidates),
            )
            for slot in slots
        ),
        preference=preference_of,
        cost=cost_of,
        allowed=allowed,
        travel=travel_of,
        arrival_ok=arrives,
        price=price,
        budget=tuple(member.budget_cents for member in members),
        weights=request.params.weights,
        infeasible_reasons=_infeasible_reasons(request, allowed, price),
    )


def _infeasible_reasons(request: PlanRequest, allowed: dict[Key3, bool], price: dict[Key2, int]) -> tuple[str, ...]:
    """Why some member can't have any plan, found before an engine runs. Only open slots count: a pinned
    slot is context, and its price is already paid."""
    reasons: list[str] = []

    def add(reason: str) -> None:
        if reason not in reasons:
            reasons.append(reason)

    open_slots = [(s, slot) for s, slot in enumerate(request.slots) if slot.pinned is None]
    for m, member in enumerate(request.members):
        token = f"{{member:{member.id}}}"
        cheapest: list[tuple[str, int]] = []
        for s, slot in open_slots:
            prices = [price[(s, c)] for c in range(len(slot.candidates)) if allowed[(m, s, c)]]
            if prices:
                cheapest.append((slot.key, min(prices)))
            elif not any(dietary_ok(member, option) for option in slot.candidates):
                add(f"{token} has no {slot.key} option that fits their dietary needs")
            else:
                add(f"No {slot.key} option is open then")
        if len(cheapest) < len(open_slots):
            continue  # already explained above
        short = [key for key, cents in cheapest if not budget_ok(member.budget_cents, cents)]
        for key in short:
            add(f"{token}'s budget can't cover any {key} option")
        if not short and not budget_ok(member.budget_cents, sum(cents for _, cents in cheapest)):
            add(f"{token}'s budget can't cover a stop in every slot")
    return tuple(reasons)
