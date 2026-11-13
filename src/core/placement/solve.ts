/**
 * Where an item goes when it is dragged or placed: one solver for 2D and 3D. It applies the placement rules
 * (floor, wall, onTop, ceiling), the snapping aids and, in block mode, stops the item at obstacles and lets it slide
 * along them.
 */
import { addItem, setPlacement, type PlacementChange } from "../layout/commands";
import { resolvePoses, type ItemLookup, type WorldPose } from "../layout/poses";
import { hangsBelow, type CatalogueItem } from "../schema/catalogue";
import type { Vec2 } from "../schema/common";
import type { LayoutFile } from "../schema/layout";
import type { Aids } from "./aids";
import type { ApartmentIndex } from "./apartment";
import { layoutConflicts, newHardConflicts, type Conflict } from "./collisions";
import { clampOnFace, gridAlongWall, mountOnWall, snapIntoCorner, snapTo, snapToWall } from "./snap";
import { pickSurface, placeOnSurface, worldSurfaces } from "./stacking";

export interface PlacementContext {
  doc: LayoutFile;
  lookup: ItemLookup;
  ap: ApartmentIndex;
  aids: Aids;
  /** World poses of the items in `doc`. */
  poses: ReadonlyMap<string, WorldPose>;
}

/** What the pointer asks for. */
export interface Target {
  /** World position of the item's origin (bottom centre). */
  point: Vec2;
  /** World rotation (degrees). */
  rotation: number;
  /** 3D: the placed item and the height the pointer is on (onTop items prefer its surfaces). */
  hint?: { uid: string; y: number };
}

export type SnapKind = "wall" | "corner" | "surface" | "grid";

export interface Solution {
  placement: PlacementChange;
  snap?: SnapKind;
  /** Wall face the item stands flush against or hangs on. */
  face?: string;
}

/**
 * Apply the placement rules and snapping aids. `exclude`: the moving item and everything standing on it (they can't
 * be stood on).
 */
export function solvePlacement(item: CatalogueItem, target: Target, ctx: PlacementContext, exclude: ReadonlySet<string>): Solution {
  const size = item.dimensions;
  const { aids, ap } = ctx;
  const grid = aids.grid ? aids.gridSize : 0;
  const type = item.placement.type;

  if (type === "onTop") {
    const surfaces = worldSurfaces(ctx.doc, ctx.lookup, ctx.poses, exclude);
    const s = pickSurface(target.point, surfaces, size.height, target.hint);
    if (s) {
      const placement = placeOnSurface(target.point, target.rotation, size, s, hangsBelow(item) > 0);
      return { placement: { ...placement, parent: { uid: s.uid, surface: s.index } }, snap: "surface" };
    }
  }
  if (type === "wall") {
    let snap = mountOnWall(target.point, size, ap.faces);
    if (snap) {
      if (grid) snap = clampOnFace(gridAlongWall(snap, size, grid), size);
      return { placement: { position: snap.position, rotation: snap.rotation }, snap: "wall", face: snap.face.id };
    }
  } else if (aids.wallSnap && type !== "ceiling") {
    let snap = snapToWall(target.point, target.rotation, size, ap.faces);
    if (snap) {
      if (grid) snap = gridAlongWall(snap, size, grid);
      snap = snapIntoCorner(snap, size, ap.faces);
      return { placement: { position: snap.position, rotation: snap.rotation }, snap: snap.corner ? "corner" : "wall", face: snap.face.id };
    }
  }
  if (grid) return { placement: { position: [snapTo(target.point[0], grid), snapTo(target.point[1], grid)], rotation: target.rotation }, snap: "grid" };
  return { placement: { position: target.point, rotation: target.rotation } };
}

export interface Attempt {
  target: Target;
  solution: Solution;
  /** The layout with the item at the solved place. */
  doc: LayoutFile;
  poses: Map<string, WorldPose>;
  /** Conflicts of the moving items (only computed when collisions are on). */
  conflicts: Map<string, Conflict[]>;
  /** Block mode: the item could not go to the target (it stopped, or slid along an obstacle). */
  blocked: boolean;
}

export interface Mover {
  item: CatalogueItem;
  uid: string;
  /** The moving item and everything standing on it. */
  moving: ReadonlySet<string>;
  /** A new item (placing from the catalogue) is added to the layout; an existing one is moved. */
  isNew: boolean;
  /** Conflicts the moving items had when the gesture started: they don't block (so you can move out of them). */
  before: ReadonlyMap<string, readonly Conflict[]>;
}

function tryTarget(m: Mover, target: Target, ctx: PlacementContext): Attempt {
  return evaluate(m, solvePlacement(m.item, target, ctx, m.moving), target, ctx);
}

/** Put the item at `solution` and check what the moving items run into (as far as the aids ask for it). */
function evaluate(m: Mover, solution: Solution, target: Target, ctx: PlacementContext): Attempt {
  const doc = m.isNew
    ? addItem(ctx.doc, { uid: m.uid, item: m.item.id, ...solution.placement })
    : setPlacement(ctx.doc, m.uid, solution.placement);
  const poses = resolvePoses(doc, ctx.lookup, ctx.ap.ceilingHeight);
  const collisions = ctx.aids.collisions !== "off";
  let conflicts = new Map<string, Conflict[]>();
  if (collisions || ctx.aids.clearance) {
    conflicts = layoutConflicts(doc, ctx.lookup, ctx.ap, poses, { only: m.moving, clearance: ctx.aids.clearance });
    if (!collisions) {
      for (const [uid, list] of conflicts) {
        const kept = list.filter((c) => c.kind === "clearance");
        if (kept.length) conflicts.set(uid, kept);
        else conflicts.delete(uid);
      }
    }
  }
  return { target, solution, doc, poses, conflicts, blocked: false };
}

const isBlocked = (a: Attempt, m: Mover) => [...m.moving].some((uid) => newHardConflicts(a.conflicts.get(uid), m.before.get(uid)).length > 0);

/** Block mode refuses this attempt: a moving item runs into something it didn't overlap at the start. */
export const refused = (a: Attempt, m: Mover, ctx: Pick<PlacementContext, "aids">): boolean => ctx.aids.collisions === "block" && isBlocked(a, m);

/**
 * The item where it stands now (no snapping). Gestures start from it, so a first step that is blocked keeps the
 * item in place instead of falling back to the blocked target.
 */
export function currentAttempt(m: Mover, ctx: PlacementContext): Attempt | undefined {
  const p = ctx.doc.items.find((x) => x.uid === m.uid);
  const pose = ctx.poses.get(m.uid);
  if (m.isNew || !p || !pose) return undefined;
  const placement: PlacementChange = { position: p.position, rotation: p.rotation, ...(p.parent ? { parent: p.parent } : {}) };
  return evaluate(m, { placement }, { point: [pose.x, pose.z], rotation: pose.rotation }, ctx);
}

/**
 * Solve a pointer target. In block mode a target that runs into something new is replaced by the nearest free one
 * that keeps one axis of `last` (sliding along the obstacle), or by `last` itself; `blocked` is then true. Without
 * `last` (a new item) the blocked attempt is returned, marked `blocked`, and must not be committed.
 */
export function moveTo(m: Mover, target: Target, ctx: PlacementContext, last?: Attempt): Attempt {
  const first = tryTarget(m, target, ctx);
  if (ctx.aids.collisions !== "block" || !isBlocked(first, m)) return first;
  if (last) {
    const slides: Target[] = [
      { ...target, point: [target.point[0], last.target.point[1]] },
      { ...target, point: [last.target.point[0], target.point[1]] },
    ];
    for (const t of slides) {
      const a = tryTarget(m, t, ctx);
      if (!isBlocked(a, m)) return { ...a, blocked: true };
    }
    return { ...last, blocked: true };
  }
  return { ...first, blocked: true };
}

/**
 * Put the item exactly at `placement` (no snapping), e.g. while it is rotated. In block mode a placement that runs
 * into something new is refused: `last` is kept and `blocked` is true.
 */
export function placeExactly(m: Mover, placement: PlacementChange, world: Target, ctx: PlacementContext, last?: Attempt): Attempt {
  const a = evaluate(m, { placement }, world, ctx);
  if (ctx.aids.collisions !== "block" || !isBlocked(a, m)) return a;
  return { ...(last ?? a), blocked: true };
}
