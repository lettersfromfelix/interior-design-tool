"""Small 2D geometry helpers for the floor-plan extraction (PDF point space)."""
from __future__ import annotations

import math

Vec = tuple[float, float]


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1])


def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1])


def mul(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1]


def cross(a: Vec, b: Vec) -> float:
    return a[0] * b[1] - a[1] * b[0]


def norm(a: Vec) -> Vec:
    length = math.hypot(*a)
    return (a[0] / length, a[1] / length)


def left_normal(d: Vec) -> Vec:
    """Normal to the LEFT of direction d as seen on the plan (x right, y/z down)."""
    return (d[1], -d[0])


def ray_segment(p: Vec, d: Vec, a: Vec, b: Vec):
    """Parameter t >= 0 where ray p + t*d hits segment ab, or None."""
    e = sub(b, a)
    den = cross(d, e)
    if abs(den) < 1e-12:
        return None
    w = sub(a, p)
    t = cross(w, e) / den
    u = cross(w, d) / den
    if t >= 0 and -1e-9 <= u <= 1 + 1e-9:
        return t
    return None


def point_segment_distance(p: Vec, a: Vec, b: Vec) -> float:
    e = sub(b, a)
    L2 = dot(e, e)
    if L2 == 0:
        return math.dist(p, a)
    t = max(0.0, min(1.0, dot(sub(p, a), e) / L2))
    return math.dist(p, add(a, mul(e, t)))


def point_in_polygon(p: Vec, pts) -> bool:
    x, y = p
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def polygon_area(pts) -> float:
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


class Region:
    """Union of polygons with exact ray queries (used for the wall poche)."""

    def __init__(self, polygons):
        self.polygons = [list(p) for p in polygons]
        self.edges = []
        for poly in self.polygons:
            for i in range(len(poly)):
                self.edges.append((poly[i], poly[(i + 1) % len(poly)]))

    def contains(self, p: Vec) -> bool:
        return any(point_in_polygon(p, poly) for poly in self.polygons)

    def extent(self, p: Vec, d: Vec, cap: float, eps: float = 0.04) -> float:
        """Length of the run inside the region starting at p (nudged by eps) along unit d."""
        start = add(p, mul(d, eps))
        if not self.contains(start):
            return 0.0
        hits = []
        for a, b in self.edges:
            t = ray_segment(start, d, a, b)
            if t is not None and t > 1e-6:
                hits.append(t)
        if not hits:
            return cap
        hits.sort()
        # walk through hits: the run ends at the first hit after which we are outside
        for t in hits:
            probe = add(start, mul(d, t + 1e-3))
            if not self.contains(probe):
                return min(cap, t + eps)
        return cap


def convex_hull(points):
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in points))
    if len(pts) <= 2:
        return pts

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and cross(sub(out[-1], out[-2]), sub(p, out[-2])) <= 0:
                out.pop()
            out.append(p)
        return out

    lower = half(pts)
    upper = half(reversed(pts))
    return lower[:-1] + upper[:-1]


def oriented_box(points, angle_deg: float):
    """Bounding box of points in a frame rotated by angle_deg (direction of the box's x axis).

    Returns (center, width_along_axis, depth_across_axis)."""
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), math.sin(a)
    vx, vy = -uy, ux
    us = [p[0] * ux + p[1] * uy for p in points]
    vs = [p[0] * vx + p[1] * vy for p in points]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
    center = (cu * ux + cv * vx, cu * uy + cv * vy)
    return center, u1 - u0, v1 - v0


def circle_from_3(a: Vec, b: Vec, c: Vec):
    ax, ay = a
    bx, by = b
    cx, cy = c
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return None
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return (ux, uy), math.dist((ux, uy), a)
