"""The contract between scoring and the engines (design §2.2).

`scoring.build_score_table(request)` turns a PlanRequest into a ScoreTable. Both engines read only that table,
never the request, and maximize the one objective defined here, `plan_score`. Neither engine computes a score
of its own, so they can be built and tested against fixture tables before scoring exists.

Indices, not IDs, key everything: member `m` is `table.members[m]`, slot `s` is `table.slots[s]`, and
candidate `c` is `table.slots[s].candidates[c]`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.models import Weights

Assignment = tuple[tuple[int | None, ...], ...]
"""`assignment[s][m]` is member m's candidate index in slot s, or None when m isn't part of a pinned slot."""

Key3 = tuple[int, int, int]
Key2 = tuple[int, int]


@dataclass(frozen=True)
class SlotInfo:
    """One slot as the engines see it.

    A pinned slot is fixed context: its only candidate is the pinned place, attended by `pinned_members`
    (member indices). Every member attends every open slot.
    """

    key: str
    together: bool
    candidates: list[str]
    pinned_members: list[int] | None = None

    @property
    def pinned(self) -> bool:
        return self.pinned_members is not None


@dataclass(frozen=True)
class ScoreTable:
    """Everything an engine needs. Built by scoring.build_score_table (AI-203).

    - `utility[m, s, c]`: w_p·preference − w_c·cost.
    - `allowed[m, s, c]`: dietary needs and opening hours, from rules.py. Engines ignore it on pinned slots,
      which are fixed.
    - `travel[s, p, c]`: travel from candidate p of slot s − 1 to candidate c of slot s, 0..1. Slot 0 has none.
    - `arrival_ok[s, p, c]`: same keys; the member arrives within 15 minutes of the slot start.
    - `price[s, c]`: cents per person. `budget[m]`: cents, or None for unlimited. Pinned prices count too.
    - `infeasible_reasons`: found while building; they name members as `{member:<uuid>}`.
    - `preference` and `cost` break `utility` down for the response. Engines never read them.
    """

    members: list[str]
    slots: list[SlotInfo]
    utility: dict[Key3, float]
    allowed: dict[Key3, bool]
    travel: dict[Key3, float]
    arrival_ok: dict[Key3, bool]
    price: dict[Key2, int]
    budget: list[int | None]
    weights: Weights
    infeasible_reasons: list[str]
    preference: dict[Key3, float] = field(default_factory=dict)
    cost: dict[Key2, float] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        """Serialize for fixtures. Tuple keys become comma-joined strings, such as "1,0,2"."""
        return {
            "members": list(self.members),
            "slots": [
                {
                    "key": s.key,
                    "together": s.together,
                    "candidates": list(s.candidates),
                    "pinned_members": s.pinned_members,
                }
                for s in self.slots
            ],
            "utility": _dump(self.utility),
            "allowed": _dump(self.allowed),
            "travel": _dump(self.travel),
            "arrival_ok": _dump(self.arrival_ok),
            "price": _dump(self.price),
            "budget": list(self.budget),
            "weights": self.weights.model_dump(),
            "infeasible_reasons": list(self.infeasible_reasons),
            "preference": _dump(self.preference),
            "cost": _dump(self.cost),
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> ScoreTable:
        """Inverse of `to_json`."""
        return cls(
            members=list(data["members"]),
            slots=[
                SlotInfo(
                    key=s["key"],
                    together=s["together"],
                    candidates=list(s["candidates"]),
                    pinned_members=s.get("pinned_members"),
                )
                for s in data["slots"]
            ],
            utility=_load(data["utility"]),
            allowed=_load(data["allowed"]),
            travel=_load(data["travel"]),
            arrival_ok=_load(data["arrival_ok"]),
            price=_load(data["price"]),
            budget=list(data["budget"]),
            weights=Weights.model_validate(data["weights"]),
            infeasible_reasons=list(data["infeasible_reasons"]),
            preference=_load(data.get("preference", {})),
            cost=_load(data.get("cost", {})),
        )


@dataclass(frozen=True)
class MemberResult:
    """One member's score in a plan, 0..1, with the means of its parts over the slots they attend."""

    score: float
    preference: float
    cost: float
    travel: float


@dataclass(frozen=True)
class PlanScore:
    """The objective's value for one assignment, and what it's made of."""

    total: float
    fairness: float
    split_slots: int
    members: list[MemberResult]


def plan_score(table: ScoreTable, assignment: Assignment) -> PlanScore:
    """The one objective both engines maximize: mean member score + w_f × min − split penalty.

    A member's score is the mean over the slots they attend of w_p·preference − w_c·cost − w_t·travel,
    rescaled from [−(w_c + w_t), w_p] to 0..1. Travel into a slot counts only when the member attended the
    slot right before it; after a pinned slot they weren't part of, where they come from is unknown.
    """
    w = table.weights
    members: list[MemberResult] = []
    for m in range(len(table.members)):
        values: list[float] = []
        preference: list[float] = []
        cost: list[float] = []
        travel: list[float] = []
        previous: int | None = None
        for s, choice in enumerate(assignment):
            c = choice[m]
            if c is None:
                previous = None
                continue
            t = table.travel[(s, previous, c)] if previous is not None else 0.0
            values.append(table.utility[(m, s, c)] - w.travel * t)
            preference.append(table.preference.get((m, s, c), 0.0))
            cost.append(table.cost.get((s, c), 0.0))
            travel.append(t)
            previous = c
        members.append(
            MemberResult(
                score=member_score(w, sum(values), len(values)),
                preference=_mean(preference),
                cost=_mean(cost),
                travel=_mean(travel),
            )
        )
    splits = sum(1 for s, choice in enumerate(assignment) if not table.slots[s].pinned and _group_count(choice) > 1)
    scores = [m.score for m in members]
    return PlanScore(total=combine(w, scores, splits), fairness=min(scores), split_slots=splits, members=members)


def member_score(weights: Weights, value_sum: float, slot_count: int) -> float:
    """Rescale a member's summed slot values to 0..1. Engines that score incrementally call this too, so
    their numbers match plan_score's exactly."""
    if slot_count == 0:
        return 0.0
    span = weights.preference + weights.cost + weights.travel
    return (value_sum / slot_count + weights.cost + weights.travel) / (span or 1.0)


def combine(weights: Weights, member_scores: list[float], split_slots: int) -> float:
    """The plan score from its member scores and split count."""
    mean = sum(member_scores) / len(member_scores)
    return mean + weights.fairness * min(member_scores) - weights.split_penalty * split_slots


def _group_count(choice: tuple[int | None, ...]) -> int:
    return len({c for c in choice if c is not None})


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _dump(table: dict[Any, Any]) -> dict[str, Any]:
    return {",".join(str(i) for i in key): value for key, value in table.items()}


def _load(raw: dict[str, Any]) -> dict[Any, Any]:
    return {tuple(int(i) for i in key.split(",")): value for key, value in raw.items()}
