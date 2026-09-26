"""Shared fixtures for tests that call the HTTP API."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app

TOKEN = "test-token"

PostPlan = Callable[[dict[str, Any]], httpx.Response]


@pytest.fixture
def post_plan(monkeypatch: pytest.MonkeyPatch) -> PostPlan:
    """POST /v1/plan with a valid bearer token."""
    monkeypatch.setenv("OPTIMIZER_TOKEN", TOKEN)
    client = TestClient(app)

    def post(body: dict[str, Any]) -> httpx.Response:
        return client.post("/v1/plan", json=body, headers={"Authorization": f"Bearer {TOKEN}"})

    return post
