/**
 * Doors and windows, built in the host wall's local frame:
 * x along the wall centre line (0 = wall start), y up, z across the wall (+z = the wall's right side).
 */
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Material,
} from "three";
import { DOOR_LEAF_THICKNESS, doorGeometry, swingOutline } from "../../core/apartment/doors";
import type { ApartmentFile, Opening, Wall } from "../../core/schema/apartment";
import { Layer, setLayer } from "../layers";
import { isSeeThrough, type MaterialLibrary } from "../materials/MaterialLibrary";
import { applyCmUVs } from "./uv";

export type Side = "left" | "right";

const DEG = Math.PI / 180;

/** A door leaf's hinge: turning it opens or closes the leaf. */
export interface DoorLeafPivot {
  door: string;
  pivot: Group;
  /** +1: the leaf closes towards the wall's end; −1: towards its start. */
  dir: 1 | -1;
  /** +1: it swings to the wall's right side; −1: to its left side. */
  sgn: 1 | -1;
}

/** Show the leaf open `deg` degrees (0 = closed, 90 = open as on the plan). */
export function setLeafOpening(leaf: DoorLeafPivot, deg: number): void {
  leaf.pivot.rotation.y = leaf.dir * leaf.sgn * (90 - deg) * DEG;
}

/** Materials for the 2D plan symbols (shared by all openings of one build). */
export function createPlanStyle() {
  const style = {
    swing: new LineBasicMaterial({ color: "#7a7f88" }),
    frameLine: new LineBasicMaterial({ color: "#4a4e55" }),
    glassLine: new LineBasicMaterial({ color: "#2f86c9" }),
    windowFill: new MeshBasicMaterial({ color: "#fbfbf9" }),
    dispose() {
      style.swing.dispose();
      style.frameLine.dispose();
      style.glassLine.dispose();
      style.windowFill.dispose();
    },
  };
  return style;
}
export type PlanStyle = ReturnType<typeof createPlanStyle>;

export interface OpeningContext {
  wall: Wall;
  wallHeight: number;
  /** Start of the opening along the wall (cm). */
  a: number;
  /** Side of the wall that faces outdoors (railings go there). */
  outside: Side;
  defaults: ApartmentFile["defaults"];
  mats: MaterialLibrary;
  style: PlanStyle;
  /** Collects the door leaves' hinges. */
  leaves: DoorLeafPivot[];
}

/** Axis-aligned box from min/max coordinates (wall-local cm). */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: Material | Material[]): Mesh {
  const g = new BoxGeometry(Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0), Math.max(0.01, z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  applyCmUVs(g);
  const mesh = new Mesh(g, material);
  mesh.castShadow = !isSeeThrough(material);
  mesh.receiveShadow = true;
  return mesh;
}

function lineGeometry(points: number[]): BufferGeometry {
  return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3));
}

/** Door leaf in its own frame: x = thickness [0, t], y = height [0, h], z = width [0, w] (hinge at z = 0). */
function buildLeaf(w: number, h: number, t: number, glazed: boolean, mat: Material, glass: Material): Group {
  const g = new Group();
  if (!glazed) {
    g.add(box(0, t, 0, h, 0, w, mat));
    return g;
  }
  const stile = Math.min(12, w / 4);
  const top = Math.min(12, h / 6);
  const bottom = Math.min(20, h / 5);
  g.add(
    box(0, t, 0, h, 0, stile, mat),
    box(0, t, 0, h, w - stile, w, mat),
    box(0, t, 0, bottom, stile, w - stile, mat),
    box(0, t, h - top, h, stile, w - stile, mat),
    box(t / 2 - 0.5, t / 2 + 0.5, bottom, h - top, stile, w - stile, glass),
  );
  return g;
}

export function buildDoor(o: Opening, c: OpeningContext): Group {
  const d = o.door!;
  const geo = doorGeometry(o)!;
  const g = new Group();
  const t = c.wall.thickness;
  const { a, b, jamb, sgn } = geo;
  const s = o.sill;
  const top = s + o.height;
  const frame = c.mats.get(c.defaults.doorFrameMaterial);
  const fz = t / 2 + 0.5;

  g.add(box(a, a + jamb, s, top, -fz, fz, frame), box(b - jamb, b, s, top, -fz, fz, frame));
  if (top + 5 <= c.wallHeight + 0.01) g.add(setLayer(box(a, b, top, top + 5, -fz, fz, frame), Layer.ONLY_3D));

  const leafMat = c.mats.get(d.style === "glazed" && c.wall.kind === "glazing" ? c.defaults.sashMaterial : c.defaults.doorLeafMaterial);
  const glass = c.mats.get(c.defaults.glassMaterial);
  const thickness = DOOR_LEAF_THICKNESS;
  for (const h of geo.leaves) {
    // the leaf turns about its hinge on the face it swings to; built open at 90°, as on the plan
    const pivot = new Group();
    pivot.position.set(h.x, s + 1, (sgn * t) / 2);
    const leaf = buildLeaf(geo.leafWidth, top - s - 1, thickness, d.style === "glazed", leafMat, glass);
    leaf.position.x = h.dir > 0 ? 0 : -thickness;
    leaf.scale.z = sgn;
    pivot.add(leaf);
    g.add(pivot);
    c.leaves.push({ door: o.id, pivot, dir: h.dir, sgn });

    const arc = swingOutline(h, geo, t, 24).slice(1); // without the hinge point
    g.add(setLayer(new Line(lineGeometry(arc.flatMap(([x, z]) => [x, 2, z])), c.style.swing), Layer.ONLY_2D));
  }
  return g;
}

export function buildWindow(o: Opening, c: OpeningContext): Group {
  const w = o.window!;
  const g = new Group();
  const t = c.wall.thickness;
  const a = c.a;
  const b = a + o.width;
  const s = o.sill;
  const top = s + o.height;
  const frameMat = c.mats.get(c.defaults.windowFrameMaterial);
  const sashMat = c.mats.get(c.defaults.sashMaterial);
  const glass = c.mats.get(c.defaults.glassMaterial);

  // 3D: outer frame, sashes and glass (hidden in the plan, where the opening shows as a window symbol)
  const fw = Math.min(6, o.width / 6);
  const fz = Math.min(t, 10) / 2;
  const frame = new Group();
  frame.add(
    box(a, a + fw, s, top, -fz, fz, frameMat),
    box(b - fw, b, s, top, -fz, fz, frameMat),
    box(a + fw, b - fw, top - fw, top, -fz, fz, frameMat),
    box(a + fw, b - fw, s, s + fw, -fz, fz, frameMat),
  );
  const x0 = a + fw;
  const y0 = s + fw;
  const y1 = top - fw;
  const n = w.operation === "fixed" ? 1 : w.sashes;
  const sw = (b - fw - x0) / n;
  const sf = Math.min(6, sw / 5);
  for (let i = 0; i < n; i++) {
    const l = x0 + i * sw;
    const r = l + sw;
    if (w.operation === "fixed") {
      frame.add(box(l, r, y0, y1, -0.5, 0.5, glass));
      continue;
    }
    frame.add(
      box(l, l + sf, y0, y1, -3, 3, sashMat),
      box(r - sf, r, y0, y1, -3, 3, sashMat),
      box(l + sf, r - sf, y0, y0 + sf, -3, 3, sashMat),
      box(l + sf, r - sf, y1 - sf, y1, -3, 3, sashMat),
      box(l + sf, r - sf, y0 + sf, y1 - sf, -0.5, 0.5, glass),
    );
  }
  g.add(setLayer(frame, Layer.ONLY_3D));

  // 2D: classic plan symbol (frame lines on both faces, glass line in the middle)
  const symbol = new Group();
  const fill = box(a, b, 0, 1, -t / 2, t / 2, c.style.windowFill);
  fill.castShadow = false;
  symbol.add(fill);
  symbol.add(new LineSegments(lineGeometry([a, 2, -t / 2, b, 2, -t / 2, a, 2, t / 2, b, 2, t / 2]), c.style.frameLine));
  const glassPts: number[] = [a, 2, 0, b, 2, 0];
  for (let i = 1; i < n; i++) glassPts.push(x0 + i * sw, 2, -fz, x0 + i * sw, 2, fz);
  symbol.add(new LineSegments(lineGeometry(glassPts), c.style.glassLine));
  g.add(setLayer(symbol, Layer.ONLY_2D));

  if (w.railing) g.add(buildRailing(a, b, w.railing, t, c));
  return g;
}

type Railing = NonNullable<NonNullable<Opening["window"]>["railing"]>;

/** Top edge of a railing's bottom rail above the floor (the balcony railings in data/apartment.json use the same). */
const BOTTOM_RAIL = 10;

/** Juliet railing on the outside face of the wall: vertical flat bars between a top and a bottom rail. */
function buildRailing(a: number, b: number, r: Railing, t: number, c: OpeningContext): Group {
  const mat = c.mats.get(c.defaults.railingMaterial);
  const so = c.outside === "right" ? 1 : -1;
  const inner = so * (t / 2 + 2);
  const outer = so * (t / 2 + 2 + r.barWidth);
  const z0 = Math.min(inner, outer);
  const z1 = Math.max(inner, outer);
  const th = r.barThickness;
  const g = new Group();
  g.add(box(a, b, r.height - th, r.height, z0, z1, mat), box(a, b, BOTTOM_RAIL - th, BOTTOM_RAIL, z0, z1, mat));
  const count = Math.max(1, Math.round((b - a) / r.barSpacing));
  const step = (b - a) / count;
  for (let i = 0; i < count; i++) {
    const x = a + (i + 0.5) * step;
    g.add(box(x - th / 2, x + th / 2, BOTTOM_RAIL, r.height - th, z0, z1, mat));
  }
  return g;
}
