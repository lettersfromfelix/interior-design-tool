"""Derive walls (centre line + thickness) and their door openings from the plan.

Approach (see README.md in this folder):
1. Walk every edge of every room outline and cast rays across it into the wall poche
   (white-filled cut walls). This gives the poche extent on the outer (tp) and inner (tm)
   side of the edge at 1 cm intervals.
2. Runs of consistent (tp, tm) are wall pieces: thickness = tp + tm, centre line offset =
   (tp - tm) / 2. Interior walls straddle the edge (BWF outlines run along interior wall
   centre lines); exterior walls lie fully outside the edge (the outline is the inner face).
3. Gaps with a door swing arc next to them are door openings and are bridged by the wall.
4. Pieces on the same line with the same thickness are merged, extended into the poche at
   their ends (fills corners / T-junctions) and finally split wherever the rooms on either
   side change, so every wall face belongs to exactly one room.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from geom2d import Region, Vec, add, dot, left_normal, mul, norm, point_in_polygon, sub

CAP_CM = 80.0  # max probing distance into the poche
JUNCTION_CM = 60.0  # extents beyond this mean "we are running along another wall"
MIN_WALL_RUN_CM = 10.0


@dataclass
class Sample:
    s: float  # pt along the edge
    tp: float  # pt of poche along the outward normal
    tm: float  # pt of poche along the inward normal


@dataclass
class Run:
    kind: str  # wall | gap | junction | door
    s0: float
    s1: float
    samples: list = field(default_factory=list)
    door: object = None  # Arc for door gaps

    def thickness(self):
        vals = sorted(x.tp + x.tm for x in self.samples)
        return vals[len(vals) // 2]

    def offset(self):
        vals = sorted((x.tp - x.tm) / 2 for x in self.samples)
        return vals[len(vals) // 2]


@dataclass
class RoomEdge:
    room: str
    index: int
    a: Vec
    b: Vec
    d: Vec  # unit direction a -> b
    n: Vec  # unit outward normal
    length: float  # pt
    neighbor: str | None
    runs: list


@dataclass
class Opening:
    kind: str  # door | window
    s0: float  # pt along the owning wall's direction, measured from wall.start
    s1: float
    arc: object = None
    arcs: list = field(default_factory=list)  # window sashes
    fixed: bool = False


@dataclass
class Wall:
    kind: str  # interior | exterior | party | glazing
    p0: Vec  # centre line start (pt)
    p1: Vec  # centre line end (pt)
    thickness: float  # pt
    openings: list = field(default_factory=list)
    left: str | None = None
    right: str | None = None
    id: str = ""
    core: tuple = None  # (s0, s1) span before end extensions; extensions never cause splits

    def __post_init__(self):
        if self.core is None:
            self.core = (0.0, math.dist(self.p0, self.p1))

    @property
    def d(self):
        return norm(sub(self.p1, self.p0))

    @property
    def length(self):
        return math.dist(self.p0, self.p1)


def sample_room_edges(rooms: dict, poche: Region, K: float, step_cm: float = 1.0):
    cap = CAP_CM / K
    edges = []
    for rid, poly in rooms.items():
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            length = math.dist(a, b)
            if length * K < 8.0:  # tiny jamb details
                continue
            d = norm(sub(b, a))
            n = left_normal(d)
            mid = mul(add(a, b), 0.5)
            if point_in_polygon(add(mid, mul(n, 0.3)), poly):
                n = mul(n, -1)
            probe = add(mid, mul(n, 3.0 / K))
            neighbor = next((r for r, q in rooms.items() if r != rid and point_in_polygon(probe, q)), None)
            samples = []
            s = step_cm / K / 2
            while s < length:
                p = add(a, mul(d, s))
                samples.append(Sample(s, poche.extent(p, n, cap), poche.extent(p, mul(n, -1), cap)))
                s += step_cm / K
            edges.append(RoomEdge(rid, i, a, b, d, n, length, neighbor, _runs(samples, K)))
    return edges


def _runs(samples, K):
    def kind(x):
        if x.tp * K < 1.0 and x.tm * K < 1.0:
            return "gap"
        if x.tp * K >= JUNCTION_CM or x.tm * K >= JUNCTION_CM:
            return "junction"
        return "wall"

    runs: list[Run] = []
    for x in samples:
        k = kind(x)
        if runs and runs[-1].kind == k:
            r = runs[-1]
            if k != "wall" or (
                abs((x.tp + x.tm) - r.thickness()) * K < 1.5 and abs((x.tp - x.tm) / 2 - r.offset()) * K < 1.5
            ):
                r.s1 = x.s
                r.samples.append(x)
                continue
        runs.append(Run(k, x.s, x.s, [x]))
    # short "walls" are junction ramps (diagonal joints, wall ends crossing the edge)
    for r in runs:
        if r.kind == "wall" and (r.s1 - r.s0) * K < MIN_WALL_RUN_CM:
            r.kind = "junction"
    # merge neighbouring runs of the same kind again
    merged: list[Run] = []
    for r in runs:
        if merged and merged[-1].kind == r.kind and r.kind != "wall":
            merged[-1].s1 = r.s1
            merged[-1].samples += r.samples
        else:
            merged.append(r)
    return merged


def attach_doors(edges, door_arcs, K):
    """Mark gap runs that have a door swing arc at one of their ends as door runs."""
    for e in edges:
        for r in e.runs:
            if r.kind != "gap":
                continue
            for arc in door_arcs:
                rel = sub(arc.center, e.a)
                s = dot(rel, e.d)
                off = abs(dot(rel, e.n))
                if off * K > 25.0:
                    continue
                if (r.s0 * K - 15.0) <= s * K <= (r.s1 * K + 15.0):
                    r.kind = "door"
                    r.door = arc
                    break
