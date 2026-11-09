#!/usr/bin/env python3
"""Build data/apartment.json from the floor-plan PDF.

    python tools/floorplan/build_apartment.py            # writes data/apartment.json (+ debug overlay)
    python tools/floorplan/build_apartment.py --force    # overwrite even if it contains measured values

The PDF is local-only (reference/floorplan.pdf, gitignored). Run this once to (re)derive the
geometry. After tape-measure corrections have been applied to data/apartment.json, the file is
the source of truth: the script refuses to overwrite it unless --force is given.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

from checklist import build_checklist, resolve_check_refs
from fixtures import RAILING, balconies, bathroom, built_in_wardrobe, column, kitchen, prov, r1
from geom2d import Region, add, dot, left_normal, mul, polygon_area, sub
from pdfgeom import ORIGIN_PT, REPO, load_plan
from walls import attach_doors, sample_room_edges
from walls_build import assign_sides, edge_pieces, glazing_walls, merge_pieces

CEILING = 255.0  # cm, given by the user
DOOR_HEIGHT = 205.0  # interior doors (not in plan; estimated)
ENTRANCE_HEIGHT = 210.0
FRENCH_HEIGHT = 230.0  # French windows and balcony doors (estimated from IMG_4508)
LOCATION = {"latitude": 47.38, "longitude": 8.54, "timeZone": "Europe/Zurich"}  # city level, for the sun
# Door leaf styles you confirmed (other interior doors are assumed solid; balcony doors are glazed)
USER_DOOR_STYLES = {"d-entree-living": "glazed", "d-entree-zimmer-15-9": "solid", "d-living-zimmer-15-9": "solid"}
# How far interior doors can be opened (you); balcony doors and the entrance door open 90° as drawn
INTERIOR_DOOR_MAX_OPENING = 180

ROOM_LABELS = {"Wohnen/Essen": ("living", "Wohnen/Essen"), "Bad": ("bath", "Bad"), "Entrée": ("entree", "Entrée")}


def identify_rooms(plan):
    texts = plan.texts()
    rooms, meta = {}, {}
    for idx, poly in plan.room_fills():
        inside = [t for t in texts if _inside(t, poly)]
        labels = [t[0] for t in inside]
        area_txt = next((t[0] for t in inside if re.match(r"^\d+\.\d m$", t[0])), None)
        area = float(area_txt.split()[0]) if area_txt else None
        if "Zimmer" in labels:
            rid, name = f"zimmer-{str(area).replace('.', '-')}", f"Zimmer {area}"
        else:
            rid, name = next(ROOM_LABELS[k] for k in ROOM_LABELS if k in labels)
        rooms[rid] = poly
        meta[rid] = {"name": name, "labelledArea": area}
    return rooms, meta


def _inside(t, poly):
    from geom2d import point_in_polygon
    bb = t[1]
    return point_in_polygon(((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2), poly)


def build(force=False):
    plan = load_plan()
    K = plan.pt_to_cm
    cm = plan.to_cm
    rooms, meta = identify_rooms(plan)
    poche_paths = plan.wall_poche()
    poche = Region([p for _, p in poche_paths if _span(p) > 6])
    arcs = plan.arcs()
    door_arcs = [a for a in arcs if 80 <= a.sweep_deg <= 100 and 70 <= a.radius * K <= 105]
    bdoor_arcs = [a for a in arcs if 25 <= a.sweep_deg <= 35 and 85 <= a.radius * K <= 100]
    sash_arcs = [a for a in arcs if 10 <= a.sweep_deg <= 35 and 35 <= a.radius * K <= 60]

    edges = sample_room_edges(rooms, poche, K)
    attach_doors(edges, door_arcs, K)
    walls = merge_pieces(edge_pieces(edges, K), poche, K)
    walls += glazing_walls(edges, sash_arcs, bdoor_arcs, K)
    walls = assign_sides(walls, rooms, K)
    glazing_edges = [(e.a, e.b) for e in edges if e.neighbor is None and all(r.kind == "gap" for r in e.runs)]

    bal_rooms, bal_fixtures = balconies(plan, rooms, poche, glazing_edges)
    bal_centers = {r["id"]: _centroid(r["outline"]) for r in bal_rooms}

    wall_json, opening_json = [], []
    used = {}
    for w in sorted(walls, key=_wall_sort_key(plan)):
        wid = _unique(_wall_id(w), used)
        w.id = wid
        p0, p1 = cm(w.p0), cm(w.p1)
        entry = {
            "id": wid,
            "kind": w.kind,
            "start": [r1(p0[0]), r1(p0[1])],
            "end": [r1(p1[0]), r1(p1[1])],
            "thickness": r1(w.thickness * K),
            "sides": {k: v for k, v in (("left", w.left), ("right", w.right)) if v},
            "provenance": _wall_prov(w, K),
        }
        wall_json.append(entry)
        for o in w.openings:
            opening_json.append(_opening(o, w, K, plan, used, bal_centers))

    fixtures = [kitchen(plan), built_in_wardrobe(plan, CEILING), column(plan, poche_paths, CEILING)]
    fixtures += bathroom(plan, CEILING)
    fixtures += bal_fixtures

    room_json = []
    for rid, poly in rooms.items():
        outline = [[r1(x), r1(z)] for x, z in (cm(p) for p in poly)]
        area = abs(polygon_area([cm(p) for p in poly])) / 1e4
        room_json.append({
            "id": rid,
            "name": meta[rid]["name"],
            "kind": "indoor",
            "outline": outline,
            "labelledArea": meta[rid]["labelledArea"],
            "provenance": prov("high", "plan", f"Room fill polygon of the plan; computed area {area:.2f} m2 "
                               f"(printed {meta[rid]['labelledArea']} m2). Interior walls at their centre line (BWF)."),
        })
    room_json += bal_rooms

    north = plan.north_arrow()
    plan_up_bearing = -math.degrees(math.atan2(north[0], -north[1]))
    apartment = {
        "$schema": "../schemas/apartment.schema.json",
        "schemaVersion": 1,
        "name": "Wohnung 33 (3.5 Zimmer)",
        "ceilingHeight": CEILING,
        "north": {"planUpBearing": round(plan_up_bearing, 1)},
        "location": LOCATION,
        "defaults": {
            "wallMaterial": "paint.light-grey",
            "floorMaterial": "floor.stone-beige",
            "ceilingMaterial": "paint.white",
            "doorLeafMaterial": "door.light-grey",
            "doorFrameMaterial": "frame.anthracite",
            "windowFrameMaterial": "frame.anthracite",
            "sashMaterial": "frame.white",
            "glassMaterial": "glass.clear",
            "railingMaterial": "metal.railing",
        },
        "source": {
            "pdfScale": "1:100",
            "ptToCm": round(K, 5),
            "originPt": list(ORIGIN_PT),
            "note": "Model x/z (cm) = (PDF point - originPt) * ptToCm. Derived by tools/floorplan/build_apartment.py.",
        },
        "underlay": json.loads((REPO / "tools" / "floorplan" / "out" / "underlay.json").read_text())
        if (REPO / "tools" / "floorplan" / "out" / "underlay.json").exists() else None,
        "provenance": prov("high", "plan", "Geometry extracted from the vector floor plan (1:100).", {
            "ceilingHeight": {"confidence": "high", "source": "user",
                              "note": "Given by you (255 cm). Checklist {check:ceiling}."},
            "north": {"confidence": "medium", "source": "plan",
                      "note": "From the plan's north arrow. Checklist {check:north}."},
            "location": {"confidence": "medium", "source": "assumed", "note": "City-level coordinates (Zurich)."},
        }),
        "rooms": room_json,
        "walls": wall_json,
        "openings": opening_json,
        "fixtures": fixtures,
    }
    if apartment["underlay"] is None:
        del apartment["underlay"]
    apartment["checks"], check_keys = build_checklist(apartment)
    apartment = resolve_check_refs(apartment, check_keys)

    target = REPO / "data" / "apartment.json"
    if target.exists() and not force and '"measured"' in target.read_text(encoding="utf-8"):
        sys.exit("data/apartment.json contains measured values - refusing to overwrite (use --force).")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(apartment, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {target.relative_to(REPO)}: {len(room_json)} rooms, {len(wall_json)} walls, "
          f"{len(opening_json)} openings, {len(fixtures)} fixtures, {len(apartment['checks'])} checks")
    for r in room_json:
        pts = r["outline"]
        print(f"  {r['id']:12s} area {abs(polygon_area(pts)) / 1e4:6.2f} m2  printed {r.get('labelledArea')}")
    return apartment


def _span(poly):
    xs = [p[0] for p in poly]
    return max(xs) - min(xs)


def _centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _wall_sort_key(plan):
    def key(w):
        order = {"interior": 0, "exterior": 1, "party": 2, "glazing": 3}
        a = plan.to_cm(w.p0)
        return (order[w.kind], round(a[1] / 50), a[0])
    return key


def _wall_id(w):
    sides = [s for s in (w.left, w.right) if s]
    if w.kind == "glazing":
        return f"w-{sides[0] if sides else 'x'}-glazing"
    if len(sides) == 2:
        return "w-" + "-".join(sorted(sides))
    return f"w-{sides[0] if sides else 'x'}-{w.kind}"


def _unique(base, used):
    n = used.get(base, 0) + 1
    used[base] = n
    return base if n == 1 else f"{base}-{n}"


def _wall_prov(w, K):
    t = w.thickness * K
    if w.kind == "glazing":
        return prov("medium", "plan", "Glazing line from the plan; frame depth 12 cm assumed.",
                    {"thickness": {"confidence": "low", "source": "assumed", "note": "Window frame depth not in plan."}})
    return prov("high", "plan", f"{t:.0f} cm wall from the plan's wall poche. Checklist {{check:wall-thickness}} (reveal depth).")


def _opening(o, w, K, plan, used, bal_centers):
    d = w.d
    n = left_normal(d)
    width = (o.s1 - o.s0) * K
    entry = {"kind": o.kind, "wall": w.id, "centerFromStart": r1((o.s0 + o.s1) / 2 * K), "width": r1(width)}
    if o.kind == "door":
        arc = o.arc
        rel = sub(arc.center, w.p0)
        s_h = dot(rel, d)
        hinge = "start" if abs(s_h - o.s0) <= abs(s_h - o.s1) else "end"
        tips = [arc.start, arc.end]
        far = max(tips, key=lambda t: abs(dot(sub(t, w.p0), n)))
        opens = "left" if dot(sub(far, w.p0), n) > 0 else "right"
        balcony = w.kind == "glazing"
        entrance = w.kind == "party"
        rooms = [s for s in (w.left, w.right) if s]
        if balcony:
            mid = plan.to_cm(add(w.p0, mul(d, (o.s0 + o.s1) / 2)))
            bal = min(bal_centers, key=lambda b: math.dist(bal_centers[b], mid))
            did = _unique(f"d-{rooms[0]}-{bal}", used)
        elif entrance:
            did = _unique("d-entrance", used)
        else:
            did = _unique("d-" + "-".join(sorted(rooms)), used)
        height = FRENCH_HEIGHT if balcony else ENTRANCE_HEIGHT if entrance else DOOR_HEIGHT
        style = "glazed" if balcony else USER_DOOR_STYLES.get(did, "solid")
        interior = not balcony and not entrance
        entry = {"id": did, **entry, "height": height, "sill": 0,
                 "door": {"hinge": hinge, "opensTo": opens, "leaves": 1, "leafWidth": round(arc.radius * K * 2) / 2,
                          "style": style, **({"isEntrance": True} if entrance else {}),
                          **({"maxOpening": INTERIOR_DOOR_MAX_OPENING} if interior else {})}}
        check = "{check:balcony-doors}" if balcony else f"{{check:door-width:{did}}}"
        height_check = "{check:balcony-doors}" if balcony else "{check:entrance-height}" if entrance else "{check:door-height}"
        fields = {"height": {"confidence": "low", "source": "photo",
                             "note": f"Door height not in plan; estimated from the photos. Checklist {height_check}."}}
        if did in USER_DOOR_STYLES:
            kind = "Glass door" if style == "glazed" else "Solid door"
            fields["door.style"] = {"confidence": "high", "source": "user", "note": f"{kind} (you)."}
        elif interior:
            fields["door.style"] = {"confidence": "medium", "source": "assumed",
                                    "note": "Assumed solid like the other room doors."}
        if interior:
            fields["door.maxOpening"] = {"confidence": "high", "source": "user",
                                         "note": "Interior doors open up to 180° (you). The app stops a leaf earlier "
                                                 "where it would meet a wall or a fixture."}
        entry["provenance"] = prov("high" if not balcony else "medium", "plan",
                                   f"Opening between the wall reveals from the plan; leaf {arc.radius * K:.0f} cm and "
                                   f"swing from the door arc. Checklist {check}.", fields)
    else:
        room = w.left or w.right
        n_win = used.get(f"#win-{room}", 0) + 1
        used[f"#win-{room}"] = n_win
        wid = f"win-{room}-{n_win}"
        fixed = o.fixed
        win = {"sashes": max(1, len(o.arcs)) if not fixed else 1,
               "operation": "fixed" if fixed else "casement"}
        if not fixed:
            win["opensTo"] = "left" if w.left else "right"
        win["railing"] = dict(RAILING)
        bars = (f"Vertical flat bars {RAILING['barWidth']:.0f} x {RAILING['barThickness']:.0f} cm about every "
                f"{RAILING['barSpacing']:.0f} cm, same style as the balcony railings (you); bar size and spacing "
                "assumed. Checklist {check:railing-bars}.")
        entry = {"id": wid, **entry, "height": FRENCH_HEIGHT, "sill": 0, "window": win,
                 "provenance": prov("medium", "plan", "French window (floor to almost ceiling) as drawn; "
                                    f"{win['sashes']} sash(es) from the plan.", {
                                        "height": {"confidence": "low", "source": "photo",
                                                   "note": "Window height estimated from IMG_4508. "
                                                           "Checklist {check:window-height}."},
                                        "window.railing.height": {"confidence": "low", "source": "photo",
                                                                  "note": "Juliet railing outside; height estimated "
                                                                          "from IMG_4508. Checklist {check:railing-height}."},
                                        "window.railing.bar*": {"confidence": "low", "source": "assumed", "note": bars}})}
    return entry


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    build(args.force)


if __name__ == "__main__":
    main()
