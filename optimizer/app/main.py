"""FastAPI entry point. Stateless: every request carries everything the planner needs."""

from __future__ import annotations

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
    Plan,
    PlanRequest,
    PlanResponse,
    SlotAssignment,
    SlotOptions,
)

MAX_OPTIONS_PER_GROUP = 3


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


@app.post("/v1/plan", dependencies=[Depends(require_bearer)])
def plan(request: PlanRequest) -> PlanResponse:
    """Stub planner: everyone together at each slot's first candidate. The engines replace it."""
    started = time.perf_counter()
    member_ids = [m.id for m in request.members]
    assignments = [
        SlotAssignment(
            slot_key=s.key,
            groups=[GroupAssignment(place_id=s.candidates[0].place_id, member_ids=member_ids)],
        )
        for s in request.slots
    ]
    slot_options = [
        SlotOptions(
            slot_key=s.key,
            groups=[
                GroupOptions(
                    member_ids=member_ids,
                    options=[
                        OptionScore(
                            place_id=c.place_id, rank=i + 1, score=0, preference=0, cost=0, travel=0, fairness=0
                        )
                        for i, c in enumerate(s.candidates[:MAX_OPTIONS_PER_GROUP])
                    ],
                )
            ],
        )
        for s in request.slots
        if s.pinned is None
    ]
    stub_plan = Plan(
        rank=1,
        total_score=0,
        fairness=0,
        split=False,
        member_scores=[MemberScore(member_id=m, score=0, preference=0, cost=0, travel=0) for m in member_ids],
        assignments=assignments,
    )
    return PlanResponse(
        request_id=request.request_id,
        engine="enumeration",
        status="feasible",
        solve_ms=round((time.perf_counter() - started) * 1000),
        plans=[stub_plan],
        slot_options=slot_options,
        infeasible_reasons=[],
    )
