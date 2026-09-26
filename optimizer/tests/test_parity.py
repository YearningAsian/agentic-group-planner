"""Both engines, served through /v1/plan, agree on the top plan (design §2.2: one objective, two engines)."""

from __future__ import annotations

import copy
import random
from typing import Any

import pytest

from tests.conftest import PostPlan
from tests.tables import load_json

MEMBER = "00000000-0000-4000-8000-00000000000{}"
INTERESTS = ["art", "history", "food", "animals", "outdoors", "shopping", "music", "museums"]


def place(n: int) -> str:
    return f"00000000-0000-4000-8000-000000001{n:03d}"


def small() -> dict[str, Any]:
    return load_json("small_request.json")


def small_with_pinned_dinner() -> dict[str, Any]:
    """The small request with default weights, plus a booked dinner that only Person 1 to 3 attend."""
    body = small()
    body["params"]["weights"] = {}
    body["slots"].append(
        {
            "key": "dinner",
            "category": "food",
            "starts_at": "2026-10-03T19:00:00-04:00",
            "ends_at": "2026-10-03T20:30:00-04:00",
            "together": True,
            "pinned": {"place_id": place(900), "member_ids": [MEMBER.format(n) for n in (1, 2, 3)]},
            "candidates": [{"place_id": place(900), "price_cents": 2500, "tags": ["food"], "duration_min": 90}],
        }
    )
    lunch = [c["place_id"] for c in body["slots"][1]["candidates"]]
    body["travel"] += [{"from_place_id": p, "to_place_id": place(900), "minutes": 5 * i} for i, p in enumerate(lunch)]
    return body


def at_the_limits() -> dict[str, Any]:
    """6 members, 3 open slots of 6 candidates (lunch together), and a pinned evening. Seeded, so fixed."""
    rng = random.Random(2026)  # noqa: S311 - reproducible test data, not security
    members = [
        {
            "id": MEMBER.format(m + 1),
            "budget_cents": rng.choice([None, 9000, 12000]),
            "dietary": ["vegetarian"] if m == 1 else [],
            "interests": rng.sample(INTERESTS, 2),
        }
        for m in range(6)
    ]
    hours = {"morning": ("09:30", "11:30"), "lunch": ("12:00", "13:00"), "afternoon": ("13:45", "16:45")}
    slots = []
    for s, (key, (start, end)) in enumerate(hours.items()):
        slots.append(
            {
                "key": key,
                "category": "food" if key == "lunch" else "activity",
                "starts_at": f"2026-10-03T{start}:00-04:00",
                "ends_at": f"2026-10-03T{end}:00-04:00",
                "together": key == "lunch",
                "pinned": None,
                "candidates": [
                    {
                        "place_id": place(10 * s + c),
                        "price_cents": rng.choice([0, 1500, 2500, 4000]),
                        "tags": rng.sample(INTERESTS, 2),
                        "dietary_tags": ["vegetarian"] if key == "lunch" and c % 2 == 0 else [],
                        "rating": rng.choice([None, 3.5, 4.0, 4.5, 5.0]),
                        "duration_min": 60 if key == "lunch" else 110,
                    }
                    for c in range(6)
                ],
            }
        )
    slots.append(
        {
            "key": "evening",
            "starts_at": "2026-10-03T17:30:00-04:00",
            "ends_at": "2026-10-03T19:00:00-04:00",
            "together": True,
            "pinned": {"place_id": place(999), "member_ids": [MEMBER.format(n) for n in (1, 2, 3, 4)]},
            "candidates": [{"place_id": place(999), "price_cents": 0, "duration_min": 90}],
        }
    )
    travel = [
        {"from_place_id": a["place_id"], "to_place_id": b["place_id"], "minutes": rng.randint(5, 40)}
        for before, after in zip(slots, slots[1:], strict=False)
        for a in before["candidates"]
        for b in after["candidates"]
    ]
    weights = {"split_penalty": 0.05}  # low enough that splits compete
    return {
        "request_id": "call_limits",
        "mode": "initial",
        "members": members,
        "slots": slots,
        "travel": travel,
        "params": {"weights": weights, "time_limit_ms": 6000},
    }


@pytest.mark.parametrize("fixture", [small, small_with_pinned_dinner, at_the_limits])
def test_parity_top_plan_on_three_fixtures(post_plan: PostPlan, fixture: Any) -> None:
    auto = fixture()
    forced = copy.deepcopy(auto)
    forced["params"]["engine"] = "enumeration"

    cp_sat = post_plan(auto).json()
    enumeration = post_plan(forced).json()

    assert (cp_sat["engine"], cp_sat["status"]) == ("cp_sat", "optimal")
    assert (enumeration["engine"], enumeration["status"]) == ("enumeration", "optimal")
    top, reference = cp_sat["plans"][0], enumeration["plans"][0]
    assert top["assignments"] == reference["assignments"]
    assert top["total_score"] == pytest.approx(reference["total_score"], abs=1e-9)
    assert top["member_scores"] == reference["member_scores"]
