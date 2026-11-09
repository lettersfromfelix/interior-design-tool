/** Builds the fixed apartment (data/apartment.json) as a Three.js scene graph. No ids are hard-coded here. */
import { Box3, Group, Mesh, Shape, ShapeGeometry, Vector2, Vector3, type Material, type Object3D } from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { area, direction, labelPoint, length } from "../../core/geometry/polygon";
import type { ApartmentFile, Opening, Room, Wall } from "../../core/schema/apartment";
import type { Vec2 } from "../../core/schema/common";
import type { LayoutSurfaces } from "../../core/schema/layout";
import { Layer, setLayer } from "../layers";
import type { MaterialLibrary } from "../materials/MaterialLibrary";
import { box, buildDoor, buildWindow, createPlanStyle, type DoorLeafPivot, type OpeningContext, type PlanStyle, type Side } from "./openings";
import { buildParts } from "./parts";

const DEG = Math.PI / 180;

export type ElementKind = "room" | "wall" | "opening" | "fixture";

export interface ApartmentBuild {
  root: Group;
  /** Top-level object of every element, by id (rooms, walls, openings, fixtures). */
  elements: Map<string, Object3D>;
  labels: CSS2DObject[];
  /** Ceiling meshes: they cast shadows only in daylight (otherwise the default light would leave the rooms dark). */
  ceilings: Mesh[];
  /** Door leaves' hinges, by door id. */
  doors: Map<string, DoorLeafPivot[]>;
  bounds: Box3;
  dispose(): void;
}

/** Floor polygon at y = 0 facing up. UVs are plan cm (x, -z). */
function floorGeometry(outline: readonly Vec2[]): ShapeGeometry {
  return new ShapeGeometry(new Shape(outline.map(([x, z]) => new Vector2(x, -z)))).rotateX(-Math.PI / 2);
}

/** Ceiling polygon at y = height facing down (invisible from above, so the 3D view can look in). */
function ceilingGeometry(outline: readonly Vec2[], height: number): ShapeGeometry {
  return new ShapeGeometry(new Shape(outline.map(([x, z]) => new Vector2(x, z)))).rotateX(Math.PI / 2).translate(0, height, 0);
}

function roomLabel(room: Room): CSS2DObject {
  const el = document.createElement("div");
  el.className = room.kind === "balcony" ? "room-label room-label--outdoor" : "room-label";
  const name = document.createElement("strong");
  name.textContent = room.name;
  const size = document.createElement("span");
  size.textContent = `${(area(room.outline) / 10_000).toFixed(1)} m²`;
  el.append(name, size);
  const label = new CSS2DObject(el);
  const [x, z] = labelPoint(room.outline);
  label.position.set(x, 3, z);
  return label;
}

/**
 * @param surfaces the working layout's wall colours and floors; they win over the finishes in apartment.json.
 */
export function buildApartment(ap: ApartmentFile, mats: MaterialLibrary, surfaces?: LayoutSurfaces): ApartmentBuild {
  const root = new Group();
  root.name = "apartment";
  const elements = new Map<string, Object3D>();
  const tag = <T extends Object3D>(obj: T, id: string, kind: ElementKind): T => {
    obj.userData.elementId = id;
    obj.userData.elementKind = kind;
    obj.name = id;
    elements.set(id, obj);
    return obj;
  };
  const style = createPlanStyle();
  const rooms = new Map(ap.rooms.map((r) => [r.id, r]));
  const H = ap.ceilingHeight;
  const ceilings: Mesh[] = [];
  const leaves: DoorLeafPivot[] = [];

  // rooms: floor + ceiling
  for (const r of ap.rooms) {
    const g = new Group();
    const floor = new Mesh(floorGeometry(r.outline), mats.get(surfaces?.floors?.[r.id] ?? r.floorMaterial ?? ap.defaults.floorMaterial));
    floor.receiveShadow = true;
    g.add(floor);
    if (r.kind === "indoor" && r.hasCeiling !== false) {
      const ceiling = new Mesh(ceilingGeometry(r.outline, H), mats.get(ap.defaults.ceilingMaterial));
      ceiling.receiveShadow = true;
      ceilings.push(ceiling);
      g.add(setLayer(ceiling, Layer.ONLY_3D));
    }
    root.add(tag(g, r.id, "room"));
  }

  // walls with their openings
  const openingsByWall = new Map<string, Opening[]>();
  for (const o of ap.openings) openingsByWall.set(o.wall, [...(openingsByWall.get(o.wall) ?? []), o]);
  for (const w of ap.walls) {
    const g = buildWall(w, openingsByWall.get(w.id) ?? [], { ap, rooms, mats, style, tag, surfaces, leaves });
    root.add(tag(g, w.id, "wall"));
  }

  // fixtures (kitchen, built-ins, sanitary, column, railings, …)
  for (const f of ap.fixtures) {
    const g = buildParts(f.parts, (slot) => mats.get(f.materials[slot]));
    g.position.set(f.position[0], f.elevation ?? 0, f.position[1]);
    g.rotation.y = -f.rotation * DEG;
    root.add(tag(g, f.id, "fixture"));
  }

  const labels = ap.rooms.map(roomLabel);
  root.add(...labels);

  root.updateMatrixWorld(true);
  const bounds = new Box3();
  for (const r of ap.rooms) for (const [x, z] of r.outline) bounds.expandByPoint(new Vector3(x, 0, z));
  for (const w of ap.walls) {
    bounds.expandByPoint(new Vector3(w.start[0], H, w.start[1]));
    bounds.expandByPoint(new Vector3(w.end[0], H, w.end[1]));
  }

  const doors = new Map<string, DoorLeafPivot[]>();
  for (const l of leaves) doors.set(l.door, [...(doors.get(l.door) ?? []), l]);

  return {
    root,
    elements,
    labels,
    ceilings,
    doors,
    bounds,
    dispose() {
      root.traverse((o) => {
        if ((o as Mesh).geometry) (o as Mesh).geometry.dispose();
      });
      // CSS2D labels remove their DOM element only when they are removed themselves (not with an ancestor)
      for (const l of labels) l.removeFromParent();
      root.removeFromParent();
      style.dispose();
    },
  };
}

interface WallContext {
  ap: ApartmentFile;
  rooms: Map<string, Room>;
  mats: MaterialLibrary;
  style: PlanStyle;
  tag: <T extends Object3D>(obj: T, id: string, kind: ElementKind) => T;
  surfaces?: LayoutSurfaces;
  leaves: DoorLeafPivot[];
}

function buildWall(w: Wall, openings: readonly Opening[], c: WallContext): Group {
  const L = length(w.start, w.end);
  const [dx, dz] = direction(w.start, w.end);
  const t = w.thickness;
  const h = w.height ?? c.ap.ceilingHeight;
  const g = new Group();
  g.position.set(w.start[0], 0, w.start[1]);
  g.rotation.y = -Math.atan2(dz, dx);

  const indoor = (id?: string) => !!id && c.rooms.get(id)?.kind === "indoor";
  // the layout's colour for this side, else its colour for the room, else the room's finish in apartment.json
  const paint = (side: Side, id?: string): Material =>
    c.mats.get(
      c.surfaces?.walls?.faces?.[`${w.id}:${side}`] ??
        (id && c.surfaces?.walls?.rooms?.[id]) ??
        ((id && c.rooms.get(id)?.wallMaterial) || c.ap.defaults.wallMaterial),
    );
  const glazing = w.kind === "glazing" ? c.mats.get(c.ap.defaults.windowFrameMaterial) : undefined;
  const left = glazing ?? paint("left", w.sides?.left);
  const right = glazing ?? paint("right", w.sides?.right);
  // BoxGeometry face order: +x, -x, +y (top), -y, +z (right side), -z (left side)
  const faces = (top: Material): Material[] => [left, left, top, left, right, left];
  const piece = (x0: number, x1: number, y0: number, y1: number, top: Material) => box(x0, x1, y0, y1, -t / 2, t / 2, faces(top));

  let outside: Side = "left";
  if (indoor(w.sides?.left) && !indoor(w.sides?.right)) outside = "right";

  const placed = openings
    .map((o) => ({ o, a: Math.max(0, o.centerFromStart - o.width / 2), b: Math.min(L, o.centerFromStart + o.width / 2) }))
    .sort((p, q) => p.a - q.a);
  let cursor = 0;
  for (const { o, a, b } of placed) {
    if (a > cursor + 0.01) g.add(piece(cursor, a, 0, h, c.mats.poche));
    // the wall below an opening (sill) is not cut by the plan's section plane: 3D only, so the 2D symbol stays visible
    if (o.sill > 0.01) g.add(setLayer(piece(a, b, 0, o.sill, right), Layer.ONLY_3D));
    const top = o.sill + o.height;
    if (top < h - 0.01) g.add(setLayer(piece(a, b, top, h, c.mats.poche), Layer.ONLY_3D));
    const ctx: OpeningContext = { wall: w, wallHeight: h, a, outside, defaults: c.ap.defaults, mats: c.mats, style: c.style, leaves: c.leaves };
    g.add(c.tag(o.kind === "door" ? buildDoor(o, ctx) : buildWindow(o, ctx), o.id, "opening"));
    cursor = Math.max(cursor, b);
  }
  if (cursor < L - 0.01) g.add(piece(cursor, L, 0, h, c.mats.poche));
  return g;
}
