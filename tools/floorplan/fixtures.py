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

# Kitchen fronts and handles from photo IMG_4497 (estimates)
FRONT_GAP = 0.4  # dark joint between two fronts
FRONT_T = 2.0  # front thickness
PULL_R = 5.0  # walnut half-moon pulls on the top edge of the base fronts


def r1(v):
    return round(v + 0.0, 1)


def r2(v):
    return round(v + 0.0, 2)


def _box(name, x0, x1, y0, y1, z0, z1, material, **extra):
    """Box part from two opposite corners, in fixture-local cm."""
    part = {
        "name": name,
        "shape": "box",
        "position": {"x": r2((x0 + x1) / 2), "y": r2((y0 + y1) / 2), "z": r2((z0 + z1) / 2)},
        "size": {"x": r2(abs(x1 - x0)), "y": r2(abs(y1 - y0)), "z": r2(abs(z1 - z0))},
        "material": material,
    }
    part.update(extra)
    return part


def _cyl(name, x, y, z, radius, height, material, axis="y", **extra):
    """Cylinder part centred at (x, y, z) in fixture-local cm, its axis along local x, y or z."""
    part = {"name": name, "shape": "cylinder", "radius": radius, "height": r2(height),
            "position": {"x": r2(x), "y": r2(y), "z": r2(z)}, "material": material}
    if axis == "x":
        part["rotation"] = {"z": 90}
    elif axis == "z":
        part["rotation"] = {"x": 90}
    part.update(extra)
    return part


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
    """Linear kitchen on the wall between living room and Zimmer 15.9 (fronts face the living room).

    Footprint from the plan; fronts, handles and appliances from photos IMG_4497 / IMG_4508. Positions inside use run
    coordinates: s along the run (cm east of the tall units), d from the wall towards the room, y up.
    """
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
    w0 = cm((x_tall2, y_wall))

    def s_(x_pt):
        return cm((x_pt, y_wall))[0] - w0[0]

    def d_(y_pt):
        return w0[1] - cm((x_tall2, y_pt))[1]

    def P(s, d):
        return (w0[0] + s, w0[1] - d)

    def box(name, s0, s1, d0, d1, y0, y1, material, provenance=None, plan_style=None):
        return f.box(name, P(s0, d0), P(s1, d1), y0, y1, material, provenance, plan_style)

    def loc(s, d):
        return f.local(P(s, d))

    def cyl(name, s, d, y, radius, height, material, axis="y", **extra):
        # axis "s" runs along the kitchen (local x), "d" towards the room (local z)
        x, z = loc(s, d)
        return _cyl(name, x, y, z, radius, height, material, {"s": "x", "d": "z"}.get(axis, "y"), **extra)

    tall_h, base_h, top_t = 240.0, 87.0, 3.0
    top = base_h + top_t
    side = 0.6 * plan.pt_to_cm  # dark side panel at the west end of the tall units
    t42, t62, run_end, step = s_(x_tall0), s_(x_tall1), s_(x_run_end), s_(x_step)
    depth = d_(y_tall_front)  # 60: carcass + fronts
    body = depth - FRONT_T
    top_deep, top_shallow = d_(y_top_deep), d_(y_top_shallow)
    g = FRONT_GAP / 2
    half_moon = [[r2(PULL_R * math.cos(math.radians(a))), r2(PULL_R * math.sin(math.radians(a)))] for a in range(0, 181, 15)]
    low_h = prov("low", "photo", "Height estimated from IMG_4508 (the side panel almost reaches the ceiling). "
                 "Checklist {check:kitchen-tall-units}.")
    detail = prov("low", "photo", "Seen in photo IMG_4497; size and position estimated.")

    def front(name, s0, s1, y0, y1, plan_style=None):
        return box(name, s0 + g, s1 - g, body, depth, y0 + g, y1 - g, "fronts", plan_style=plan_style)

    def pull(s, y_top):
        # walnut half-moon on the top edge of a front: flat side up, standing out 1.8 cm
        x, z = loc(s, depth)
        return {"name": "pull", "shape": "extrusion", "points": half_moon, "height": 1.8,
                "position": {"x": r2(x), "y": r2(y_top), "z": r2(z)}, "rotation": {"x": 90}, "material": "handles"}

    # tall units: dark brown carcass and side panel, light grey fronts with dark joints
    parts = [
        box("side panel", t42, t42 + side, 0, depth, 0, tall_h, "carcass"),
        box("tall unit 42", t42 + side, t62, 0, body, 0, tall_h, "carcass", prov("medium", "plan", fields={"size.y": low_h})),
        box("tall unit 62", t62, 0, 0, body, 0, tall_h, "carcass", prov("medium", "plan", fields={"size.y": low_h})),
        front("tall door", t42 + side, t62, 10, tall_h),
        front("freezer door", t62, 0, 10, 75),
        front("fridge door", t62, 0, 75, 178),
        front("top door", t62, 0, 178, tall_h),
        box("fridge handle", t62 + 1.2, t62 + 3.7, depth, depth + 2.2, 78, 124, "handles", detail),
        pull(-9, 75 - g),
    ]
    # base run (west to east): drawer unit 40, sink 60, dishwasher 60, oven under the hob 60, end unit
    parts += [
        box("base cabinets", 0, 40, 0, body, 10, base_h, "carcass"),
        box("base cabinets", 40, 100, 0, body, 10, 70, "carcass"),  # sink unit: the bowl hangs into it
        box("base cabinets", 100, run_end, 0, body, 10, base_h, "carcass"),
        box("plinth", 0, run_end, 0, d_(y_tall_front + 1.5), 0, 10, "carcass"),
        front("drawer", 0, 40, 72, base_h), pull(20, base_h - g),
        front("door", 0, 40, 10, 72), pull(20, 72 - g),
        front("sink door", 40, 100, 10, base_h), pull(70, base_h - g),
        front("dishwasher", 100, 160, 10, base_h), pull(130, base_h - g),
        front("drawer", 160, 220, 10, 27), pull(190, 27 - g),
        box("oven", 160 + g, 220 - g, body - 1, depth, 27 + g, 77, "glass", detail),
        box("oven controls", 160 + g, 220 - g, body - 1, depth, 77.4, base_h - g, "glass"),
        cyl("oven handle", 190, depth + 3.5, 74, 0.8, 46, "chrome", axis="s"),
        cyl("oven handle", 168, depth + 1.75, 74, 0.5, 3.5, "chrome", axis="d"),
        cyl("oven handle", 212, depth + 1.75, 74, 0.5, 3.5, "chrome", axis="d"),
        front("door", 220, run_end, 10, base_h), pull((220 + run_end) / 2, base_h - g),
    ]
    # granite worktop around the undermount sink; next to the tall unit its 12.5 cm overhang is cut off at 45°
    cs0, cs1 = s_(sink[0]) + 2.5, s_(sink[2]) - 2.5
    cd0, cd1 = d_(sink[3]) + 2.5, d_(sink[1]) - 2.5
    over = top_deep - depth
    west = [loc(s, d) for s, d in ((0, 0), (cs0, 0), (cs0, top_deep), (over, top_deep), (0, depth))]
    parts += [
        {"name": "worktop west end", "shape": "extrusion",
         "points": [[r2(x - west[0][0]), r2(z - west[0][1])] for x, z in west], "height": top_t,
         "position": {"x": r2(west[0][0]), "y": base_h, "z": r2(west[0][1])}, "material": "worktop", "provenance": detail},
        box("worktop front of sink", cs0, cs1, cd1, top_deep, base_h, top, "worktop"),
        box("worktop behind sink", cs0, cs1, 0, cd0, base_h, top, "worktop"),
        box("worktop", cs1, step, 0, top_deep, base_h, top, "worktop",
            prov("medium", "plan", "72.5 cm deep worktop as drawn (overhang to the living room?). "
                 "Checklist {check:kitchen-worktop-depth}.")),
        box("worktop end", step, run_end, 0, top_shallow, base_h, top, "worktop"),
    ]
    bowl = top - 18
    parts += [
        box("sink", cs0, cs1, cd0, cd1, bowl - 0.5, bowl, "steel"),
        box("sink", cs0, cs1, cd0, cd0 + 0.4, bowl, top - 0.05, "steel"),
        box("sink", cs0, cs1, cd1 - 0.4, cd1, bowl, top - 0.05, "steel"),
        box("sink", cs0, cs0 + 0.4, cd0 + 0.4, cd1 - 0.4, bowl, top - 0.05, "steel"),
        box("sink", cs1 - 0.4, cs1, cd0 + 0.4, cd1 - 0.4, bowl, top - 0.05, "steel"),
        cyl("drain", (cs0 + cs1) / 2, (cd0 + cd1) / 2, bowl + 0.1, 3.5, 0.2, "chrome"),
        cyl("tap", cs0 + 9, cd0 - 7, top + 7, 2.3, 14, "chrome"),
        cyl("tap", cs0 + 9, cd0 + 2, top + 11.5, 1.0, 18, "chrome", axis="d"),
        box("tap", cs0 + 8.4, cs0 + 9.6, cd0 - 13, cd0 - 5, top + 14, top + 15.2, "chrome"),
    ]
    hs0, hs1, hd0, hd1 = s_(hob[0]), s_(hob[2]), d_(hob[3]), d_(hob[1])
    hs, hd, qs, qd = (hs0 + hs1) / 2, (hd0 + hd1) / 2, (hs1 - hs0) / 4, (hd1 - hd0) / 4
    parts.append(box("hob", hs0, hs1, hd0, hd1, top - 0.2, top + 0.5, "glass"))
    for ks, kd, r in ((-1, -1, 7.0), (1, -1, 8.5), (-1, 1, 8.5), (1, 1, 6.0)):
        x, z = loc(hs + ks * qs, hd + kd * qd)
        parts.append({"name": "hob zone", "shape": "torus", "radius": r, "tube": 0.25,
                      "position": {"x": r2(x), "y": top + 0.5, "z": r2(z)}, "material": "hob-marks"})
    # wall cabinets: top level with the tall units (both use tall_h). Overhead, so the plan shows them as one dashed
    # outline (the worktop below stays visible); their doors, handles, the shelf and the rail are left out of the plan.
    wc_body = WALL_CABINET_DEPTH - FRONT_T
    door_w = run_end / 6
    parts += [
        box("back panel", 0, run_end, 0, 0.6, top, WALL_CABINET_BOTTOM, "backsplash", detail),
        box("wall cabinets", 0, run_end, 0, wc_body, WALL_CABINET_BOTTOM, tall_h, "carcass",
            prov("medium", "user",
                 "Wall cabinets above the whole base run, top level with the tall units (you); not in the plan.",
                 fields={
                     "size.z": prov("low", "assumed", f"Depth {WALL_CABINET_DEPTH:.0f} cm to the front of the doors "
                                    "assumed. Checklist {check:kitchen-wall-cabinets}."),
                     "size.y": prov("low", "assumed", f"Underside {WALL_CABINET_BOTTOM:.0f} cm above the floor "
                                    "assumed (the top follows the tall units). Checklist {check:kitchen-wall-cabinets}."),
                 }),
            plan_style="dashed"),
    ]
    for i in range(6):
        parts.append(box("wall cabinet door", i * door_w + g, (i + 1) * door_w - g, wc_body, WALL_CABINET_DEPTH,
                         WALL_CABINET_BOTTOM + g, tall_h - g, "fronts", plan_style="hidden"))
    for i in (1, 3, 5):  # one bar per pair of doors, on the eastern door next to the middle of the pair (IMG_4497)
        parts.append(box("wall cabinet handle", i * door_w + 0.6, i * door_w + 3.1, WALL_CABINET_DEPTH,
                         WALL_CABINET_DEPTH + 2, WALL_CABINET_BOTTOM + 2, WALL_CABINET_BOTTOM + 26, "handles",
                         plan_style="hidden"))
    parts += [
        box("open shelf", 2, 82, 0, 18, 132, 134, "carcass", detail, plan_style="hidden"),
        cyl("rail", 122, 5, 141, 0.6, 60, "chrome", axis="s", plan="hidden"),
        cyl("rail holder", 95, 2.5, 141, 0.5, 5, "chrome", axis="d", plan="hidden"),
        cyl("rail holder", 149, 2.5, 141, 0.5, 5, "chrome", axis="d", plan="hidden"),
    ]
    return {
        "id": "kitchen",
        "name": "Kitchen",
        "kind": "kitchen",
        "position": [r1(origin[0]), r1(origin[1])],
        "rotation": 180,
        "parts": parts,
        "materials": {
            "carcass": "kitchen.brown-dark",
            "fronts": "kitchen.light-grey-matt",
            "handles": "wood.walnut-dark",
            "worktop": "stone.granite-light",
            "backsplash": "kitchen.backsplash-greige",
            "steel": "metal.brushed-steel",
            "chrome": "metal.chrome",
            "glass": "glass.black",
            "hob-marks": "lacquer.anthracite",
        },
        "provenance": prov(
            "medium", "plan",
            "Footprint exact from the plan: tall units 42 + 62 cm (60 deep), counter run 261 cm "
            "(214 cm at 72.5 cm depth, 47 cm at 62.5 cm), sink, 4-zone hob. Wall cabinets above the whole counter "
            "run, top level with the tall units (you). Heights from photo IMG_4508 and Swiss standard (worktop 90 cm). "
            "Fronts, handles, oven, tap, shelf and colours from photo IMG_4497: dark brown carcass, light grey fronts "
            "with dark joints, walnut handles, light speckled granite; their sizes are estimates. "
            "Checklist {check:kitchen-worktop-height}-{check:kitchen-tall-units}, {check:kitchen-wall-cabinets}.",
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
    """Sanitary fixtures of the bathroom (rotated 13.93 deg like the whole west wing).

    Footprints from the plan; finishes and fittings from photo IMG_4501 (black 10 cm tiles in the shower and on the
    installation wall, light granite with a shelf, mirror up to the ceiling, glass shower screen, washer/dryer niche).
    All fixtures share the wing's axes: local x towards the west, local z (front) into the room, up the sheet.
    """
    rot = 180 - 13.93
    boxes = {}

    def measure(key, pts):
        boxes[key] = oriented_box(pts, WING_ANGLE)  # centre, size along local x, size along local z

    measure("washer", _points(plan, [656, 657, 658, 659]))
    measure("tray", _points(plan, [586, 660] + list(range(489, 586))))
    measure("basin", _points(plan, [1167] + list(range(1280, 1290))))
    measure("wc", _points(plan, list(range(1147, 1167))))
    # pre-wall (installation wall) behind basin and WC: between line 1168 and the room edge
    measure("prewall", _points(plan, [1168]) + [plan.to_cm((285.62, 427.26)), plan.to_cm((252.06, 435.59))])
    wing = Frame(boxes["basin"][0], rot)

    def rel(key, other):
        """Centre of fixture `other` in the local coordinates of fixture `key`."""
        a, b = wing.local(boxes[key][0]), wing.local(boxes[other][0])
        return b[0] - a[0], b[1] - a[1]

    items = []

    def fixture(fid, name, kind, key, parts, materials, note, fields=None):
        c = boxes[key][0]
        items.append({
            "id": fid,
            "name": name,
            "kind": kind,
            "position": [r1(c[0]), r1(c[1])],
            "rotation": round(rot, 2),
            "parts": parts,
            "materials": materials,
            "provenance": prov("medium", "plan", note, fields),
        })

    photo_heights = {"parts.*.size.y": {"confidence": "low", "source": "photo",
                                        "note": "Heights estimated from photo IMG_4501."}}

    # washer/dryer stack, doors towards the bathroom door (local -x); a dark brown niche next to the shower
    _, w, d = boxes["washer"]
    hw, hd = w / 2, d / 2
    fx = -hw + 1.5  # front of the cabinets; the doors stand out to -hw
    tx, tz = rel("washer", "tray")
    tw, td = boxes["tray"][1], boxes["tray"][2]
    screen_x, wall_x = tx - tw / 2, tx + tw / 2
    panel_z0, panel_z1 = tz + td / 2, -hd - 0.5
    parts = [
        _box("washing machine", fx, hw, 0, 85, -hd, hd, "body", cornerRadius=1),
        _box("tumble dryer", fx, hw, 85.3, 170, -hd, hd, "body", cornerRadius=1),
    ]
    for name, yc, ytop in (("washing machine", 40, 85), ("tumble dryer", 125.3, 170)):
        parts += [
            _cyl(f"{name} door", fx - 0.6, yc, 0, 18.5, 1.2, "body", "x"),
            _cyl(f"{name} door", fx - 1.3, yc, 0, 14, 0.6, "door-glass", "x"),
            {"name": f"{name} door", "shape": "torus", "radius": 15.5, "tube": 1.5,
             "position": {"x": r2(fx - 1.3), "y": yc, "z": 0}, "rotation": {"z": 90}, "material": "chrome"},
            _box(f"{name} controls", fx - 0.3, fx, ytop - 13, ytop - 2, -hd + 1, hd - 1, "panel"),
            _box(f"{name} display", fx - 0.6, fx - 0.3, ytop - 9.5, ytop - 5.5, -5, 7, "door-glass"),
        ]
    parts += [
        _box("niche side panel", screen_x - 0.5, wall_x, 0, ceiling, panel_z0, panel_z1, "niche"),
        _box("niche back panel", wall_x - 1.5, wall_x, 0, ceiling, panel_z1, hd + 3, "niche"),
    ]
    fixture("bath-washer-dryer", "Washer/dryer stack", "appliance", "washer", parts,
            {"body": "lacquer.white", "panel": "ceramic.white", "door-glass": "glass.black", "chrome": "metal.chrome",
             "niche": "kitchen.brown-dark"},
            "WM/TU stack as drawn (about 60 x 57 cm), doors towards the bathroom door. Washer and dryer 85 cm each, "
            "round doors, and the dark brown panels beside and behind the stack: from photo IMG_4501 (low "
            "confidence). Checklist {check:bathroom}.", photo_heights)

    # shower: tray, black tiles on both walls, frameless glass screen with a door on the open (east) side
    _, w, d = boxes["tray"]
    hw, hd = w / 2, d / 2
    px, _ = rel("tray", "prewall")
    shaft_x = px + boxes["prewall"][1] / 2  # corner of the shaft next to the installation wall
    _, mz = rel("tray", "washer")
    niche_z = mz - boxes["washer"][2] / 2 - 0.5
    tiles_top = 250  # rows on a 10 cm grid from 5 cm, so the first full row starts at the tray
    parts = [
        _box("shower tray", -hw, hw, 0, 6, -hd, hd, "body"),
        _cyl("drain", 0, 6.1, 0, 4.5, 0.2, "chrome"),
        _box("wall tiles", shaft_x, hw, 0, tiles_top, -hd, -hd + 1, "tiles"),
        _box("wall tiles", hw - 1, hw, 0, tiles_top, -hd + 1, niche_z, "tiles"),
        _box("shower screen", -hw - 0.4, -hw + 0.4, 6, 200, -hd + 1.5, -hd + 40, "glass"),
        _box("shower door", -hw - 0.4, -hw + 0.4, 6, 200, -hd + 40.5, hd - 0.5, "glass"),
        _box("hinge", -hw - 0.8, -hw + 0.8, 30, 39, -hd + 38.5, -hd + 42, "chrome"),
        _box("hinge", -hw - 0.8, -hw + 0.8, 165, 174, -hd + 38.5, -hd + 42, "chrome"),
        _cyl("support bar", -hw, 203, 0, 0.8, d, "chrome", "z", plan="hidden"),
        _cyl("rain shower", 10, 214, 0, 12.5, 1.2, "chrome", plan="hidden"),
        _cyl("rain shower arm", (10 + hw - 1) / 2, 216, 0, 1.0, hw - 11, "chrome", "x", plan="hidden"),
        _cyl("shower rail", 15, 155, -hd + 4, 0.9, 95, "chrome"),
        _cyl("hand shower", 15, 190, -hd + 7, 3.2, 2.5, "chrome", "z"),
        _cyl("thermostat", 0, 110, -hd + 4.5, 2.5, 30, "chrome", "x"),
    ]
    fixture("bath-shower-tray", "Shower", "sanitary", "tray", parts,
            {"body": "ceramic.white", "chrome": "metal.chrome", "tiles": "tile.black-gloss-10", "glass": "glass.clear"},
            "Tray about 80 x 100 cm as drawn (a shower, not a bathtub). Black 10 cm tiles on both walls, frameless glass "
            "screen with a door, rain shower and hand shower: from photo IMG_4501, positions estimated. "
            "Checklist {check:bathroom}.")

    # washbasin: rim with a tap platform at the back, bowl, single-lever tap, trap into the installation wall
    _, w, d = boxes["basin"]
    hw, hd = w / 2, d / 2
    y0, y1 = 70, 86
    back = -hd + 9
    tap_z = (-hd + back) / 2
    parts = [
        _box("washbasin", -hw, hw, y0, y1, -hd, back, "body", cornerRadius=0.8),
        _box("washbasin", -hw, hw, y0, y1, hd - 3, hd, "body", cornerRadius=0.8),
        _box("washbasin", -hw, -hw + 3, y0, y1, back, hd - 3, "body"),
        _box("washbasin", hw - 3, hw, y0, y1, back, hd - 3, "body"),
        _box("washbasin bowl", -hw + 3, hw - 3, y0, y0 + 4, back, hd - 3, "body"),
        _cyl("drain", 0, y0 + 4.1, (back + hd - 3) / 2, 2, 0.2, "chrome"),
        _cyl("tap", 0, y1 + 5.5, tap_z, 2.2, 11, "chrome"),
        _cyl("tap", 0, y1 + 9, tap_z + 5.5, 0.9, 11, "chrome", "z"),
        _box("tap", -0.6, 0.6, y1 + 11, y1 + 12.2, tap_z - 4, tap_z + 2, "chrome"),
        _cyl("trap", 0, 59, -8, 1.6, 22, "chrome"),
        _cyl("trap", 0, 49, (-hd - 8) / 2, 1.6, hd - 8, "chrome", "z"),
    ]
    fixture("bath-washbasin", "Washbasin", "sanitary", "basin", parts, {"body": "ceramic.white", "chrome": "metal.chrome"},
            "Washbasin as drawn; rim at 86 cm assumed. Shape, single-lever tap and trap from photo IMG_4501.",
            {"parts.*.size.y": {"confidence": "low", "source": "assumed", "note": "Height not in plan (standard value)."}})

    # wall-hung WC with the lid closed (you)
    _, w, d = boxes["wc"]
    hw, hd = w / 2, d / 2
    r = hw - 0.5
    cz = hd - r

    def u_shape(back, rr):
        return [[-rr, r2(back)], [rr, r2(back)]] + [
            [r2(rr * math.cos(math.radians(a))), r2(cz + rr * math.sin(math.radians(a)))] for a in range(0, 181, 15)]

    parts = [
        {"name": "wc bowl", "shape": "extrusion", "points": u_shape(-hd, r), "height": 24,
         "position": {"x": 0, "y": 15, "z": 0}, "material": "body"},
        {"name": "wc seat", "shape": "extrusion", "points": u_shape(-hd + 7, r - 0.5), "height": 2,
         "position": {"x": 0, "y": 39, "z": 0}, "material": "seat"},
        {"name": "wc lid (closed)", "shape": "extrusion", "points": u_shape(-hd + 7, r - 0.5), "height": 2.5,
         "position": {"x": 0, "y": 41, "z": 0}, "material": "seat"},
        _cyl("wc hinge", 0, 42, -hd + 5, 1.2, 14, "seat", "x"),
    ]
    fixture("bath-wc", "WC", "sanitary", "wc", parts, {"body": "ceramic.white", "seat": "lacquer.white"},
            "Wall-hung WC as drawn; seat at 41 cm assumed. The lid is shown closed (you); the flush plate is on the "
            "installation wall.",
            {"parts.*.size.y": {"confidence": "low", "source": "assumed", "note": "Height not in plan (standard value)."}})

    # installation wall: black tiles below, granite band and shelf, mirror up to the ceiling, opal globe light
    _, w, d = boxes["prewall"]
    hw, hd = w / 2, d / 2
    wc_x, _ = rel("prewall", "wc")
    parts = [
        _box("pre-wall", -hw, hw, 0, 80, -hd, hd, "tiles"),
        _box("granite cladding", -hw, hw, 80, 112, -hd, hd, "granite"),
        _box("shelf", -hw, hw, 112, 115, -hd, hd + 1, "granite"),
        # on the wall and on both sides of the recess between the two shafts
        _box("mirror", -hw, hw, 115, ceiling, -hd, -hd + 1, "mirror"),
        _box("mirror", hw - 1, hw, 115, ceiling, -hd + 1, hd, "mirror"),
        _box("mirror", -hw, -hw + 1, 115, ceiling, -hd + 1, hd, "mirror"),
        _box("flush plate", wc_x - 12.3, wc_x + 12.3, 89, 105.4, hd, hd + 0.8, "plate"),
        {"name": "wall light", "shape": "sphere", "radius": 7.5, "position": {"x": r2(hw - 16), "y": 207, "z": 0},
         "material": "light", "plan": "hidden"},
        _cyl("wall light", hw - 4.75, 207, 0, 0.7, 7.5, "chrome", "x", plan="hidden"),
    ]
    fixture("bath-prewall", "Installation wall", "sanitary", "prewall", parts,
            {"tiles": "tile.black-gloss-10", "granite": "stone.granite-light", "mirror": "glass.mirror",
             "plate": "lacquer.white", "light": "glass.opal-lit", "chrome": "metal.chrome"},
            "Installation wall behind washbasin and WC as drawn. From photo IMG_4501, heights estimated: black 10 cm "
            "tiles up to 80 cm, light granite above, granite shelf at 115 cm, mirror from the shelf to the ceiling (also "
            "on the sides of the recess), opal globe light on the shower side. Checklist {check:bathroom}.",
            photo_heights)
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
