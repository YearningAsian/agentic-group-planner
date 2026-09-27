"""FastAPI entry point. Stateless: every request carries everything the planner needs."""

from __future__ import annotations

import importlib
import logging
import os
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

from app.models import (
    GroupAssignment,
    GroupOptions,
    HealthResponse,
    MemberScore,
    OptionScore,
    Params,
    Plan,
    PlanRequest,
    PlanResponse,
    SlotAssignment,
    SlotOptions,
)
from app.plan_enumerate import enumerate_plans
from app.score_table import (
    Assignment,
    EngineResult,
    EngineUnavailable,
    RankedPlan,
    ScoreTable,
    is_feasible,
    plan_score,
    slot_groups,
    too_large,
)
from app.scoring import build_score_table

logger = logging.getLogger(__name__)

MAX_OPTIONS_PER_GROUP = 3
NO_PLAN_REASON = "No plan meets every constraint at once"


class Unauthorized(Exception):
    """Raised by the bearer check; rendered as 401 with the contract's error body."""


def optimizer_token() -> str:
    token = os.environ.get("OPTIMIZER_TOKEN", "")
    if not token:
        raise RuntimeError("OPTIMIZER_TOKEN is not set. Copy optimizer/.env.example to optimizer/.env and fill it in.")
    return token


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    optimizer_token()  # Fail at boot, not on the first request.
    yield


app = FastAPI(title="Group Trip Agent optimizer", version="0.1.0", lifespan=lifespan)


@app.exception_handler(Unauthorized)
async def unauthorized_handler(_: Request, __: Unauthorized) -> JSONResponse:
    return JSONResponse(status_code=401, content={"error": {"code": "unauthorized"}})


@app.exception_handler(Exception)
async def internal_error_handler(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": {"code": "internal", "request_id": None}})


def require_bearer(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {optimizer_token()}"
    if authorization is None or not secrets.compare_digest(authorization.encode(), expected.encode()):
        raise Unauthorized


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/v1/plan", dependencies=[Depends(require_bearer)], response_model=PlanResponse)
def plan(request: PlanRequest) -> PlanResponse | JSONResponse:
    """Score the request, run the engines, and return up to `max_plans` ranked plans with voting options.

    No plan is a 200 with status infeasible. Input beyond the engine limits is a 422 too_large.
    """
    started = time.perf_counter()
    table = build_score_table(request)
    result = None if too_large(table) else run_engines(table, request.params)
    if result is None or result.status == "too_large":
        return JSONResponse(status_code=422, content={"error": {"code": "too_large"}})
    solve_ms = round((time.perf_counter() - started) * 1000)
    return to_response(request, table, result, solve_ms)


def run_engines(table: ScoreTable, params: Params) -> EngineResult:
    """CP-SAT, unless enumeration is forced, ortools won't import, or the solver can't answer (design §2.2)."""
    if params.engine == "enumeration":
        return enumerate_plans(table, params)
    try:
        # Imported here, not at the top, so a broken ortools install degrades to enumeration.
        cpsat = importlib.import_module("app.plan_cpsat")
    except ImportError:
        logger.warning("ortools failed to import; planning with enumeration", exc_info=True)
        return enumerate_plans(table, params)
    try:
        return cpsat.solve_plans(table, params)
    except EngineUnavailable as error:
        logger.warning("%s; planning with enumeration", error)
        return enumerate_plans(table, params)


def to_response(request: PlanRequest, table: ScoreTable, result: EngineResult, solve_ms: int) -> PlanResponse:
    """Turn an engine's index-based plans into the response, with voting options for the rank-1 plan."""
    reasons = result.infeasible_reasons or ([] if result.plans else [NO_PLAN_REASON])
    return PlanResponse(
        request_id=request.request_id,
        engine=result.engine,
        status="infeasible" if not result.plans else ("optimal" if result.status == "optimal" else "feasible"),
        solve_ms=solve_ms,
        plans=[_plan(table, rank, ranked) for rank, ranked in enumerate(result.plans, start=1)],
        slot_options=_slot_options(table, result.plans[0].assignment, request.params) if result.plans else [],
        infeasible_reasons=reasons,
    )


def _plan(table: ScoreTable, rank: int, ranked: RankedPlan) -> Plan:
    score = ranked.score
    return Plan(
        rank=rank,
        total_score=score.total,
        fairness=score.fairness,
        split=score.split_slots > 0,
        member_scores=[
            MemberScore(member_id=member, score=m.score, preference=m.preference, cost=m.cost, travel=m.travel)
            for member, m in zip(table.members, score.members, strict=True)
        ],
        assignments=[
            SlotAssignment(
                slot_key=slot.key,
                groups=[
                    GroupAssignment(place_id=slot.candidates[c], member_ids=[table.members[m] for m in members])
                    for c, members in slot_groups(choice)
                ],
            )
            for slot, choice in zip(table.slots, ranked.assignment, strict=True)
        ],
    )


def _slot_options(table: ScoreTable, assignment: Assignment, params: Params) -> list[SlotOptions]:
    """Up to 3 options per group in each open slot: the group's own place, then each place no other group
    in the slot uses, if the plan stays feasible with the group moved there. An option's score and fairness
    are that plan's total and lowest member score, so options compare on the objective itself."""
    slot_options = []
    for s, slot in enumerate(table.slots):
        if slot.pinned:
            continue
        groups = slot_groups(assignment[s])
        taken = {c for c, _ in groups}
        group_options = []
        for current, members in groups:
            alternatives = []
            for c in range(len(slot.candidates)):
                if c in taken:
                    continue
                moved = _move(assignment, s, members, c)
                if is_feasible(table, moved, params.min_group_size, params.max_groups_per_slot):
                    alternatives.append((plan_score(table, moved).total, c, moved))
            alternatives.sort(key=lambda a: (-a[0], a[1]))
            choices = [(current, assignment)] + [(c, moved) for _, c, moved in alternatives]
            options = [
                _option(table, s, members, c, rank, option_plan)
                for rank, (c, option_plan) in enumerate(choices[:MAX_OPTIONS_PER_GROUP], start=1)
            ]
            group_options.append(GroupOptions(member_ids=[table.members[m] for m in members], options=options))
        slot_options.append(SlotOptions(slot_key=slot.key, groups=group_options))
    return slot_options


def _move(assignment: Assignment, s: int, members: list[int], c: int) -> Assignment:
    choice = tuple(c if m in members else current for m, current in enumerate(assignment[s]))
    return assignment[:s] + (choice,) + assignment[s + 1 :]


def _option(table: ScoreTable, s: int, members: list[int], c: int, rank: int, option_plan: Assignment) -> OptionScore:
    """The option's plan score, plus the group's mean preference and travel into the slot at this place."""
    score = plan_score(table, option_plan)
    travel = []
    for m in members:
        previous = option_plan[s - 1][m] if s > 0 else None
        travel.append(table.travel[(s, previous, c)] if previous is not None else 0.0)
    return OptionScore(
        place_id=table.slots[s].candidates[c],
        rank=rank,
        score=score.total,
        preference=sum(table.preference.get((m, s, c), 0.0) for m in members) / len(members),
        cost=table.cost.get((s, c), 0.0),
        travel=sum(travel) / len(travel),
        fairness=score.fairness,
    )
