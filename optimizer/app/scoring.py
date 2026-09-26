"""The one scoring function (design §2.2): it turns a PlanRequest into the ScoreTable both engines read."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import timedelta
from uuid import UUID

from app import rules
from app.models import PlanRequest
from app.score_table import Key2, Key3, ScoreTable, SlotInfo

TRAVEL_CAP_MINUTES = 45


def preference(interests: Iterable[str], tags: Iterable[str], rating: float | None) -> float:
    """0.7 × the share of the member's interests the place is tagged with, + 0.3 × its rating above 3 stars.

    Matching ignores case. A place with no rating counts as a neutral 3 stars.
    """
    wanted = {i.casefold() for i in interests}
    offered = {t.casefold() for t in tags}
    stars = 3.0 if rating is None else rating
    return 0.7 * len(wanted & offered) / max(1, len(wanted)) + 0.3 * min(1.0, max(0.0, (stars - 3) / 2))


def cost(price_cents: int, highest_cents: int) -> float:
    """The price as a share of the slot's most expensive candidate; 0 when every candidate is free."""
    return price_cents / highest_cents if highest_cents > 0 else 0.0


def travel(minutes: int) -> float:
    """Travel time as a share of 45 minutes, capped at 1."""
    return min(1.0, minutes / TRAVEL_CAP_MINUTES)


def build_score_table(request: PlanRequest) -> ScoreTable:
    """Apply the rules and the scoring terms to every member, slot, and candidate.

    Travel minutes come from the request's edges. A missing edge falls back to the reverse direction, then
    to 0 minutes: the request builder is meant to send every pair, and a gap shouldn't sink the plan. A
    candidate's visit ends at slot start + its duration, which is when travel to the next slot begins.
    """
    w = request.params.weights
    member_index = {m.id: i for i, m in enumerate(request.members)}
    edges = {(e.from_place_id, e.to_place_id): e.minutes for e in request.travel}

    slots: list[SlotInfo] = []
    utility: dict[Key3, float] = {}
    preferences: dict[Key3, float] = {}
    allowed: dict[Key3, bool] = {}
    travel_terms: dict[Key3, float] = {}
    arrivals: dict[Key3, bool] = {}
    prices: dict[Key2, int] = {}
    costs: dict[Key2, float] = {}

    for s, slot in enumerate(request.slots):
        pinned = [member_index[i] for i in slot.pinned.member_ids] if slot.pinned else None
        slots.append(SlotInfo(slot.key, slot.together, [str(c.place_id) for c in slot.candidates], pinned))
        food = rules.is_food(slot.category)
        highest = max(c.price_cents for c in slot.candidates)
        for c, candidate in enumerate(slot.candidates):
            prices[(s, c)] = candidate.price_cents
            costs[(s, c)] = cost(candidate.price_cents, highest)
            is_open = rules.open_ok(candidate, slot.starts_at)
            for m, member in enumerate(request.members):
                liked = preference(member.interests, candidate.tags, candidate.rating)
                preferences[(m, s, c)] = liked
                utility[(m, s, c)] = w.preference * liked - w.cost * costs[(s, c)]
                allowed[(m, s, c)] = is_open and rules.dietary_ok(member.dietary, candidate.dietary_tags, food)

        if s == 0:
            continue
        previous_slot = request.slots[s - 1]
        for p, previous in enumerate(previous_slot.candidates):
            previous_end = previous_slot.starts_at + timedelta(minutes=previous.duration_min)
            for c, candidate in enumerate(slot.candidates):
                minutes = _minutes(edges, previous.place_id, candidate.place_id)
                travel_terms[(s, p, c)] = travel(minutes)
                arrivals[(s, p, c)] = rules.arrival_ok(previous_end, minutes, slot.starts_at)

    return ScoreTable(
        members=[str(m.id) for m in request.members],
        slots=slots,
        utility=utility,
        allowed=allowed,
        travel=travel_terms,
        arrival_ok=arrivals,
        price=prices,
        budget=[m.budget_cents for m in request.members],
        weights=w,
        infeasible_reasons=_infeasible_reasons(request, slots, allowed, prices),
        preference=preferences,
        cost=costs,
    )


def _minutes(edges: dict[tuple[UUID, UUID], int], origin: UUID, destination: UUID) -> int:
    if origin == destination:
        return 0
    return edges.get((origin, destination), edges.get((destination, origin), 0))


def _infeasible_reasons(
    request: PlanRequest, slots: list[SlotInfo], allowed: dict[Key3, bool], prices: dict[Key2, int]
) -> list[str]:
    """Constraints no plan can meet, found slot by slot. They're necessary conditions, not a full proof:
    the engines can still find no plan when these pass. Members appear as {member:<uuid>} tokens, which
    plan_day replaces with display names."""
    reasons: list[str] = []
    members = range(len(request.members))
    open_slots = [s for s, slot in enumerate(slots) if not slot.pinned]

    for s in open_slots:
        slot = request.slots[s]
        candidates = range(len(slot.candidates))
        if not any(rules.open_ok(c, slot.starts_at) for c in slot.candidates):
            reasons.append(f"No {slot.key} option is open for the whole visit")
            continue
        # At least one candidate is open, so a member with nothing allowed is blocked by their diet.
        blocked = [m for m in members if not any(allowed[(m, s, c)] for c in candidates)]
        for m in blocked:
            member = request.members[m]
            needs = ", ".join(member.dietary)
            reasons.append(f"No {slot.key} option meets {{member:{member.id}}}'s dietary needs ({needs})")
        if slot.together and not blocked and not any(all(allowed[(m, s, c)] for m in members) for c in candidates):
            reasons.append(f"No {slot.key} option meets everyone's dietary needs together")

    for m, member in enumerate(request.members):
        if member.budget_cents is None:
            continue
        fixed = sum(prices[(s, 0)] for s, slot in enumerate(slots) if slot.pinned_members and m in slot.pinned_members)
        cheapest_total = fixed
        over_in_a_slot = False
        for s in open_slots:
            options = [prices[(s, c)] for c in range(len(slots[s].candidates)) if allowed[(m, s, c)]]
            if not options:
                continue  # already reported above
            if not rules.budget_ok(fixed + min(options), member.budget_cents):
                reasons.append(f"{{member:{member.id}}}'s budget can't cover any {slots[s].key} option")
                over_in_a_slot = True
            cheapest_total += min(options)
        if not over_in_a_slot and not rules.budget_ok(cheapest_total, member.budget_cents):
            reasons.append(f"{{member:{member.id}}}'s budget can't cover the cheapest plan")
    return reasons
