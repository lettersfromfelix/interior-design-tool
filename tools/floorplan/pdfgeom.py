"""Vector geometry access for the apartment floor plan PDF.

Dev-only helper (Python 3.12 + PyMuPDF). The PDF itself is local-only (gitignored,
it contains the street address); this module documents and reproduces how the
geometry in data/apartment.json was derived from it.

Coordinate conventions
----------------------
* PDF space: points (pt), origin top-left of the page, y pointing down.
* Model space: centimetres, plan x = right on the sheet, plan z = down on the sheet.
  x_cm = (x_pt - ORIGIN_PT[0]) * pt_to_cm,  z_cm = (y_pt - ORIGIN_PT[1]) * pt_to_cm
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF

REPO = Path(__file__).resolve().parents[2]
PDF_PATH = REPO / "reference" / "floorplan.pdf"

# Model origin in PDF points: just above/left of the apartment's bounding box
# (balconies included), so every model coordinate is positive.
ORIGIN_PT = (128.0, 194.0)

# Drawing-style signatures used by this particular plan (see tools/floorplan/README.md).
ROOM_FILL = (0.706, 0.804, 0.82)
WHITE = (1.0, 1.0, 1.0)
W_THICK = 0.992  # cut walls outline
W_MEDIUM = 0.425  # doors, windows, kitchen, sanitary, railings, stairs
W_HAIR = 0.057  # suggested furniture (ignored)
W_SCALE = 0.283  # scale bar and north arrow
W_NORTH = 1.417  # north arrow needle


def _close(a, b, tol=1e-3):
    return abs(a - b) <= tol


def same_style(color, ref, tol=0.01):
    return color is not None and all(abs(c - r) <= tol for c, r in zip(color, ref))


def bezier(p0, p1, p2, p3, n=16):
    pts = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        pts.append((
            mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
            mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
        ))
    return pts


def path_to_polylines(items, curve_steps=16):
    """Convert PyMuPDF drawing items into a list of point lists (sub-paths)."""
    polys: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    last = None
    for it in items:
        kind = it[0]
        if kind == "l":
            a, b = (it[1].x, it[1].y), (it[2].x, it[2].y)
            if last is None or not (_close(a[0], last[0]) and _close(a[1], last[1])):
                if cur:
                    polys.append(cur)
                cur = [a]
            cur.append(b)
            last = b
        elif kind == "c":
            a = (it[1].x, it[1].y)
            c1, c2, b = (it[2].x, it[2].y), (it[3].x, it[3].y), (it[4].x, it[4].y)
            if last is None or not (_close(a[0], last[0]) and _close(a[1], last[1])):
                if cur:
                    polys.append(cur)
                cur = [a]
            cur.extend(bezier(a, c1, c2, b, curve_steps))
            last = b
        elif kind == "re":
            r = it[1]
            if cur:
                polys.append(cur)
                cur = []
            polys.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
            last = None
        elif kind == "qu":
            q = it[1]
            if cur:
                polys.append(cur)
                cur = []
            polys.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)])
            last = None
    if cur:
        polys.append(cur)
    out = []
    for p in polys:
        if len(p) > 2 and _close(p[0][0], p[-1][0]) and _close(p[0][1], p[-1][1]):
            p = p[:-1]
        out.append(p)
    return out


def polygon_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


def point_in_polygon(p, pts):
    x, y = p
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y):
            xin = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xin:
                inside = not inside
        j = i
    return inside


@dataclass
class Arc:
    """A circular arc (door swing or window sash) recovered from cubic Beziers."""
    center: tuple[float, float]
    radius: float
    start: tuple[float, float]
    end: tuple[float, float]
    sweep_deg: float
    path_index: int


@dataclass
class Plan:
    doc: fitz.Document
    page: fitz.Page
    drawings: list
    pt_to_cm: float = 0.0
    scale_ticks: dict = field(default_factory=dict)

    # ---------- coordinate transform ----------
    def to_cm(self, p):
        return ((p[0] - ORIGIN_PT[0]) * self.pt_to_cm, (p[1] - ORIGIN_PT[1]) * self.pt_to_cm)

    def len_cm(self, d_pt):
        return d_pt * self.pt_to_cm

    # ---------- classified geometry ----------
    def paths(self, *, kind=None, width=None, fill=None, bbox=None):
        out = []
        for i, d in enumerate(self.drawings):
            if kind and d["type"] != kind:
                continue
            if width is not None and not _close(d.get("width") or 0, width, 0.01):
                continue
            if fill is not None and not same_style(d.get("fill"), fill):
                continue
            if bbox is not None:
                r = d["rect"]
                if r.x1 < bbox[0] or r.x0 > bbox[2] or r.y1 < bbox[1] or r.y0 > bbox[3]:
                    continue
            out.append((i, d))
        return out

    def room_fills(self):
        return [(i, path_to_polylines(d["items"])[0]) for i, d in self.paths(kind="f", fill=ROOM_FILL)]

    def wall_poche(self):
        """White-filled wall polygons (cut walls). Excludes the header box."""
        polys = []
        for i, d in self.paths(kind="f", fill=WHITE):
            if d["rect"].y1 < 100:  # header background
                continue
            for sub in path_to_polylines(d["items"]):
                if len(sub) >= 3:
                    polys.append((i, sub))
        return polys

    def texts(self):
        out = []
        for b in self.page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for line in b["lines"]:
                for s in line["spans"]:
                    t = s["text"].strip()
                    if t:
                        out.append((t, tuple(s["bbox"]), s["size"]))
        return out

    def arcs(self, width=W_MEDIUM):
        """Circular arcs drawn as cubic Beziers; consecutive pieces of one circle are merged."""
        raw = []
        for i, d in self.paths(kind="s", width=width):
            for it in d["items"]:
                if it[0] != "c":
                    continue
                a = (it[1].x, it[1].y)
                c1 = (it[2].x, it[2].y)
                c2 = (it[3].x, it[3].y)
                b = (it[4].x, it[4].y)
                ta = (c1[0] - a[0], c1[1] - a[1])
                tb = (c2[0] - b[0], c2[1] - b[1])
                na = (-ta[1], ta[0])
                nb = (-tb[1], tb[0])
                det = na[0] * (-nb[1]) - na[1] * (-nb[0])
                if abs(det) < 1e-9:
                    continue
                rx, ry = b[0] - a[0], b[1] - a[1]
                s = (rx * (-nb[1]) - ry * (-nb[0])) / det
                c = (a[0] + s * na[0], a[1] + s * na[1])
                r = math.dist(c, a)
                cosang = ((a[0] - c[0]) * (b[0] - c[0]) + (a[1] - c[1]) * (b[1] - c[1])) / (r * r)
                ang = math.degrees(math.acos(max(-1.0, min(1.0, cosang))))
                raw.append(Arc(c, r, a, b, ang, i))
        merged: list[Arc] = []
        for arc in raw:
            for m in merged:
                if math.dist(m.center, arc.center) < 0.5 and abs(m.radius - arc.radius) < 0.5 and (
                    math.dist(m.end, arc.start) < 0.05 or math.dist(m.start, arc.end) < 0.05
                ):
                    if math.dist(m.end, arc.start) < 0.05:
                        m.end = arc.end
                    else:
                        m.start = arc.start
                    m.sweep_deg += arc.sweep_deg
                    break
            else:
                merged.append(Arc(arc.center, arc.radius, arc.start, arc.end, arc.sweep_deg, arc.path_index))
        return merged

    def north_arrow(self):
        """Unit vector (PDF space) pointing to north, from the thick needle of the north arrow."""
        n_label = next(t for t in self.texts() if t[0] == "N")
        lab = ((n_label[1][0] + n_label[1][2]) / 2, (n_label[1][1] + n_label[1][3]) / 2)
        for _, d in self.paths(kind="s", width=W_NORTH):
            for it in d["items"]:
                if it[0] == "l":
                    a, b = (it[1].x, it[1].y), (it[2].x, it[2].y)
                    tip, tail = (a, b) if math.dist(a, lab) < math.dist(b, lab) else (b, a)
                    v = (tip[0] - tail[0], tip[1] - tail[1])
                    length = math.hypot(*v)
                    return (v[0] / length, v[1] / length)
        raise RuntimeError("north arrow not found")


def load_plan(path: Path = PDF_PATH) -> Plan:
    if not path.exists():
        raise SystemExit(f"{path} not found. The floor plan PDF is local-only (gitignored); copy it to reference/.")
    doc = fitz.open(path)
    page = doc[0]
    plan = Plan(doc, page, page.get_drawings())
    calibrate(plan)
    return plan


def calibrate(plan: Plan):
    """Least-squares fit of pt-per-metre from the scale bar tick marks (0 / 1 / 2.5 / 5 m)."""
    labels = {}
    for t, bbox, _ in plan.texts():
        if t in {"0", "1", "2.5", "5"} and bbox[1] > 700:
            labels[float(t)] = (bbox[0] + bbox[2]) / 2
    ticks = []
    for _, d in plan.paths(kind="s", width=W_SCALE):
        for it in d["items"]:
            if it[0] == "l" and _close(it[1].x, it[2].x, 0.01) and it[1].y > 700:
                ticks.append(it[1].x)
    ticks = sorted(set(round(x, 2) for x in ticks))
    pairs = []
    for metres, label_x in labels.items():
        tick = min(ticks, key=lambda x: abs(x - label_x))
        pairs.append((metres, tick))
    pairs.sort()
    n = len(pairs)
    sx = sum(m for m, _ in pairs)
    sy = sum(x for _, x in pairs)
    sxx = sum(m * m for m, _ in pairs)
    sxy = sum(m * x for m, x in pairs)
    k = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    x0 = (sy - k * sx) / n
    residual = max(abs(x - (x0 + k * m)) for m, x in pairs)
    plan.pt_to_cm = 100.0 / k
    plan.scale_ticks = {"pairs": pairs, "pt_per_m": k, "max_residual_pt": residual}
    return plan
