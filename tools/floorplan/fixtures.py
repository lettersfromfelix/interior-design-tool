"""Fixed elements of the apartment (kitchen, built-ins, sanitary, column, shafts, balconies).

Footprints come from the plan's vector drawing (exact); heights, colours and materials are
estimated from the photos or Swiss standards and flagged as low confidence.
"""
from __future__ import annotations

import math

from geom2d import Region, add, convex_hull, mul, oriented_box, point_in_polygon, polygon_area, sub
from pdfgeom import W_MEDIUM, path_to_polylines

WING_ANGLE = -13.93  # rotation of the west wing (Zimmer 13.0 / Bad) on the sheet, degrees

# Vertical flat-bar railings: Juliet railings and balconies share the style (you). Height, bar size and spacing are
# assumptions (low confidence, see the checklist). The engine draws Juliet railings with the same bottom rail.
RAILING = {"height": 100.0, "barSpacing": 11.0, "barWidth": 4.0, "barThickness": 1.0}
BOTTOM_RAIL = 10.0  # top edge of the bottom rail above the floor

# Kitchen wall cabinets: above the whole base run, top level with the tall units (you); depth and underside assumed.
WALL_CABINET_DEPTH = 35.0
WALL_CABINET_BOTTOM = 145.0  # worktop 90 cm + 55 cm


def r1(v):
    return round(v + 0.0, 1)


def prov(confidence, source, note=None, fields=None):
    p = {"confidence": confidence, "source": source}
    if note:
        p["note"] = note
    if fields:
        p["fields"] = fields
    return p


class Frame:
    """Fixture frame: origin (cm) + rotation (deg, clockwise seen from above; 0 = front faces +z)."""

    def __init__(self, origin, rotation):
        self.o = origin
        self.rot = rotation
        a = math.radians(rotation)
        self.c, self.s = math.cos(a), math.sin(a)

    def local(self, p):
        wx, wz = p[0] - self.o[0], p[1] - self.o[1]
        return (wx * self.c + wz * self.s, -wx * self.s + wz * self.c)

    def box(self, name, p_min, p_max, y0, y1, material, provenance=None, plan=None):
        """Axis-aligned (in fixture frame) box from two opposite plan corners (cm)."""
        a, b = self.local(p_min), self.local(p_max)
        part = {
            "name": name,
            "shape": "box",
            "position": {"x": r1((a[0] + b[0]) / 2), "y": r1((y0 + y1) / 2), "z": r1((a[1] + b[1]) / 2)},
            "size": {"x": r1(abs(a[0] - b[0])), "y": r1(y1 - y0), "z": r1(abs(a[1] - b[1]))},
            "material": material,
        }
        if plan:
            part["plan"] = plan
        if provenance:
            part["provenance"] = provenance
        return part


def kitchen(plan):
    """Linear kitchen on the wall between living room and Zimmer 15.9 (fronts face the living room)."""
    cm = plan.to_cm
    # exact rectangles from the plan (PDF pt)
    x_tall0, x_tall1, x_tall2 = 331.37, 343.28, 360.85
    x_run_end, x_step = 434.84, 421.51
    y_wall = 349.97  # kitchen-side face of the wall
    y_tall_front = 332.96
    y_top_deep, y_top_shallow = 329.42, 332.25
    sink = (371.38, 332.39, 385.47, 343.93)
    hob = (405.55, 332.87, 419.39, 346.71)

    lo = cm((x_tall0, y_top_deep))
    hi = cm((x_run_end, y_wall))
    origin = ((lo[0] + hi[0]) / 2, hi[1] - 36.25)  # centre of the 72.5 cm deep footprint
    f = Frame(origin, 180)
    tall_h, base_h, top_t = 240.0, 87.0, 3.0
    low_h = prov("low", "photo", "Height estimated from IMG_4508 (black side panel almost reaches the ceiling). "
                 "Checklist {check:kitchen-tall-units}.")
    run_a, run_b = cm((x_tall2, y_wall)), cm((x_run_end, y_wall))
    parts = [
        f.box("tall unit 42", cm((x_tall0, y_tall_front)), cm((x_tall1, y_wall)), 0, tall_h, "fronts",
              prov("medium", "plan", fields={"size.y": low_h})),
        f.box("tall unit 62", cm((x_tall1, y_tall_front)), cm((x_tall2, y_wall)), 0, tall_h, "fronts",
              prov("medium", "plan", fields={"size.y": low_h})),
        f.box("side panel", cm((x_tall0, y_tall_front)), cm((x_tall0 + 0.6, y_wall)), 0, tall_h, "side-panel"),
        f.box("base cabinets", cm((x_tall2, y_tall_front)), cm((x_run_end, y_wall)), 10, base_h, "fronts"),
        f.box("plinth", cm((x_tall2, y_tall_front + 1.5)), cm((x_run_end, y_wall)), 0, 10, "plinth"),
        f.box("worktop", cm((x_tall2, y_top_deep)), cm((x_step, y_wall)), base_h, base_h + top_t, "worktop",
              prov("medium", "plan", "72.5 cm deep worktop as drawn (overhang to the living room?). "
                   "Checklist {check:kitchen-worktop-depth}.")),
        f.box("worktop end", cm((x_step, y_top_shallow)), cm((x_run_end, y_wall)), base_h, base_h + top_t, "worktop"),
        f.box("sink", cm((sink[0], sink[1])), cm((sink[2], sink[3])), base_h + top_t - 0.2, base_h + top_t + 0.4, "steel"),
        f.box("hob", cm((hob[0], hob[1])), cm((hob[2], hob[3])), base_h + top_t - 0.2, base_h + top_t + 0.5, "hob"),
        # top level with the tall units: both use tall_h. Overhead, so the plan shows it dashed (worktop stays visible).
        f.box("wall cabinets", (run_a[0], run_a[1] - WALL_CABINET_DEPTH), run_b, WALL_CABINET_BOTTOM, tall_h, "fronts",
              prov("medium", "user",
                   "Wall cabinets above the whole base run, top level with the tall units (you); not in the plan.",
                   fields={
                       "size.z": prov("low", "assumed", f"Depth {WALL_CABINET_DEPTH:.0f} cm assumed. "
                                      "Checklist {check:kitchen-wall-cabinets}."),
                       "size.y": prov("low", "assumed", f"Underside {WALL_CABINET_BOTTOM:.0f} cm above the floor "
                                      "assumed (the top follows the tall units). Checklist {check:kitchen-wall-cabinets}."),
                   }),
              plan="dashed"),
    ]
    return {
        "id": "kitchen",
        "name": "Kitchen",
        "kind": "kitchen",
        "position": [r1(origin[0]), r1(origin[1])],
        "rotation": 180,
        "parts": parts,
        "materials": {
            "fronts": "kitchen.light-grey-matt",
            "side-panel": "kitchen.black-matt",
            "plinth": "kitchen.black-matt",
            "worktop": "kitchen.worktop-light",
            "steel": "metal.stainless",
            "hob": "glass.black",
        },
        "provenance": prov(
            "medium", "plan",
            "Footprint exact from the plan: tall units 42 + 62 cm (60 deep), counter run 261 cm "
            "(214 cm at 72.5 cm depth, 47 cm at 62.5 cm), sink, 4-zone hob. Wall cabinets above the whole counter "
            "run, top level with the tall units (you). Heights and colours from photo IMG_4508 and Swiss standard "
            "(worktop 90 cm). Checklist {check:kitchen-worktop-height}-{check:kitchen-tall-units}, "
            "{check:kitchen-wall-cabinets}.",
        ),
    }


def built_in_wardrobe(plan, ceiling):
    cm = plan.to_cm
    x0, x_side, x_mid, x1 = 299.06, 304.87, 321.17, 338.74
    y_front, y_back = 468.17, 486.32
    lo, hi = cm((x0, y_front)), cm((x1, y_back))
    origin = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
    f = Frame(origin, 180)
    h = ceiling
    parts = [
        f.box("carcass", cm((x0, y_front + 0.6)), cm((x1, y_back)), 0, h, "body"),
        f.box("door left", cm((x_side, y_front)), cm((x_mid - 0.15, y_front + 0.6)), 0, h, "fronts"),
        f.box("door right", cm((x_mid + 0.15, y_front)), cm((x1, y_front + 0.6)), 0, h, "fronts"),
        f.box("side compartment", cm((x0, y_front)), cm((x_side - 0.15, y_front + 0.6)), 0, h, "fronts"),
    ]
    return {
        "id": "built-in-wardrobe",
        "name": "Built-in wardrobe (Einbauschrank)",
        "kind": "built-in",
        "position": [r1(origin[0]), r1(origin[1])],
        "rotation": 180,
        "parts": parts,
        "materials": {"body": "paint.white", "fronts": "kitchen.light-grey-matt"},
        "provenance": prov(
            "medium", "plan",
            "Footprint exact from the plan: 140 x 64 cm, two ~57.5 cm doors + ~20 cm side compartment. "
            "Not visible in the photos: height (assumed floor-to-ceiling) and colour are guesses. "
            "Checklist {check:wardrobe}.",
            {"parts.*.size.y": {"confidence": "low", "source": "assumed", "note": "Assumed floor-to-ceiling."}},
        ),
    }


def column(plan, poche_paths, ceiling):
    for i, poly in poche_paths:
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        if max(xs) - min(xs) < 6 and max(ys) - min(ys) < 6:
            c = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)
            r_cm = math.sqrt(abs(polygon_area(poly)) / math.pi) * plan.pt_to_cm
            pos = plan.to_cm(c)
            return {
                "id": "column",
                "name": "Column",
                "kind": "column",
                "position": [r1(pos[0]), r1(pos[1])],
                "rotation": 0,
                "parts": [{
                    "name": "column", "shape": "cylinder", "radius": r1(r_cm), "height": ceiling,
                    "position": {"x": 0, "y": ceiling / 2, "z": 0}, "material": "body",
                }],
                "materials": {"body": "paint.white"},
                "provenance": prov("medium", "plan", f"Round column, diameter {2 * r_cm:.0f} cm from the plan "
                                   "(drawn outline adds ~3 cm). Checklist {check:column-wall}, {check:column-window}, "
                                   "{check:column-diameter}."),
            }
    raise RuntimeError("column not found")


def bathroom(plan, ceiling):
    """Sanitary fixtures of the bathroom (rotated 13.93 deg like the whole west wing)."""
    rot = 180 - 13.93  # local x along the wing walls, fronts face into the room (up the sheet)
    items = []

    def fixture(fid, name, kind, indices, y0, y1, material, mat_id, note, rot_=rot):
        pts = _points(plan, indices)
        c, w, d = oriented_box(pts, WING_ANGLE)
        items.append({
            "id": fid,
            "name": name,
            "kind": kind,
            "position": [r1(c[0]), r1(c[1])],
            "rotation": round(rot_, 2),
            "parts": [{
                "name": name.lower(), "shape": "box", "size": {"x": r1(w), "y": r1(y1 - y0), "z": r1(d)},
                "position": {"x": 0, "y": r1((y0 + y1) / 2), "z": 0}, "material": material,
            }],
            "materials": {material: mat_id},
            "provenance": prov("medium", "plan", note, {"parts.0.size.y": {
                "confidence": "low", "source": "assumed", "note": "Height not in plan (standard value)."}}),
        })

    fixture("bath-washer-dryer", "Washer/dryer stack", "appliance", [656, 657, 658, 659], 0, 170,
            "body", "paint.white", "WM/TU stack as drawn (about 60 x 57 cm). Checklist {check:bathroom}.")
    fixture("bath-shower-tray", "Shower tray", "sanitary", [586, 660] + list(range(489, 586)), 0, 6,
            "body", "ceramic.white",
            "Tray about 80 x 100 cm as drawn; shower assumed (not a bathtub). Checklist {check:bathroom}.")
    fixture("bath-washbasin", "Washbasin", "sanitary", [1167] + list(range(1280, 1290)), 70, 86,
            "body", "ceramic.white", "Washbasin as drawn; mounting height assumed 86 cm.")
    fixture("bath-wc", "WC", "sanitary", list(range(1147, 1167)), 0, 42,
            "body", "ceramic.white", "Wall-hung WC as drawn; seat height assumed 42 cm.")
    # pre-wall (installation wall) behind basin and WC: between line 1168 and the room edge
    pts = _points(plan, [1168]) + [plan.to_cm((285.62, 427.26)), plan.to_cm((252.06, 435.59))]
    c, w, d = oriented_box(pts, WING_ANGLE)
    items.append({
        "id": "bath-prewall",
        "name": "Installation wall",
        "kind": "sanitary",
        "position": [r1(c[0]), r1(c[1])],
        "rotation": round(rot, 2),
        "parts": [{"name": "pre-wall", "shape": "box", "size": {"x": r1(w), "y": 120, "z": r1(d)},
                   "position": {"x": 0, "y": 60, "z": 0}, "material": "body"}],
        "materials": {"body": "paint.white"},
        "provenance": prov("medium", "plan", "Installation wall behind washbasin and WC as drawn; height assumed 120 cm."),
    })
    # shafts: notches of the bathroom outline (excluded from the room area: 'Flaechen Schaechte')
    shaft_polys = {
        "shaft-bath-west": [(250.28, 428.43), (225.66, 434.54), (227.46, 441.79), (252.06, 435.59)],
        "shaft-bath-east": [(289.76, 418.61), (283.84, 420.08), (285.62, 427.26), (291.44, 425.38)],
    }
    for sid, poly in shaft_polys.items():
        pts = [plan.to_cm(p) for p in poly]
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        items.append({
            "id": sid,
            "name": "Shaft",
            "kind": "other",
            "position": [r1(cx), r1(cz)],
            "rotation": 0,
            "parts": [{"name": "shaft", "shape": "extrusion", "height": ceiling,
                       "points": [[r1(p[0] - cx), r1(p[1] - cz)] for p in pts],
                       "position": {"x": 0, "y": 0, "z": 0}, "material": "body"}],
            "materials": {"body": "paint.white"},
            "provenance": prov("medium", "plan", "Shaft (notch excluded from the bathroom area in the plan)."),
        })
    return items


def _points(plan, indices):
    pts = []
    for i in indices:
        for poly in path_to_polylines(plan.drawings[i]["items"], 8):
            pts += [plan.to_cm(p) for p in poly]
    return pts


def balconies(plan, rooms_pt, poche: Region, glazing_edges_pt):
    """Two round balconies: floor outline + railing (double ring r_in ~100 cm, r_out ~106 cm)."""
    import random

    from geom2d import circle_from_3

    K = plan.pt_to_cm
    specs = {"balcony-n": (150, 185, 270, 265), "balcony-se": (470, 300, 560, 410)}
    out_rooms, out_fixtures = [], []
    for bid, bb in specs.items():
        pts = []
        for _, d in plan.paths(kind="s", width=W_MEDIUM, bbox=bb):
            for poly in path_to_polylines(d["items"], 8):
                for k in range(len(poly) - 1):
                    a, b = poly[k], poly[k + 1]
                    n = max(1, int(math.dist(a, b) / 0.5))
                    for j in range(n):
                        p = add(a, mul(sub(b, a), j / n))
                        if bb[0] <= p[0] <= bb[2] and bb[1] <= p[1] <= bb[3]:
                            pts.append(p)
        random.seed(7)
        best = None
        for _ in range(4000):
            res = circle_from_3(*random.sample(pts, 3))
            if not res or not (20 < res[1] < 45):
                continue
            c, r = res
            inl = sum(1 for p in pts if abs(math.dist(p, c) - r) < 0.25)
            if not best or inl > best[0]:
                best = (inl, c, r)
        _, c, r = best
        # the double ring: inner and outer radius
        ring = sorted(math.dist(p, c) for p in pts if abs(math.dist(p, c) - r) < 3.0)
        radii = _two_modes(ring)
        r_in, r_out = min(radii), max(radii)
        # floor: inner circle outside the building + the glazing V (balcony doors)
        V = [p for e in glazing_edges_pt if any(math.dist(q, c) < r_out + 12 for q in e) for p in e]
        circle = []
        for k in range(96):
            a = 2 * math.pi * k / 96
            p = (c[0] + r_in * math.cos(a), c[1] + r_in * math.sin(a))
            if not poche.contains(p) and not any(point_in_polygon(p, q) for q in rooms_pt.values()):
                circle.append(p)
        hull = convex_hull(circle + V)
        outline = [[r1(x), r1(z)] for x, z in (plan.to_cm(p) for p in hull)]
        area = abs(polygon_area([plan.to_cm(p) for p in hull])) / 1e4
        out_rooms.append({
            "id": bid,
            "name": "Balcony (north)" if bid == "balcony-n" else "Balcony (south-east)",
            "kind": "balcony",
            "outline": outline,
            "hasCeiling": False,
            "floorMaterial": "floor.wood-decking",
            "provenance": prov("medium", "plan",
                               f"Round balcony from the railing circle (inner radius {r_in * K:.0f} cm); "
                               f"floor area {area:.2f} m2 (plan: 6.6 m2 for both balconies). "
                               "Checklist {check:balcony-diameter}."),
        })
        start, sweep = _ring_extent(plan, bb, c, r_in, r_out)
        out_fixtures.append(_balcony_railing(bid, plan.to_cm(c), (r_in + r_out) / 2 * K, start, sweep))
    return out_rooms, out_fixtures


def _ring_extent(plan, bb, c, r_in, r_out, tol=0.35):
    """Angular extent of the railing as drawn: the polylines whose vertices all lie on the double ring.

    The plan draws the railing only along the open edge of the balcony, from wall to wall; the largest angular gap
    is the open side towards the balcony doors. Returns (start, sweep) in degrees, measured from +x and clockwise
    on the plan (the sheet's y and the model's z point down).
    """
    angles = []
    for _, d in plan.paths(kind="s", width=W_MEDIUM, bbox=bb):
        for poly in path_to_polylines(d["items"], 8):
            on_ring = len(poly) >= 2 and all(
                min(abs(math.dist(p, c) - r_in), abs(math.dist(p, c) - r_out)) < tol for p in poly)
            if not on_ring:
                continue
            for k in range(len(poly) - 1):
                a, b = poly[k], poly[k + 1]
                n = max(1, int(math.dist(a, b) / 0.5))
                for j in range(n + 1):
                    p = add(a, mul(sub(b, a), j / n))
                    angles.append(math.degrees(math.atan2(p[1] - c[1], p[0] - c[0])) % 360)
    if len(angles) < 10:
        raise RuntimeError("railing ring not found")
    angles.sort()
    gap, i = max(((angles[(i + 1) % len(angles)] - angles[i]) % 360, i) for i in range(len(angles)))
    if gap < 30:
        raise RuntimeError("railing ring has no open side (balcony doors)")
    return angles[(i + 1) % len(angles)], 360 - gap


def _balcony_railing(bid, center, rc, start, sweep):
    """Vertical flat-bar railing along an arc (centre radius rc), same style as the Juliet railings."""
    h, s, w, t = RAILING["height"], RAILING["barSpacing"], RAILING["barWidth"], RAILING["barThickness"]
    n = max(1, round(rc * math.radians(sweep) / s))
    step = sweep / n
    first = start + step / 2
    a = math.radians(first)
    profile = [[r1(rc - w / 2), 0], [r1(rc + w / 2), 0], [r1(rc + w / 2), t], [r1(rc - w / 2), t], [r1(rc - w / 2), 0]]

    def rail(name, y, provenance=None):
        part = {"name": name, "shape": "lathe", "profile": profile, "arc": round(sweep, 1),
                "position": {"x": 0, "y": y, "z": 0}, "rotation": {"y": round(start, 2)}, "material": "bars"}
        if provenance:
            part["provenance"] = provenance
        return part

    bars = {
        "name": "bars", "shape": "box",
        "size": {"x": w, "y": r1(h - t - BOTTOM_RAIL), "z": t},
        "position": {"x": round(rc * math.cos(a), 2), "y": r1((BOTTOM_RAIL + h - t) / 2), "z": round(rc * math.sin(a), 2)},
        "rotation": {"y": round(first, 3)},
        "repeatAround": {"count": n, "step": round(step, 4)},
        "material": "bars",
        "provenance": prov("low", "assumed",
                           f"Vertical flat bars {w:.0f} x {t:.0f} cm about every {s:.0f} cm (centre to centre), "
                           "same style as the Juliet railings (you); bar size and spacing assumed. "
                           "Checklist {check:railing-bars}."),
    }
    return {
        "id": f"{bid}-railing",
        "name": "Balcony railing",
        "kind": "railing",
        "position": [r1(center[0]), r1(center[1])],
        "rotation": 0,
        "parts": [
            rail("top rail", h - t, prov("low", "photo", f"Railing height {h:.0f} cm estimated from IMG_4509. "
                                         "Checklist {check:railing-height}.")),
            rail("bottom rail", BOTTOM_RAIL - t),
            bars,
        ],
        "materials": {"bars": "metal.railing"},
        "collides": True,
        "provenance": prov("medium", "plan",
                           f"Railing along the open edge of the round balcony, from wall to wall ({sweep:.0f} degrees "
                           "of the circle, as drawn in the plan); the balcony doors stay clear (you). Vertical flat-bar "
                           "railing like the Juliet railings in front of the living-room windows (you)."),
    }


def _two_modes(values):
    # split sorted values at the largest gap -> two clusters (inner / outer line of the railing)
    if len(values) < 4:
        return [values[0], values[-1]]
    gaps = [(values[i + 1] - values[i], i) for i in range(len(values) - 1)]
    g, i = max(gaps)
    a, b = values[: i + 1], values[i + 1:]
    return [a[len(a) // 2], b[len(b) // 2]]
