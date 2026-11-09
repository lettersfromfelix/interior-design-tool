#!/usr/bin/env python3
"""Draw data/apartment.json on top of the underlay image (visual check of the derived model).

    python tools/floorplan/preview.py   ->  tools/floorplan/out/apartment_preview.png

Uses only the JSON + underlay (no PDF needed), with the same conventions as the engine:
plan x right, z down; rotation clockwise seen from above; parts relative to the fixture origin.
"""
from __future__ import annotations

import json
import math

from PIL import Image, ImageDraw

from pdfgeom import REPO


def rot(p, deg):
    a = math.radians(deg)
    return (p[0] * math.cos(a) - p[1] * math.sin(a), p[0] * math.sin(a) + p[1] * math.cos(a))


def part_footprint(part):
    px, pz = part["position"]["x"], part["position"]["z"]
    yaw = (part.get("rotation") or {}).get("y", 0)
    shape = part["shape"]
    if shape == "box":
        sx, sz = part["size"]["x"], part["size"]["z"]
        pts = [(-sx / 2, -sz / 2), (sx / 2, -sz / 2), (sx / 2, sz / 2), (-sx / 2, sz / 2)]
    elif shape in ("cylinder", "sphere", "torus"):
        r = part.get("radius", 10)
        pts = [(r * math.cos(t / 16 * 2 * math.pi), r * math.sin(t / 16 * 2 * math.pi)) for t in range(16)]
    elif shape == "extrusion":
        pts = [tuple(p) for p in part["points"]]
    else:
        return []
    return [(px + q[0], pz + q[1]) for q in (rot(p, yaw) for p in pts)]


def main():
    ap = json.loads((REPO / "data" / "apartment.json").read_text(encoding="utf-8"))
    u = ap["underlay"]
    img = Image.open(REPO / u["image"]).convert("RGBA")
    W, H = img.size
    sx, sz = W / u["widthCm"], H / (u.get("heightCm") or u["widthCm"] * H / W)

    def T(p):
        return ((p[0] - u["x"]) * sx, (p[1] - u["z"]) * sz)

    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    colors = {"interior": (220, 30, 30, 120), "exterior": (30, 30, 220, 120), "party": (200, 120, 0, 120),
              "glazing": (0, 170, 170, 150)}
    walls = {w["id"]: w for w in ap["walls"]}
    for r in ap["rooms"]:
        dr.polygon([T(p) for p in r["outline"]], outline=(120, 0, 160, 255), width=3)
    for w in ap["walls"]:
        s, e, t = w["start"], w["end"], w["thickness"]
        d = (e[0] - s[0], e[1] - s[1])
        L = math.hypot(*d)
        d = (d[0] / L, d[1] / L)
        n = (d[1], -d[0])
        h = t / 2
        poly = [(s[0] + n[0] * h, s[1] + n[1] * h), (e[0] + n[0] * h, e[1] + n[1] * h),
                (e[0] - n[0] * h, e[1] - n[1] * h), (s[0] - n[0] * h, s[1] - n[1] * h)]
        dr.polygon([T(p) for p in poly], fill=colors[w["kind"]], outline=(0, 0, 0, 255))
    for o in ap["openings"]:
        w = walls[o["wall"]]
        s, e = w["start"], w["end"]
        L = math.dist(s, e)
        d = ((e[0] - s[0]) / L, (e[1] - s[1]) / L)
        n = (d[1], -d[0])
        a = o["centerFromStart"] - o["width"] / 2
        b = o["centerFromStart"] + o["width"] / 2
        h = w["thickness"] / 2 + 1
        q0 = (s[0] + d[0] * a, s[1] + d[1] * a)
        q1 = (s[0] + d[0] * b, s[1] + d[1] * b)
        poly = [(q0[0] + n[0] * h, q0[1] + n[1] * h), (q1[0] + n[0] * h, q1[1] + n[1] * h),
                (q1[0] - n[0] * h, q1[1] - n[1] * h), (q0[0] - n[0] * h, q0[1] - n[1] * h)]
        dr.polygon([T(p) for p in poly], fill=(0, 200, 0, 160) if o["kind"] == "door" else (255, 230, 0, 180))
        if o["kind"] == "door":
            dd = o["door"]
            hinge = q0 if dd["hinge"] == "start" else q1
            other = q1 if dd["hinge"] == "start" else q0
            side = 1 if dd["opensTo"] == "left" else -1
            face = (hinge[0] + n[0] * side * w["thickness"] / 2, hinge[1] + n[1] * side * w["thickness"] / 2)
            lw = dd["leafWidth"]
            tip = (face[0] + n[0] * side * lw, face[1] + n[1] * side * lw)
            dr.line([T(face), T(tip)], fill=(0, 120, 0, 255), width=4)
            along = (other[0] - hinge[0], other[1] - hinge[1])
            la = math.hypot(*along)
            along = (along[0] / la, along[1] / la)
            arc = []
            for k in range(17):
                t = k / 16 * math.pi / 2
                v = (along[0] * math.cos(t) + n[0] * side * math.sin(t), along[1] * math.cos(t) + n[1] * side * math.sin(t))
                arc.append(T((face[0] + v[0] * lw, face[1] + v[1] * lw)))
            dr.line(arc, fill=(0, 120, 0, 255), width=3)
    for f in ap["fixtures"]:
        for part in f["parts"]:
            fp = part_footprint(part)
            if not fp:
                continue
            world = [(f["position"][0] + q[0], f["position"][1] + q[1]) for q in (rot(p, f["rotation"]) for p in fp)]
            dr.polygon([T(p) for p in world], outline=(0, 0, 255, 255), fill=(0, 0, 255, 40), width=3)
    for c in ap.get("checks", []):
        if "from" in c:
            a, b = (c["from"][0], c["from"][2]), (c["to"][0], c["to"][2])
            if math.dist(a, b) > 1:
                dr.line([T(a), T(b)], fill=(255, 0, 255, 255), width=3)
                dr.text(T(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)), c["id"], fill=(255, 0, 255, 255))
    out = Image.alpha_composite(img, ov).convert("RGB")
    out = out.resize((W // 2, H // 2))
    target = REPO / "tools" / "floorplan" / "out" / "apartment_preview.png"
    out.save(target)
    print(f"wrote {target.relative_to(REPO)}")


if __name__ == "__main__":
    main()
