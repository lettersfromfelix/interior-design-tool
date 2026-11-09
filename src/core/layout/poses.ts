/** Where placed items are in the world: plan position, elevation and rotation, including stacked children. */
import type { Vec2 } from "../schema/common";
import type { CatalogueItem } from "../schema/catalogue";
import type { LayoutFile, PlacedItem } from "../schema/layout";

export interface WorldPose {
  /** Plan position of the item's origin (bottom centre), cm. */
  x: number;
  z: number;
  /** Height of the item's bottom above the floor, cm. */
  y: number;
  /** Degrees, clockwise seen from above. */
  rotation: number;
}

export type ItemLookup = (id: string) => CatalogueItem | undefined;

/** Rotate a plan vector clockwise (seen from above) by `deg`, matching the engine's `rotation.y = −deg`. */
export function rotatePlan([x, z]: readonly [number, number], deg: number): Vec2 {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [x * c - z * s, x * s + z * c];
}

/** Elevation of an item that does not stand on another item. */
export function baseElevation(item: CatalogueItem | undefined, p: Pick<PlacedItem, "elevation">, ceilingHeight: number): number {
  const placement = item?.placement;
  switch (placement?.type) {
    case "wall":
      return p.elevation ?? placement.defaultElevation;
    case "ceiling":
      return Math.max(0, ceilingHeight - item!.dimensions.height);
    case "onTop":
      return p.elevation ?? 0; // without a base item it stands on the floor
    default:
      return 0;
  }
}

export type ParentProblem = "missing-parent" | "cycle" | "missing-surface";

/** Why an item's `parent` can't be used (it is then placed on its own), or undefined if it is fine. */
export function parentProblem(
  p: PlacedItem,
  byUid: ReadonlyMap<string, PlacedItem>,
  item: ItemLookup,
): ParentProblem | undefined {
  if (!p.parent) return undefined;
  const parent = byUid.get(p.parent.uid);
  if (!parent) return "missing-parent";
  // walk up the chain: coming back to an item we've already seen means the chain never reaches the floor
  const seen = new Set([p.uid]);
  for (let cur: PlacedItem | undefined = parent; cur; cur = cur.parent ? byUid.get(cur.parent.uid) : undefined) {
    if (seen.has(cur.uid)) return "cycle";
    seen.add(cur.uid);
  }
  const surfaces = item(parent.item)?.surfaces ?? [];
  return p.parent.surface < surfaces.length ? undefined : "missing-surface";
}

/** Override of an item's own position/rotation (relative to its parent if it has one), e.g. while dragging. */
export type PoseOverride = Partial<Pick<PlacedItem, "position" | "rotation" | "elevation">>;

/**
 * World pose of every placed item. Children of a surface are placed relative to their parent item:
 * their position is in the parent's local frame and they stand on the surface's height.
 * Items whose parent can't be used are placed on their own.
 */
export function resolvePoses(
  doc: Pick<LayoutFile, "items">,
  item: ItemLookup,
  ceilingHeight: number,
  overrides?: ReadonlyMap<string, PoseOverride>,
): Map<string, WorldPose> {
  const byUid = new Map(doc.items.map((p) => [p.uid, p]));
  const out = new Map<string, WorldPose>();
  const resolve = (p: PlacedItem): WorldPose => {
    const done = out.get(p.uid);
    if (done) return done;
    const o = overrides?.get(p.uid);
    const position = o?.position ?? p.position;
    const rotation = o?.rotation ?? p.rotation;
    let pose: WorldPose;
    if (p.parent && !parentProblem(p, byUid, item)) {
      const parent = byUid.get(p.parent.uid)!;
      const base = resolve(parent);
      const surface = item(parent.item)!.surfaces![p.parent.surface];
      const [dx, dz] = rotatePlan(position, base.rotation);
      pose = { x: base.x + dx, z: base.z + dz, y: base.y + surface.height, rotation: base.rotation + rotation };
    } else {
      pose = { x: position[0], z: position[1], y: baseElevation(item(p.item), { elevation: o?.elevation ?? p.elevation }, ceilingHeight), rotation };
    }
    out.set(p.uid, pose);
    return pose;
  };
  for (const p of doc.items) resolve(p);
  return out;
}

/** Uids of all items standing (directly or indirectly) on `uid`. */
export function descendants(doc: Pick<LayoutFile, "items">, uid: string): string[] {
  const out: string[] = [];
  const queue = [uid];
  const seen = new Set([uid]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of doc.items) {
      if (p.parent?.uid === cur && !seen.has(p.uid)) {
        seen.add(p.uid);
        out.push(p.uid);
        queue.push(p.uid);
      }
    }
  }
  return out;
}
