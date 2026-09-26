"""Request and response models for the optimizer. They are the source of the OpenAPI spec that
`pnpm api:types` turns into TypeScript for the web app."""

from __future__ import annotations

from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

MAX_UNPINNED_SLOTS = 3

Dietary = Literal["vegetarian", "vegan", "gluten_free", "halal", "kosher", "nut_free", "dairy_free"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Member(Model):
    id: UUID
    budget_cents: int | None = Field(default=None, ge=0, description="Remaining budget for these slots.")
    dietary: list[Dietary] = []
    interests: list[str] = []


class Pinned(Model):
    place_id: UUID
    member_ids: list[UUID] = Field(min_length=1)


class Candidate(Model):
    place_id: UUID
    price_cents: int = Field(ge=0, description="Per person.")
    tags: list[str] = []
    dietary_tags: list[Dietary] = []
    rating: float | None = Field(default=None, ge=0, le=5)
    open_from: AwareDatetime | None = None
    open_until: AwareDatetime | None = None
    duration_min: int = Field(gt=0)


class Slot(Model):
    key: str = Field(min_length=1)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    together: bool
    pinned: Pinned | None = Field(description="Set for booked or pinned context slots.")
    candidates: list[Candidate] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def check_slot(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.pinned is not None:
            if len(self.candidates) != 1:
                raise ValueError("a pinned slot has exactly one candidate")
            if self.candidates[0].place_id != self.pinned.place_id:
                raise ValueError("a pinned slot's candidate is the pinned place")
        return self


class TravelEdge(Model):
    from_place_id: UUID
    to_place_id: UUID
    minutes: int = Field(ge=0)


class Weights(Model):
    preference: float = 1.0
    cost: float = 0.6
    travel: float = 0.4
    fairness: float = 0.8
    split_penalty: float = 0.3


class Params(Model):
    max_plans: int = Field(default=3, ge=1, le=3)
    min_group_size: int = Field(default=2, ge=1)
    max_groups_per_slot: int = Field(default=2, ge=1, le=2)
    weights: Weights = Weights()
    time_limit_ms: int = Field(default=2000, ge=100, le=10_000)
    engine: Literal["auto", "enumeration"] = Field(
        default="auto", description="`enumeration` forces the fallback engine (tests)."
    )


class PlanRequest(Model):
    request_id: str = Field(min_length=1, description="The tool-call ID; echoed and logged.")
    mode: Literal["initial", "replan"]
    members: list[Member] = Field(min_length=2, max_length=6)
    slots: list[Slot] = Field(min_length=1, max_length=5, description="In time order.")
    travel: list[TravelEdge]
    params: Params = Params()

    @model_validator(mode="after")
    def check_slots(self) -> Self:
        unpinned = sum(1 for s in self.slots if s.pinned is None)
        if unpinned > MAX_UNPINNED_SLOTS:
            raise ValueError(f"at most {MAX_UNPINNED_SLOTS} unpinned slots, got {unpinned}")
        keys = [s.key for s in self.slots]
        if len(set(keys)) != len(keys):
            raise ValueError("slot keys must be unique")
        return self


class MemberScore(Model):
    member_id: UUID
    score: float
    preference: float
    cost: float
    travel: float


class GroupAssignment(Model):
    place_id: UUID
    member_ids: list[UUID]


class SlotAssignment(Model):
    slot_key: str
    groups: list[GroupAssignment]


class Plan(Model):
    rank: int = Field(ge=1, le=3)
    total_score: float
    fairness: float = Field(description="The lowest member score.")
    split: bool
    member_scores: list[MemberScore]
    assignments: list[SlotAssignment]


class OptionScore(Model):
    place_id: UUID
    rank: int = Field(ge=1)
    score: float
    preference: float
    cost: float
    travel: float
    fairness: float


class GroupOptions(Model):
    member_ids: list[UUID]
    options: list[OptionScore]


class SlotOptions(Model):
    slot_key: str
    groups: list[GroupOptions]


class PlanResponse(Model):
    request_id: str
    engine: Literal["cp_sat", "enumeration"]
    status: Literal["optimal", "feasible", "infeasible"]
    solve_ms: int = Field(ge=0)
    plans: list[Plan] = Field(max_length=3)
    slot_options: list[SlotOptions] = Field(description="Voting options per group, for the rank-1 plan.")
    infeasible_reasons: list[str]


class HealthResponse(Model):
    status: Literal["ok"]
