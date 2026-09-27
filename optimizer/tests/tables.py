"""Score tables for engine tests: the hand-checked small fixture, and seeded random tables of any size."""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from app.models import Weights
from app.score_table import Assignment, Key2, Key3, ScoreTable, SlotInfo

FIXTURES = Path(__file__).parent / "fixtures"


def load_json(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def small_table() -> ScoreTable:
    return ScoreTable.from_json(load_json("small_table.json"))


def small_expected() -> list[dict[str, Any]]:
    return load_json("small_expected.json")["plans"]


def as_assignment(rows: list[list[int | None]]) -> Assignment:
    return tuple(tuple(row) for row in rows)


def random_table(
    members: int = 4,
    open_slots: int = 2,
    candidates: int = 3,
    *,
    seed: int = 0,
    together: tuple[int, ...] = (),
    pinned: tuple[int, list[int]] | None = None,
    weights: Weights | None = None,
    budget: int | None = None,
    shared_places: bool = False,
) -> ScoreTable:
    """A table with random utilities, about 10% of choices disallowed, and about 10% of arrivals late.

    `together` lists open-slot indices that are together slots. `pinned` inserts a pinned slot at a
    position, attended by the given members. Values are rounded to 3 decimals, like hand-written fixtures.
    With `shared_places`, every slot offers the same places, and a pinned slot holds place 0.
    """
    rng = random.Random(seed)  # noqa: S311 - reproducible test data, not security

    def place(s: int, c: int) -> str:
        return f"place-{c}" if shared_places else f"place-{s}-{c}"

    slots = [SlotInfo(f"slot{s}", s in together, [place(s, c) for c in range(candidates)]) for s in range(open_slots)]
    if pinned is not None:
        position, pinned_members = pinned
        pinned_place = "place-0" if shared_places else "place-pinned"
        slots.insert(position, SlotInfo("pinned", True, [pinned_place], list(pinned_members)))

    utility: dict[Key3, float] = {}
    allowed: dict[Key3, bool] = {}
    travel: dict[Key3, float] = {}
    arrival_ok: dict[Key3, bool] = {}
    price: dict[Key2, int] = {}
    for s, slot in enumerate(slots):
        for c in range(len(slot.candidates)):
            price[(s, c)] = rng.choice([0, 1000, 2000, 3000, 4000])
            for m in range(members):
                utility[(m, s, c)] = round(rng.uniform(-0.6, 1.0), 3)
                allowed[(m, s, c)] = rng.random() > 0.1
            if s > 0:
                for p in range(len(slots[s - 1].candidates)):
                    travel[(s, p, c)] = round(rng.random(), 3)
                    arrival_ok[(s, p, c)] = rng.random() > 0.1
    return ScoreTable(
        members=[f"member-{m}" for m in range(members)],
        slots=slots,
        utility=utility,
        allowed=allowed,
        travel=travel,
        arrival_ok=arrival_ok,
        price=price,
        budget=[budget] * members,
        weights=weights or Weights(),
        infeasible_reasons=[],
    )
