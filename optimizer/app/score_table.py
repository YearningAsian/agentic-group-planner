"""The contract between scoring and the engines (design §2.2).

`scoring.build_score_table` turns a PlanRequest into a ScoreTable. Both engines read only the table and
maximize `plan_score`, so neither reads the request or computes a score of its own, and they can be
built and tested against fixture tables.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean
from typing import Any

from app.models import Weights

Key2 = tuple[int, int]
Key3 = tuple[int, int, int]


@dataclass(frozen=True)
class SlotInfo:
    key: str
    together: bool
    #: Member indices of a pinned slot, whose only candidate (index 0) is the pinned place. None when open.
    pinned_members: tuple[int, ...] | None
    #: Place IDs, in the request's order.
    candidates: tuple[str, ...]


@dataclass(frozen=True)
class Group:
    candidate: int
    members: tuple[int, ...]


#: The groups of each slot, in slot order. A member missing from a slot (a pinned slot they skip) has no
#: stop there.
Assignment = tuple[tuple[Group, ...], ...]


@dataclass(frozen=True)
class MemberScore:
    #: 0..1: the member's mean slot value, rescaled.
    score: float
    #: Means over the member's slots of the raw 0..1 terms, reported in PlanResponse.
    preference: float
    cost: float
    travel: float


@dataclass(frozen=True)
class PlanScore:
    total: float
    #: The lowest member score.
    fairness: float
    split_slots: int
    members: tuple[MemberScore, ...]

    @property
    def split(self) -> bool:
        return self.split_slots > 0


def _key(parts: tuple[int, ...]) -> str:
    return ",".join(map(str, parts))


def _unkey(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split(","))


@dataclass(frozen=True)
class ScoreTable:
    """Everything an engine needs. Built by `scoring.build_score_table`.

    Indices: member m and slot s in request order, candidate c in its slot's order.
    """

    members: tuple[str, ...]
    slots: tuple[SlotInfo, ...]
    #: (m, s, c) → 0..1
    preference: dict[Key3, float]
    #: (s, c) → 0..1, the price relative to the slot's most expensive candidate.
    cost: dict[Key2, float]
    #: (m, s, c) → dietary needs and opening hours both allow it (rules.py).
    allowed: dict[Key3, bool]
    #: (s, previous candidate, c) → 0..1, for s ≥ 1.
    travel: dict[Key3, float]
    #: Same keys as travel: arrives no later than 15 minutes after the slot starts.
    arrival_ok: dict[Key3, bool]
    #: (s, c) → cents per person.
    price: dict[Key2, int]
    #: Per member; None means unlimited.
    budget: tuple[int | None, ...]
    weights: Weights
    #: Found while building. Members appear as {member:<uuid>} tokens, which plan_day replaces with names.
    infeasible_reasons: tuple[str, ...]

    def utility(self, m: int, s: int, c: int) -> float:
        """w_p·preference − w_c·cost: the part of a member's slot value that doesn't depend on the route."""
        return self.weights.preference * self.preference[(m, s, c)] - self.weights.cost * self.cost[(s, c)]

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> ScoreTable:
        """Reads the fixture format: tuple keys are written as "m,s,c" strings."""
        return cls(
            members=tuple(raw["members"]),
            slots=tuple(
                SlotInfo(
                    key=slot["key"],
                    together=slot["together"],
                    pinned_members=None if slot["pinned_members"] is None else tuple(slot["pinned_members"]),
                    candidates=tuple(slot["candidates"]),
                )
                for slot in raw["slots"]
            ),
            preference={_unkey(k): v for k, v in raw["preference"].items()},
            cost={_unkey(k): v for k, v in raw["cost"].items()},
            allowed={_unkey(k): v for k, v in raw["allowed"].items()},
            travel={_unkey(k): v for k, v in raw["travel"].items()},
            arrival_ok={_unkey(k): v for k, v in raw["arrival_ok"].items()},
            price={_unkey(k): v for k, v in raw["price"].items()},
            budget=tuple(raw["budget"]),
            weights=Weights.model_validate(raw["weights"]),
            infeasible_reasons=tuple(raw["infeasible_reasons"]),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "members": list(self.members),
            "slots": [
                {
                    "key": slot.key,
                    "together": slot.together,
                    "pinned_members": None if slot.pinned_members is None else list(slot.pinned_members),
                    "candidates": list(slot.candidates),
                }
                for slot in self.slots
            ],
            "preference": {_key(k): v for k, v in self.preference.items()},
            "cost": {_key(k): v for k, v in self.cost.items()},
            "allowed": {_key(k): v for k, v in self.allowed.items()},
            "travel": {_key(k): v for k, v in self.travel.items()},
            "arrival_ok": {_key(k): v for k, v in self.arrival_ok.items()},
            "price": {_key(k): v for k, v in self.price.items()},
            "budget": list(self.budget),
            "weights": self.weights.model_dump(),
            "infeasible_reasons": list(self.infeasible_reasons),
        }


def plan_score(table: ScoreTable, assignment: Assignment) -> PlanScore:
    """The one objective both engines maximize: mean member score + w_f × min − split penalty.

    A member's slot value is w_p·preference − w_c·cost − w_t·travel, where travel comes from their stop in
    the previous slot (0 when they had none). Their score is the mean value over their slots, rescaled
    from [−(w_c + w_t), w_p] to 0..1. Feasibility is the engines' job; this only scores.
    """
    w = table.weights
    stops: list[dict[int, int]] = [{m: g.candidate for g in groups for m in g.members} for groups in assignment]
    low, high = -(w.cost + w.travel), w.preference

    members: list[MemberScore] = []
    for m in range(len(table.members)):
        prefs: list[float] = []
        costs: list[float] = []
        travels: list[float] = []
        for s, where in enumerate(stops):
            c = where.get(m)
            if c is None:
                continue
            previous = stops[s - 1].get(m) if s > 0 else None
            prefs.append(table.preference[(m, s, c)])
            costs.append(table.cost[(s, c)])
            travels.append(0.0 if previous is None else table.travel[(s, previous, c)])
        preference, cost, travel = mean(prefs), mean(costs), mean(travels)
        value = w.preference * preference - w.cost * cost - w.travel * travel
        members.append(MemberScore((value - low) / (high - low), preference, cost, travel))

    scores = [member.score for member in members]
    fairness = min(scores)
    split_slots = sum(1 for groups in assignment if len(groups) > 1)
    total = mean(scores) + w.fairness * fairness - w.split_penalty * split_slots
    return PlanScore(total, fairness, split_slots, tuple(members))
