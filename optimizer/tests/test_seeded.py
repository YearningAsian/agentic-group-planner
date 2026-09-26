"""The seeded Saturday trip: every ranked option is feasible. Which option wins is Muse's call, so
no exact plan is pinned (design §11.7, item 6)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parents[2] / "web" / "scripts" / "demo" / "fixtures"
FOOD = {"food", "dessert"}


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _groups(plan: dict[str, Any]) -> dict[str, set[tuple[str, tuple[str, ...]]]]:
    """Compare assignments without depending on the engine's group or member ordering."""
    return {
        slot["slot_key"]: {(group["place_id"], tuple(sorted(group["member_ids"]))) for group in slot["groups"]}
        for slot in plan["assignments"]
    }


def _seeded(post_plan: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    request = _fixture("requests/saturday-initial.json")
    response = post_plan(request)
    assert response.status_code == 200, response.text
    return request, response.json()


def _problems(request: dict[str, Any], plan: dict[str, Any]) -> list[str]:
    members = {m["id"]: m for m in request["members"]}
    slots = {s["key"]: s for s in request["slots"]}
    spent = dict.fromkeys(members, 0)
    visited: dict[str, set[str]] = {m: set() for m in members}
    problems = []
    for assignment in plan["assignments"]:
        slot = slots[assignment["slot_key"]]
        candidates = {c["place_id"]: c for c in slot["candidates"]}
        seated = [m for g in assignment["groups"] for m in g["member_ids"]]
        if sorted(seated) != sorted(members):
            problems.append(f"{slot['key']}: members {sorted(seated)}")
        if slot["together"] and len(assignment["groups"]) != 1:
            problems.append(f"{slot['key']}: split in a together slot")
        for group in assignment["groups"]:
            place = candidates[group["place_id"]]
            for m in group["member_ids"]:
                spent[m] += place["price_cents"]
                if place["place_id"] in visited[m]:
                    problems.append(f"{slot['key']}: {m} revisits {place['place_id']}")
                visited[m].add(place["place_id"])
                if slot["category"] in FOOD and not set(members[m]["dietary"]) <= set(place["dietary_tags"]):
                    problems.append(f"{slot['key']}: {place['place_id']} misses {m}'s dietary needs")
    for m, total in spent.items():
        budget = members[m]["budget_cents"]
        if budget is not None and total > budget:
            problems.append(f"{m} spends {total} over {budget}")
    return problems


def test_seeded_trip_options(post_plan: Any) -> None:
    request, result = _seeded(post_plan)
    assert result["engine"] == "cp_sat"
    assert result["solve_ms"] < 2000
    plans = result["plans"]
    assert 2 <= len(plans) <= 3
    assert len({json.dumps(sorted((k, sorted(v)) for k, v in _groups(p).items())) for p in plans}) == len(plans)
    assert [p["rank"] for p in plans] == list(range(1, len(plans) + 1))
    for plan in plans:
        assert _problems(request, plan) == [], plan["rank"]


def test_seeded_trip_has_a_dietary_need_to_respect() -> None:
    request = _fixture("requests/saturday-initial.json")
    assert any(m["dietary"] for m in request["members"])
    assert any(s["category"] in FOOD for s in request["slots"])


def test_mock_plan_is_feasible() -> None:
    """The recorded demo plan (a split afternoon) is one Muse may pick; it must break no hard rule."""
    request = _fixture("requests/saturday-initial.json")
    for plan in _fixture("mock-plan.json")["response"]["plans"]:
        assert _problems(request, plan) == [], plan["rank"]
