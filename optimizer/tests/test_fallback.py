"""/v1/plan falls back to enumeration exactly when design §2.2 says so: forced by params, ortools won't import,
or the solver reports an invalid model or an unknown status."""

from __future__ import annotations

import importlib
import logging
import sys
from typing import Any

import pytest
from ortools.sat.python import cp_model

from tests.conftest import PostPlan
from tests.tables import load_json

# Rank 1 on the small request: Person 1 and 4 at the museum, Person 2 and 3 at the zoo, lunch at the cafe.
TOP_MORNING = [
    {
        "place_id": "00000000-0000-4000-8000-000000000101",
        "member_ids": [f"00000000-0000-4000-8000-00000000000{n}" for n in (1, 4)],
    },
    {
        "place_id": "00000000-0000-4000-8000-000000000102",
        "member_ids": [f"00000000-0000-4000-8000-00000000000{n}" for n in (2, 3)],
    },
]


def small(engine: str = "auto") -> dict[str, Any]:
    body = load_json("small_request.json")
    body["params"]["engine"] = engine
    return body


def assert_top_plan(data: dict[str, Any]) -> None:
    assert data["status"] == "optimal"
    assert data["plans"][0]["assignments"][0]["groups"] == TOP_MORNING
    assert data["plans"][0]["total_score"] == pytest.approx(0.86925)


def test_engine_enumeration_param_forces_the_fallback(post_plan: PostPlan) -> None:
    forced = post_plan(small("enumeration")).json()
    assert forced["engine"] == "enumeration"
    assert_top_plan(forced)

    auto = post_plan(small("auto")).json()
    assert auto["engine"] == "cp_sat"
    assert_top_plan(auto)


def test_ortools_import_failure_falls_back(
    post_plan: PostPlan, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # A None entry in sys.modules makes that import raise ImportError; monkeypatch restores everything after.
    for name in [n for n in sys.modules if n == "ortools" or n.startswith("ortools.")]:
        monkeypatch.setitem(sys.modules, name, None)
    monkeypatch.setitem(sys.modules, "ortools", None)
    monkeypatch.delitem(sys.modules, "app.plan_cpsat", raising=False)
    with pytest.raises(ImportError):
        importlib.import_module("app.plan_cpsat")

    with caplog.at_level(logging.WARNING, logger="app.main"):
        data = post_plan(small()).json()
    assert data["engine"] == "enumeration"
    assert_top_plan(data)
    assert "ortools failed to import" in caplog.text


@pytest.mark.parametrize("status", [cp_model.UNKNOWN, cp_model.MODEL_INVALID])
def test_unknown_solver_status_falls_back(
    post_plan: PostPlan, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, status: Any
) -> None:
    monkeypatch.setattr(cp_model.CpSolver, "solve", lambda self, model, *args: status)
    with caplog.at_level(logging.WARNING, logger="app.main"):
        data = post_plan(small()).json()
    assert data["engine"] == "enumeration"
    assert_top_plan(data)
    assert status.name in caplog.text
