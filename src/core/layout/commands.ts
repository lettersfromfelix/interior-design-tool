/**
 * Layout commands: pure functions that return a new layout document (Immer), or the same object if nothing changed.
 * Every scene change goes through one of these, so undo/redo (Phase 3) only has to keep the documents.
 */
import { produce, type Draft } from "immer";
import type { Vec2 } from "../schema/common";
import type { LayoutFile, PlacedItem } from "../schema/layout";
import { descendants } from "./poses";

export const LAYOUT_SCHEMA_REF = "../schemas/layout.schema.json";

export function emptyLayout(name = "Default"): LayoutFile {
  return { $schema: LAYOUT_SCHEMA_REF, schemaVersion: 1, name, items: [] };
}

/** Round to 0.1 (cm or degrees), without "-0". */
export function round1(v: number): number {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r;
}

/** Degrees in [0, 360), rounded to 0.1°. */
export function normalizeRotation(deg: number): number {
  const r = round1(((deg % 360) + 360) % 360);
  return r >= 360 ? 0 : r;
}

/** "sofa-3-seater" -> "sofa-3-seater-1" (the smallest number that is not used yet). */
export function nextUid(doc: Pick<LayoutFile, "items">, itemId: string, taken: ReadonlySet<string> = new Set()): string {
  const base = itemId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_]+/, "") || "item";
  const used = new Set([...doc.items.map((p) => p.uid), ...taken]);
  for (let n = 1; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

const find = (doc: LayoutFile, uid: string) => doc.items.find((p) => p.uid === uid);

export function addItem(doc: LayoutFile, placed: PlacedItem): LayoutFile {
  return produce(doc, (d) => {
    d.items.push({
      ...placed,
      position: [round1(placed.position[0]), round1(placed.position[1])],
      rotation: normalizeRotation(placed.rotation),
    });
  });
}

/** Change one placed item in place. Unknown uids leave the document unchanged. */
export function updateItem(doc: LayoutFile, uid: string, recipe: (p: Draft<PlacedItem>) => void): LayoutFile {
  return produce(doc, (d) => {
    const p = d.items.find((x) => x.uid === uid);
    if (p) recipe(p);
  });
}

export function moveItem(doc: LayoutFile, uid: string, [x, z]: Vec2): LayoutFile {
  const [nx, nz] = [round1(x), round1(z)];
  return updateItem(doc, uid, (p) => {
    if (p.position[0] !== nx || p.position[1] !== nz) p.position = [nx, nz];
  });
}

/** Move by a plan offset (cm). For items standing on another item the offset is in the base item's frame. */
export function nudgeItem(doc: LayoutFile, uid: string, [dx, dz]: Vec2): LayoutFile {
  const p = find(doc, uid);
  return p ? moveItem(doc, uid, [p.position[0] + dx, p.position[1] + dz]) : doc;
}

export function setRotation(doc: LayoutFile, uid: string, deg: number): LayoutFile {
  const r = normalizeRotation(deg);
  return updateItem(doc, uid, (p) => {
    if (p.rotation !== r) p.rotation = r;
  });
}

/** Rotate by `delta` degrees (clockwise seen from above). */
export function rotateItem(doc: LayoutFile, uid: string, delta: number): LayoutFile {
  const p = find(doc, uid);
  return p ? setRotation(doc, uid, p.rotation + delta) : doc;
}

/** Remove an item and everything standing on it. */
export function removeItem(doc: LayoutFile, uid: string): LayoutFile {
  const gone = new Set([uid, ...descendants(doc, uid)]);
  if (!doc.items.some((p) => gone.has(p.uid))) return doc;
  return produce(doc, (d) => {
    d.items = d.items.filter((p) => !gone.has(p.uid));
  });
}

const copy = (p: PlacedItem): PlacedItem => JSON.parse(JSON.stringify(p)) as PlacedItem;

/**
 * Copy an item, and everything standing on it, as `newUid`, moved by `offset` (plan cm).
 * The copy is never locked, so it can be moved right away.
 */
export function duplicateItem(doc: LayoutFile, uid: string, newUid: string, offset: Vec2): LayoutFile {
  const src = find(doc, uid);
  if (!src) return doc;
  const kids = descendants(doc, uid);
  const uids = new Map([[uid, newUid]]);
  const taken = new Set([newUid]);
  for (const k of kids) {
    const u = nextUid(doc, find(doc, k)!.item, taken);
    taken.add(u);
    uids.set(k, u);
  }
  return produce(doc, (d) => {
    const top = copy(src);
    top.uid = newUid;
    top.position = [round1(src.position[0] + offset[0]), round1(src.position[1] + offset[1])];
    delete top.locked;
    d.items.push(top);
    for (const k of kids) {
      const c = copy(find(doc, k)!);
      c.uid = uids.get(k)!;
      if (c.parent) c.parent = { ...c.parent, uid: uids.get(c.parent.uid) ?? c.parent.uid };
      d.items.push(c);
    }
  });
}

/** Choose a preset (or "@original") for a material slot; `undefined` goes back to the catalogue default. */
export function setSlotMaterial(doc: LayoutFile, uid: string, slot: string, choice: string | undefined): LayoutFile {
  return updateItem(doc, uid, (p) => {
    if (choice === undefined) {
      if (p.materials && slot in p.materials) {
        delete p.materials[slot];
        if (Object.keys(p.materials).length === 0) delete p.materials;
      }
    } else if (p.materials?.[slot] !== choice) {
      p.materials = { ...p.materials, [slot]: choice };
    }
  });
}

/** Wall items: floor to the bottom edge (cm); `undefined` goes back to the catalogue default. */
export function setElevation(doc: LayoutFile, uid: string, elevation: number | undefined): LayoutFile {
  const e = elevation === undefined ? undefined : round1(Math.max(0, elevation));
  return updateItem(doc, uid, (p) => {
    if (p.elevation === e) return;
    if (e === undefined) delete p.elevation;
    else p.elevation = e;
  });
}

export function setFlag(doc: LayoutFile, uid: string, flag: "locked" | "hidden", on: boolean): LayoutFile {
  return updateItem(doc, uid, (p) => {
    if (!!p[flag] === on) return;
    if (on) p[flag] = true;
    else delete p[flag];
  });
}

export interface PlacementChange {
  /** Relative to the base item if `parent` is set. */
  position: Vec2;
  rotation: number;
  /** The surface the item stands on; undefined = on its own (floor, wall or ceiling). */
  parent?: { uid: string; surface: number };
}

/** Move and turn an item in one step, and put it on another item's surface or take it off. */
export function setPlacement(doc: LayoutFile, uid: string, change: PlacementChange): LayoutFile {
  const position: Vec2 = [round1(change.position[0]), round1(change.position[1])];
  const rotation = normalizeRotation(change.rotation);
  const parent = change.parent;
  return updateItem(doc, uid, (p) => {
    if (p.position[0] !== position[0] || p.position[1] !== position[1]) p.position = position;
    if (p.rotation !== rotation) p.rotation = rotation;
    if (!parent) {
      if (p.parent) delete p.parent;
    } else if (p.parent?.uid !== parent.uid || p.parent.surface !== parent.surface) {
      p.parent = { uid: parent.uid, surface: parent.surface };
    }
  });
}

/** The layout's display name (the file name stays). */
export function renameLayout(doc: LayoutFile, name: string): LayoutFile {
  const n = name.trim();
  return !n || n === doc.name ? doc : produce(doc, (d) => void (d.name = n));
}

/** Doors are shown open this far (degrees) unless the layout says otherwise. */
export const DOOR_OPEN = 90;

/** How far the door is open (0–90°); `undefined` goes back to the default (90°, as on the plan). */
export function setDoorOpening(doc: LayoutFile, doorId: string, degrees: number | undefined): LayoutFile {
  const v = degrees === undefined || degrees >= DOOR_OPEN ? undefined : Math.max(0, Math.round(degrees));
  if (doc.doors?.[doorId] === v) return doc;
  return produce(doc, (d) => {
    if (v === undefined) {
      if (!d.doors) return;
      delete d.doors[doorId];
      if (Object.keys(d.doors).length === 0) delete d.doors;
    } else {
      d.doors = { ...d.doors, [doorId]: v };
    }
  });
}

export type SurfaceTarget = { kind: "room-walls"; room: string } | { kind: "wall-face"; face: string } | { kind: "floor"; room: string };

/** Wall colour (per room or per wall side) or floor material; `undefined` goes back to the apartment's finish. */
export function setSurface(doc: LayoutFile, target: SurfaceTarget, preset: string | undefined): LayoutFile {
  const current =
    target.kind === "room-walls"
      ? doc.surfaces?.walls?.rooms?.[target.room]
      : target.kind === "wall-face"
        ? doc.surfaces?.walls?.faces?.[target.face]
        : doc.surfaces?.floors?.[target.room];
  if (current === preset) return doc;
  return produce(doc, (d) => {
    const s = (d.surfaces ??= {});
    if (target.kind === "floor") {
      const floors = (s.floors ??= {});
      if (preset === undefined) delete floors[target.room];
      else floors[target.room] = preset;
    } else {
      const walls = (s.walls ??= {});
      const map = target.kind === "room-walls" ? (walls.rooms ??= {}) : (walls.faces ??= {});
      const key = target.kind === "room-walls" ? target.room : target.face;
      if (preset === undefined) delete map[key];
      else map[key] = preset;
      if (walls.rooms && Object.keys(walls.rooms).length === 0) delete walls.rooms;
      if (walls.faces && Object.keys(walls.faces).length === 0) delete walls.faces;
      if (Object.keys(walls).length === 0) delete s.walls;
    }
    if (s.floors && Object.keys(s.floors).length === 0) delete s.floors;
    if (Object.keys(s).length === 0) delete d.surfaces;
  });
}
