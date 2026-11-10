"""Tape-measure checklist (M01...) derived from the generated apartment model.

Every check has a plan value (what the model currently uses) and, where it makes sense, a
dimension line (from/to, model cm) so the app can show exactly what to measure.
When you measure, put the value into `measured` and tell GHCP, who updates the geometry.

Provenance notes refer to checks as "{check:<key>}"; resolve_check_refs() replaces these with the ids, so the
notes can't point to the wrong item when checks are added or renumbered.
"""
from __future__ import annotations

import json
import math
import re

from pdfgeom import REPO

Y_MEAS = 100.0  # horizontal measurements are drawn 1 m above the floor
CHECK_REF = re.compile(r"\{check:([a-z0-9:-]+)\}")


def resolve_check_refs(obj, keys):
    """Replace "{check:<key>}" in every string of `obj` with the check id; unknown keys are an error."""
    if isinstance(obj, dict):
        return {k: resolve_check_refs(v, keys) for k, v in obj.items()}
    if isinstance(obj, list):
        return [resolve_check_refs(v, keys) for v in obj]
    if isinstance(obj, str):
        def repl(m):
            if m.group(1) not in keys:
                raise KeyError(f"unknown checklist reference {m.group(0)}")
            return keys[m.group(1)]
        return CHECK_REF.sub(repl, obj)
    return obj


def _railing(f):
    """Geometry of a balcony railing fixture (angles in degrees, clockwise on the plan from +x)."""
    top = next(p for p in f["parts"] if p["name"] == "top rail")
    bars = next(p for p in f["parts"] if p["name"] == "bars")
    prof = top["profile"]
    return {"center": tuple(f["position"]), "rc": (prof[0][0] + prof[1][0]) / 2, "inner": prof[0][0],
            "start": top["rotation"]["y"], "sweep": top["arc"], "height": top["position"]["y"] + prof[2][1],
            "first": bars["rotation"]["y"], "step": bars["repeatAround"]["step"]}


def _polar(c, r, deg):
    a = math.radians(deg)
    return (c[0] + r * math.cos(a), c[1] + r * math.sin(a))


def _w(ap, wid):
    return next(w for w in ap["walls"] if w["id"] == wid)


def _find_wall(ap, kind=None, sides=None):
    for w in ap["walls"]:
        if kind and w["kind"] != kind:
            continue
        if sides and set(sides) != set(w["sides"].values()):
            continue
        return w
    raise KeyError(f"wall kind={kind} sides={sides}")


def _dir(w):
    dx, dz = w["end"][0] - w["start"][0], w["end"][1] - w["start"][1]
    L = math.hypot(dx, dz)
    return (dx / L, dz / L)


def _face(w, room):
    """(point, direction, normal-into-room) of the wall face that looks into `room`."""
    d = _dir(w)
    n_left = (d[1], -d[0])
    side = next(s for s, r in w["sides"].items() if r == room)
    n = n_left if side == "left" else (-n_left[0], -n_left[1])
    h = w["thickness"] / 2
    p = (w["start"][0] + n[0] * h, w["start"][1] + n[1] * h)
    return p, d, n


def _project(p, line_p, line_d):
    t = (p[0] - line_p[0]) * line_d[0] + (p[1] - line_p[1]) * line_d[1]
    return (line_p[0] + line_d[0] * t, line_p[1] + line_d[1] * t)


def _intersect(p, d, q, e):
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-9:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + d[0] * t, p[1] + d[1] * t)


def _centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _room(ap, rid):
    return next(r for r in ap["rooms"] if r["id"] == rid)


def _across(ap, wall_a, wall_b, room, at=None):
    """Clear distance between two parallel wall faces of `room`, measured through `at` (default: room centroid)."""
    pa, da, na = _face(wall_a, room)
    pb, db, nb = _face(wall_b, room)
    c = at or _centroid(_room(ap, room)["outline"])
    a = _project(c, pa, da)
    b = _intersect(a, na, pb, db)
    return a, b


def _seg(a, b, y=Y_MEAS):
    return [round(a[0], 1), y, round(a[1], 1)], [round(b[0], 1), y, round(b[1], 1)]


def _opening_points(ap, oid):
    o = next(x for x in ap["openings"] if x["id"] == oid)
    w = _w(ap, o["wall"])
    d = _dir(w)
    s0 = o["centerFromStart"] - o["width"] / 2
    s1 = o["centerFromStart"] + o["width"] / 2
    a = (w["start"][0] + d[0] * s0, w["start"][1] + d[1] * s0)
    b = (w["start"][0] + d[0] * s1, w["start"][1] + d[1] * s1)
    return o, w, a, b


def build_checklist(ap):
    """Returns (checks, keys); keys maps the names used in "{check:<key>}" references to check ids."""
    checks, keys = [], {}

    def add(cid, title, how, value, priority="must", line=None, refs=(), unit="cm", key=None):
        c = {"id": cid, "title": title, "how": how, "priority": priority, "unit": unit,
             "planValue": round(value, 1)}
        if line:
            c["from"], c["to"] = line
        if refs:
            c["refs"] = list(refs)
        checks.append(c)
        if key:
            keys[key] = cid

    def dist(a, b):
        return math.dist(a, b)

    living_c = _centroid(_room(ap, "living")["outline"])
    add("M01", "Ceiling height",
        "Floor to ceiling in the living room; repeat in Zimmer 15.9 and the Entrée to confirm it is the same everywhere.",
        ap["ceilingHeight"], line=([round(living_c[0], 1), 0, round(living_c[1], 1)],
                                   [round(living_c[0], 1), ap["ceilingHeight"], round(living_c[1], 1)]), key="ceiling")

    part = _find_wall(ap, "interior", ["entree", "zimmer-15-9"])
    east = _find_wall(ap, "exterior", ["zimmer-15-9"])
    kwall = _find_wall(ap, "interior", ["living", "zimmer-15-9"])
    south = _find_wall(ap, "party", ["zimmer-15-9"])
    a, b = _across(ap, part, east, "zimmer-15-9")
    add("M02", "Zimmer 15.9 - clear width", "Wall to wall from the Entrée wall to the outer wall, about in the middle of the room.",
        dist(a, b), line=_seg(a, b), refs=[part["id"], east["id"]])
    a, b = _across(ap, kwall, south, "zimmer-15-9")
    add("M03", "Zimmer 15.9 - clear depth", "Wall to wall from the kitchen wall to the opposite wall.",
        dist(a, b), line=_seg(a, b), refs=[kwall["id"], south["id"]])

    part13 = _find_wall(ap, "interior", ["living", "zimmer-13-0"])
    west13 = next(w for w in ap["walls"] if w["kind"] == "party" and list(w["sides"].values()) == ["zimmer-13-0"]
                  and abs(_dir(w)[0]) < 0.5)
    north13 = _find_wall(ap, "exterior", ["zimmer-13-0"])
    south13 = next(w for w in ap["walls"] if w["kind"] == "party" and list(w["sides"].values()) == ["zimmer-13-0"]
                   and abs(_dir(w)[0]) > 0.5)
    a, b = _across(ap, part13, west13, "zimmer-13-0")
    add("M04", "Zimmer 13.0 - clear width", "Wall to wall, perpendicular to the long walls, in the middle of the room.",
        dist(a, b), line=_seg(a, b), refs=[part13["id"], west13["id"]])
    a, b = _across(ap, north13, south13, "zimmer-13-0")
    add("M05", "Zimmer 13.0 - clear length", "From the window wall (balcony side) to the opposite wall.",
        dist(a, b), line=_seg(a, b), refs=[north13["id"], south13["id"]])

    # kitchen wall, living-room side: from the Entrée door reveal to the Zimmer 15.9 door reveal
    _, _, _, e1 = _opening_points(ap, "d-entree-living")
    _, _, z0, _ = _opening_points(ap, "d-living-zimmer-15-9")
    pk, dk, nk = _face(kwall, "living")
    a = _project(e1, pk, dk)
    b = _project(z0, pk, dk)
    add("M06", "Kitchen wall (living-room side) between the two door frames",
        "Along the wall behind the kitchen, from the frame of the Entrée door to the frame of the door to Zimmer 15.9.",
        dist(a, b), line=_seg(a, b, 220), refs=[kwall["id"]])

    col = next(f for f in ap["fixtures"] if f["id"] == "column")
    cpos = tuple(col["position"])
    a = _project(cpos, pk, dk)
    add("M07", "Column - distance to the kitchen wall", "From the kitchen wall (living side) to the centre of the column.",
        dist(a, cpos), line=_seg(a, cpos), refs=["column"], key="column-wall")
    best = None
    for w in ap["walls"]:
        if w["kind"] != "glazing" or "living" not in w["sides"].values():
            continue
        pg, dg, ng = _face(w, "living")
        q = _project(cpos, pg, dg)
        if best is None or dist(q, cpos) < best[0]:
            best = (dist(q, cpos), q, w["id"])
    add("M08", "Column - distance to the window", "From the centre of the column to the glass/frame of the nearest window.",
        best[0], line=_seg(cpos, best[1]), refs=["column", best[2]], key="column-window")
    add("M09", "Column - diameter", "Diameter of the round column.", col["parts"][0]["radius"] * 2, refs=["column"],
        key="column-diameter")

    ewest = next(w for w in ap["walls"] if w["kind"] == "party" and "entree" in w["sides"].values()
                 and abs(_dir(w)[0]) < 0.1 and w["start"][0] < 700)
    eeast = next(w for w in ap["walls"] if w["kind"] == "party" and "entree" in w["sides"].values()
                 and abs(_dir(w)[0]) < 0.1 and w["start"][0] > 700)
    ward = next(f for f in ap["fixtures"] if f["id"] == "built-in-wardrobe")
    at = (ward["position"][0], ward["position"][1] - 60)
    a, b = _across(ap, ewest, eeast, "entree", at=at)
    add("M10", "Entrée - width at the built-in wardrobe", "Wall to wall just in front of the built-in wardrobe.",
        dist(a, b), line=_seg(a, b), refs=[ewest["id"], eeast["id"]])
    kentree = _find_wall(ap, "interior", ["entree", "living"])
    pe, de, ne = _face(kentree, "entree")
    front_z = ward["position"][1] - 32.0
    top = _project((ward["position"][0], 0), pe, de)
    a, b = (ward["position"][0], top[1]), (ward["position"][0], front_z)
    add("M11", "Entrée - length to the built-in wardrobe",
        "From the wall with the living-room door to the doors of the built-in wardrobe.",
        dist(a, b), line=_seg(a, b), refs=[kentree["id"], "built-in-wardrobe"])

    bath_n = _find_wall(ap, "interior", ["bath", "living"])
    bath_s = next(w for w in ap["walls"] if w["kind"] == "party" and list(w["sides"].values()) == ["bath"]
                  and abs(_dir(w)[0]) > 0.5)
    a, b = _across(ap, bath_n, bath_s, "bath")
    add("M12", "Bad - clear length", "From the wall to the living room to the wall behind washbasin/WC.",
        dist(a, b), priority="nice", line=_seg(a, b), refs=[bath_n["id"], bath_s["id"]])

    doors = [("M13", "d-entrance", "Entrance door"), ("M14", "d-entree-living", "Door Entrée - living room"),
             ("M15", "d-entree-zimmer-15-9", "Door Entrée - Zimmer 15.9"),
             ("M16", "d-living-zimmer-15-9", "Door living room - Zimmer 15.9"),
             ("M17", "d-living-zimmer-13-0", "Door living room - Zimmer 13.0"), ("M18", "d-bath-entree", "Door Entrée - Bad")]
    for cid, oid, title in doors:
        o, w, a, b = _opening_points(ap, oid)
        add(cid, f"{title} - opening width",
            "Clear width between the wall reveals (left and right of the door frame), and check the swing direction.",
            o["width"], line=_seg(a, b, 150), refs=[oid], key=f"door-width:{oid}")
    o, w, a, b = _opening_points(ap, "d-entree-living")
    add("M19", "Interior doors - opening height", "Floor to the underside of the door frame (all interior doors).",
        o["height"], line=([round(a[0], 1), 0, round(a[1], 1)], [round(a[0], 1), o["height"], round(a[1], 1)]),
        refs=[x["id"] for x in ap["openings"] if x["kind"] == "door" and x["height"] == o["height"]], key="door-height")
    o, w, a, b = _opening_points(ap, "d-entrance")
    add("M20", "Entrance door - opening height", "Floor to the underside of the door frame.", o["height"],
        line=([round(a[0], 1), 0, round(a[1], 1)], [round(a[0], 1), o["height"], round(a[1], 1)]), refs=["d-entrance"],
        key="entrance-height")

    wins = [x for x in ap["openings"] if x["kind"] == "window" and x["window"]["operation"] != "fixed"]
    two = next(x for x in wins if x["window"]["sashes"] == 2)
    o, w, a, b = _opening_points(ap, two["id"])
    add("M21", "French window (2 sashes) - width", "Glass/frame width of one double French window unit (between the dark posts).",
        o["width"], line=_seg(a, b, 150), refs=[two["id"]], key="window-width")
    add("M22", "French windows - opening height", "Floor to the top of the window frame; confirm there is no sill.",
        o["height"], line=([round(a[0], 1), 0, round(a[1], 1)], [round(a[0], 1), o["height"], round(a[1], 1)]),
        refs=[x["id"] for x in wins], key="window-height")
    juliet = [x for x in ap["openings"] if x["kind"] == "window" and x["window"].get("railing")]
    rails = [f for f in ap["fixtures"] if f["kind"] == "railing"]
    rail_refs = [x["id"] for x in juliet] + [f["id"] for f in rails]
    br = _railing(rails[0])
    mid = _polar(br["center"], br["rc"], br["start"] + br["sweep"] / 2)
    add("M23", "Railings - height",
        "Floor to the top of the railing, outside the French windows and on both balconies.",
        juliet[0]["window"]["railing"]["height"], priority="nice", refs=rail_refs, key="railing-height",
        line=([round(mid[0], 1), 0, round(mid[1], 1)], [round(mid[0], 1), round(br["height"], 1), round(mid[1], 1)]))
    bd = next(x for x in ap["openings"] if x["kind"] == "door" and x["door"]["style"] == "glazed" and "balcony" in x["id"])
    o, w, a, b = _opening_points(ap, bd["id"])
    add("M24", "Balcony doors - width and height", "Clear width between the reveals; height floor to the top of the frame.",
        o["width"], line=_seg(a, b, 150), refs=[x["id"] for x in ap["openings"] if "balcony" in x["id"]],
        key="balcony-doors")
    # inner diameter parallel to the façade: perpendicular to the axis of the open side (towards the doors)
    axis = br["start"] - (360 - br["sweep"]) / 2
    a, b = _polar(br["center"], br["inner"], axis + 90), _polar(br["center"], br["inner"], axis - 90)
    add("M25", "Balcony - inner diameter",
        "Across the round balcony, from the inside of the railing to the inside of the railing, parallel to the façade.",
        dist(a, b), priority="nice", line=_seg(a, b, 50),
        refs=[r["id"] for r in ap["rooms"] if r["kind"] == "balcony"] + [f["id"] for f in rails], key="balcony-diameter")

    k = next(f for f in ap["fixtures"] if f["id"] == "kitchen")
    top_part = next(p for p in k["parts"] if p["name"] == "worktop")
    tall = next(p for p in k["parts"] if p["name"] == "tall unit 42")
    add("M26", "Kitchen - worktop height", "Floor to the top of the worktop.",
        top_part["position"]["y"] + top_part["size"]["y"] / 2, refs=["kitchen"], key="kitchen-worktop-height")
    add("M27", "Kitchen - worktop depth and run length",
        "Depth: wall to the front edge of the worktop (sink area). Length: tall units + counter, wall-side.",
        top_part["size"]["z"], refs=["kitchen"], key="kitchen-worktop-depth")
    add("M28", "Kitchen - tall units height and widths", "Height of the tall units (floor to top) and the width of each.",
        tall["size"]["y"], refs=["kitchen"], key="kitchen-tall-units")
    ward_box = next(p for p in ward["parts"] if p["name"] == "carcass")
    add("M29", "Built-in wardrobe - width, depth, height", "Outer size of the built-in wardrobe at the end of the Entrée.",
        ward_box["size"]["x"], refs=["built-in-wardrobe"], key="wardrobe")
    add("M30", "Wall thickness at door reveals",
        "Reveal depth at an interior door (expected 18 cm) and at a balcony door (outer wall).", part["thickness"],
        priority="nice", refs=[part["id"]], key="wall-thickness")
    add("M31", "North direction", "Optional: compass bearing of the kitchen wall direction (phone compass).",
        ap["north"]["planUpBearing"] + 90.0, priority="nice", unit="deg", key="north")
    add("M32", "Bathroom fixtures",
        "Optional: positions and sizes of shower, washbasin, WC and washer/dryer, and the heights of the granite shelf "
        "(model: 115 cm) and of the black tiles on the installation wall (model: 80 cm).",
        0.0, priority="nice", refs=[f["id"] for f in ap["fixtures"] if f["id"].startswith("bath-")], key="bathroom")

    b0 = _polar(br["center"], br["rc"], br["first"])
    b1 = _polar(br["center"], br["rc"], br["first"] + br["step"])
    add("M33", "Railings - bar spacing and bar size",
        "Centre-to-centre distance between two neighbouring vertical bars, and the size of one flat bar "
        "(width × thickness). Check a French window and a balcony; are they the same?",
        juliet[0]["window"]["railing"]["barSpacing"], priority="nice", line=_seg(b0, b1, 50), refs=rail_refs,
        key="railing-bars")
    wall_cab = next(p for p in k["parts"] if p["name"] == "wall cabinets")
    add("M34", "Kitchen - wall cabinets: underside height and depth",
        "Floor to the underside of the wall cabinets, and their depth from the wall to the front of the doors. "
        "Also confirm that their top is level with the top of the tall units.",
        wall_cab["position"]["y"] - wall_cab["size"]["y"] / 2, refs=["kitchen"], key="kitchen-wall-cabinets")
    floor = next(p for p in json.loads((REPO / "data" / "materials.json").read_text(encoding="utf-8"))["presets"]
                 if p["id"] == ap["defaults"]["floorMaterial"])
    add("M35", "Floor tiles - size",
        "Optional: edge length of one stone floor tile, joint to joint (the model's tiles are estimated from the photos).",
        floor["pattern"]["scale"], priority="nice", key="floor-tiles")
    return checks, keys
