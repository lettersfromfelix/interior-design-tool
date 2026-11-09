"""Turn sampled room edges into merged, extended and room-split walls (see walls.py)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from geom2d import Region, add, dot, left_normal, mul, point_in_polygon, point_segment_distance, sub
from walls import Opening, Wall

GLAZING_THICKNESS_CM = 12.0  # assumed frame depth of the glazed facade (not in the plan)
MAX_EXTENSION_CM = 60.0


@dataclass
class Piece:
    """A straight wall piece on one room edge (before merging)."""
    origin: tuple  # point on the centre line (pt)
    d: tuple  # unit direction
    thickness: float  # pt
    s0: float  # pt along d from origin
    s1: float
    doors: list = field(default_factory=list)  # (s0, s1, arc)
    exterior: bool = False


def edge_pieces(edges, K):
    """Wall pieces per edge: consecutive wall/junction/door runs that share one wall line."""
    pieces = []
    for e in edges:
        runs = e.runs
        walls = [r for r in runs if r.kind == "wall"]
        if not walls:
            continue
        i = 0
        while i < len(runs):
            if runs[i].kind not in ("wall", "door"):
                i += 1
                continue
            j = i
            group = []
            while j < len(runs) and runs[j].kind in ("wall", "door", "junction"):
                group.append(runs[j])
                j += 1
            # trim junctions at both ends of the group
            while group and group[0].kind == "junction":
                group.pop(0)
            while group and group[-1].kind == "junction":
                group.pop()
            wall_runs = [r for r in group if r.kind == "wall"]
            if wall_runs:
                ref = max(wall_runs, key=lambda r: r.s1 - r.s0)
                thickness, offset = ref.thickness(), ref.offset()
                origin = add(e.a, mul(e.n, offset))
                piece = Piece(origin, e.d, thickness, group[0].s0, group[-1].s1,
                              exterior=e.neighbor is None)
                for r in group:
                    if r.kind == "door":
                        piece.doors.append((r.s0, r.s1, r.door))
                pieces.append(piece)
            i = max(j, i + 1)
    return pieces


def _line_key(origin, d):
    # canonical direction (angle in [0, 180)) and signed distance of the line from the page origin
    ang = math.degrees(math.atan2(d[1], d[0])) % 180.0
    a = math.radians(ang)
    cd = (math.cos(a), math.sin(a))
    n = left_normal(cd)
    return ang, dot(origin, n), cd


def merge_pieces(pieces, poche: Region, K):
    """Merge collinear pieces with equal thickness; bridge door gaps; extend ends into the poche."""
    groups = []
    for p in pieces:
        ang, rho, cd = _line_key(p.origin, p.d)
        for g in groups:
            dang = min(abs(g["ang"] - ang), 180 - abs(g["ang"] - ang))
            if dang < 0.3 and abs(g["rho"] - rho) * K < 1.0 and abs(g["t"] - p.thickness) * K < 1.5:
                g["pieces"].append(p)
                break
        else:
            groups.append({"ang": ang, "rho": rho, "cd": cd, "t": p.thickness, "pieces": [p]})

    walls = []
    for g in groups:
        cd = g["cd"]
        base = g["pieces"][0].origin
        intervals = []
        doors = []
        for p in g["pieces"]:
            sign = 1.0 if dot(p.d, cd) > 0 else -1.0
            o = dot(sub(p.origin, base), cd)
            u0, u1 = sorted((o + sign * p.s0, o + sign * p.s1))
            intervals.append([u0, u1, p.exterior])
            for s0, s1, arc in p.doors:
                v0, v1 = sorted((o + sign * s0, o + sign * s1))
                doors.append((v0, v1, arc))
        intervals.sort()
        spans = []
        for u0, u1, ext in intervals:
            if spans and (u0 <= spans[-1][1] + 2.0 / K or _solid(poche, base, cd, spans[-1][1], u0, K)):
                spans[-1][1] = max(spans[-1][1], u1)
                spans[-1][2] = spans[-1][2] and ext
            else:
                spans.append([u0, u1, ext])
        for u0, u1, ext in spans:
            p0 = add(base, mul(cd, u0))
            p1 = add(base, mul(cd, u1))
            t_cm = g["t"] * K
            kind = ("exterior" if t_cm >= 35.0 else "party") if ext else "interior"
            w = Wall(kind, p0, p1, g["t"])
            for v0, v1, arc in doors:
                if v0 >= u0 - 1.0 / K and v1 <= u1 + 1.0 / K:
                    same = next((o for o in w.openings if o.arc is arc), None)
                    if same:  # the same door seen from the rooms on both sides
                        same.s0 = min(same.s0, v0 - u0)
                        same.s1 = max(same.s1, v1 - u0)
                    else:
                        w.openings.append(Opening("door", v0 - u0, v1 - u0, arc=arc))
            _extend(w, poche, K)
            _exact_door_bounds(w, poche, K)
            walls.append(w)
    return walls


def _solid(poche: Region, base, cd, u0, u1, K):
    """True if the centre line between u0 and u1 lies completely inside the poche (a junction)."""
    if u1 <= u0:
        return True
    if (u1 - u0) * K > 45.0:
        return False
    u = u0
    while u < u1:
        if not poche.contains(add(base, mul(cd, u))):
            return False
        u += 0.5 / K
    return True


def _extend(w: Wall, poche: Region, K):
    """Extend both ends through adjacent poche so corners and T-junctions are closed.

    Phase 0: bridge <= 6 cm of air (a wall ending inside a door opening next to a perpendicular wall).
    Phase 1: follow the poche while it is the *same* wall (same thickness, centred) - e.g. behind a shaft.
    Phase 2: cross one perpendicular wall (<= 43 cm) but only if we come out on the other side;
             otherwise we would be running along another wall and stop.
    """
    probe = 6.0 / K
    same_tol = 2.0 / K
    step = 1.0 / K
    fwd = w.d
    n = left_normal(fwd)
    for end in (0, 1):
        p = w.p0 if end == 0 else w.p1
        d = mul(fwd, -1) if end == 0 else fwd
        total = 0.0
        if not poche.contains(add(p, mul(d, 0.04))):
            gap = _free_run(poche, p, d, probe)
            if gap >= probe - 1e-6:
                continue
            total = gap
        # phase 1: same wall continues
        limit = 130.0 / K
        while total < limit:
            q = add(p, mul(d, total + step))
            if not poche.contains(q):
                break
            tp = poche.extent(q, n, 80.0 / K)
            tm = poche.extent(q, mul(n, -1), 80.0 / K)
            if abs(tp + tm - w.thickness) > same_tol or abs(tp - tm) / 2 > same_tol:
                break
            total += step
        # phase 2: cross one perpendicular wall
        q = add(p, mul(d, total))
        cross_cap = 43.0 / K
        e = poche.extent(q, d, cross_cap + 1.0 / K)
        if 0 < e <= cross_cap:
            total += e
        if total <= 0:
            continue
        if end == 0:
            w.p0 = add(w.p0, mul(d, total))
            w.core = (w.core[0] + total, w.core[1] + total)
            for o in w.openings:
                o.s0 += total
                o.s1 += total
        else:
            w.p1 = add(w.p1, mul(d, total))


def _exact_door_bounds(w: Wall, poche: Region, K):
    """Snap door openings to the exact reveal faces (ray casts along the centre line)."""
    d = w.d
    cap = 200.0 / K
    for o in w.openings:
        mid = add(w.p0, mul(d, (o.s0 + o.s1) / 2))
        if poche.contains(mid):
            continue
        # distance from the opening centre to the reveal on each side
        right = _free_run(poche, mid, d, cap)
        left = _free_run(poche, mid, mul(d, -1), cap)
        s_mid = (o.s0 + o.s1) / 2
        o.s0 = max(0.0, s_mid - left)
        o.s1 = min(w.length, s_mid + right)


def _free_run(poche: Region, p, d, cap, step=0.05):
    t = 0.0
    while t < cap and not poche.contains(add(p, mul(d, t + step))):
        t += step
    return t


def glazing_walls(edges, sash_arcs, balcony_door_arcs, K):
    """Thin glazing walls along exterior outline edges without poche (facade, balcony doors)."""
    t = GLAZING_THICKNESS_CM / K
    cand = []
    for e in edges:
        if e.neighbor is not None or any(r.kind in ("wall", "door") for r in e.runs):
            continue
        if not all(r.kind == "gap" for r in e.runs):
            continue
        cand.append(e)

    def closed_mid(arc):
        """Midpoint of the sash/leaf in its closed position (the arc end lying on the glazing line)."""
        best = None
        for tip in (arc.start, arc.end):
            dist = min(point_segment_distance(tip, e.a, e.b) for e in cand) if cand else 0
            if best is None or dist < best[0]:
                best = (dist, tip)
        return mul(add(arc.center, best[1]), 0.5)

    owner = {}
    for arc in list(sash_arcs) + list(balcony_door_arcs):
        m = closed_mid(arc)
        best = None
        for e in cand:
            s = dot(sub(m, e.a), e.d)
            off = abs(dot(sub(m, e.a), e.n))
            if -2.0 / K <= s <= e.length + 2.0 / K and off * K < 12.0 and (best is None or off < best[0]):
                best = (off, e)
        if best:
            owner[id(arc)] = best[1]

    def arcs_on(e, arcs):
        return [a for a in arcs if owner.get(id(a)) is e]

    with_arcs = {id(e) for e in cand if arcs_on(e, sash_arcs) or arcs_on(e, balcony_door_arcs)}
    walls = []
    for e in cand:
        sashes = arcs_on(e, sash_arcs)
        bdoors = arcs_on(e, balcony_door_arcs)
        has_arcs = bool(sashes or bdoors)
        adjacent = any(
            id(o) in with_arcs and o.room == e.room and (o.a == e.b or o.b == e.a)
            for o in cand
        )
        if not has_arcs and not (adjacent and e.length * K < 40.0):
            continue  # e.g. shaft notches: handled as fixtures
        ext = 1.5 / K
        p0 = add(add(e.a, mul(e.n, t / 2)), mul(e.d, -ext))
        p1 = add(add(e.b, mul(e.n, t / 2)), mul(e.d, ext))
        w = Wall("glazing", p0, p1, t)
        L = w.length
        if bdoors:
            m = 4.0 / K + ext
            w.openings.append(Opening("door", m, L - m, arc=bdoors[0]))
        elif sashes:
            m = 5.0 / K + ext
            w.openings.append(Opening("window", m, L - m, arcs=sashes))
        else:
            m = 3.0 / K + ext
            w.openings.append(Opening("window", m, L - m, fixed=True))
        walls.append(w)
    return walls


def assign_sides(walls, rooms, K, split=True):
    """Determine the room on each side; split walls where that changes."""
    out = []
    for w in walls:
        d = w.d
        n = left_normal(d)
        off = w.thickness / 2 + 3.0 / K
        step = 2.0 / K
        L = w.length
        c0, c1 = w.core
        marks = []
        s = max(step / 2, c0 + step / 2)
        while s < min(L, c1):
            c = add(w.p0, mul(d, s))
            lp, rp = add(c, mul(n, off)), add(c, mul(n, -off))
            left = next((r for r, q in rooms.items() if point_in_polygon(lp, q)), None)
            right = next((r for r, q in rooms.items() if point_in_polygon(rp, q)), None)
            marks.append((s, left, right))
            s += step
        # segments of constant (left, right), ignoring blips shorter than 12 cm
        segs = []
        for s, left, right in marks:
            if segs and (segs[-1][2], segs[-1][3]) == (left, right):
                segs[-1][1] = s
            else:
                segs.append([s, s, left, right])
        segs = _absorb_blips(segs, 12.0 / K)
        if not segs:
            out.append(w)
            continue
        if not split or len(segs) == 1:
            w.left, w.right = _dominant(segs)
            out.append(w)
            continue
        cuts = [0.0] + [(segs[i][1] + segs[i + 1][0]) / 2 for i in range(len(segs) - 1)] + [L]
        for i, seg in enumerate(segs):
            a, b = cuts[i], cuts[i + 1]
            piece = Wall(w.kind, add(w.p0, mul(d, a)), add(w.p0, mul(d, b)), w.thickness)
            piece.left, piece.right = seg[2], seg[3]
            for o in w.openings:
                if o.s0 >= a - 1e-6 and o.s1 <= b + 1e-6:
                    o.s0 -= a
                    o.s1 -= a
                    piece.openings.append(o)
                elif o.s0 < b and o.s1 > a:
                    raise RuntimeError("opening crosses a room boundary split")
            out.append(piece)
    return out


def _absorb_blips(segs, min_len):
    changed = True
    while changed and len(segs) > 1:
        changed = False
        for i, seg in enumerate(segs):
            if seg[1] - seg[0] < min_len:
                j = i - 1 if i > 0 else i + 1
                if j >= len(segs):
                    break
                lo, hi = min(i, j), max(i, j)
                keep = segs[j]
                segs[lo] = [segs[lo][0], segs[hi][1], keep[2], keep[3]]
                del segs[hi]
                changed = True
                break
    return segs


def _dominant(segs):
    best = max(segs, key=lambda s: s[1] - s[0])
    return best[2], best[3]
