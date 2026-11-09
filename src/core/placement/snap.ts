/** Snapping for furniture placement: rotation steps, grid, flush against walls (and into corners), wall mounting. */
import type { Vec2 } from "../schema/common";
import type { WallFace } from "./apartment";
import { frontDirection, rectCorners, rotationFacing, toWorld } from "./shapes";

/** An item snaps to a wall when its back is this close (cm)… */
export const WALL_SNAP_DISTANCE = 25;
/** …and it is turned less than this (degrees) from facing straight away from the wall. */
export const WALL_SNAP_ANGLE = 25;
/** A side of a wall-snapped item this close (cm) to a crossing wall slides into the corner. */
export const CORNER_SNAP_DISTANCE = 10;
/** How far (cm) an item may stick into a wall and still snap out of it. */
const SNAP_INSIDE = 15;

export interface Size {
  width: number;
  depth: number;
}

/** Signed difference a − b in degrees, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** Round to the nearest multiple of `step` (degrees or cm); step 0 = unchanged. */
export const snapTo = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

export interface FaceSnap {
  face: WallFace;
  /** Position of the item's centre along the face, cm from `face.a`. */
  along: number;
  /** World position and rotation of the item. */
  position: Vec2;
  rotation: number;
  /** It also touches a crossing wall. */
  corner?: boolean;
}

/** World position of an item of `depth` standing with its back flush against `face`, `along` cm from its start. */
export function onFace(face: WallFace, along: number, depth: number): Vec2 {
  return [face.a[0] + face.u[0] * along + (face.n[0] * depth) / 2, face.a[1] + face.u[1] * along + (face.n[1] * depth) / 2];
}

const faceSnap = (face: WallFace, along: number, size: Size): FaceSnap => ({
  face,
  along,
  position: onFace(face, along, size.depth),
  rotation: rotationFacing(face.n),
});

/**
 * Wall snap: if the item's back is within 25 cm of a wall face (or slightly inside the wall) and the item is turned
 * less than 25° from facing away from it, it turns to the wall and stands flush against it.
 */
export function snapToWall(position: Vec2, rotation: number, size: Size, faces: readonly WallFace[]): FaceSnap | undefined {
  const f = frontDirection(rotation);
  const back: Vec2 = [position[0] - (f[0] * size.depth) / 2, position[1] - (f[1] * size.depth) / 2];
  let best: { snap: FaceSnap; score: number } | undefined;
  for (const face of faces) {
    const turn = angleDiff(rotation, rotationFacing(face.n));
    if (Math.abs(turn) > WALL_SNAP_ANGLE) continue;
    const gap = dot(sub(back, face.a), face.n);
    if (gap > WALL_SNAP_DISTANCE || gap < -SNAP_INSIDE) continue;
    const along = dot(sub(position, face.a), face.u);
    // it has to stand in front of the face, not beyond its ends
    if (along < -size.width / 2 + 5 || along > face.length + size.width / 2 - 5) continue;
    const score = Math.abs(gap) + Math.abs(turn) * 0.5;
    if (!best || score < best.score) best = { snap: faceSnap(face, along, size), score };
  }
  return best?.snap;
}

/** Grid along the wall: the item's centre at a multiple of `step` from the face's start. */
export function gridAlongWall(snap: FaceSnap, size: Size, step: number): FaceSnap {
  return step > 0 ? { ...faceSnap(snap.face, snapTo(snap.along, step), size), corner: snap.corner } : snap;
}

/**
 * Slide a wall-snapped item along its wall until its side touches a crossing wall, if that side is within 10 cm of
 * it (or slightly inside it).
 */
export function snapIntoCorner(snap: FaceSnap, size: Size, faces: readonly WallFace[]): FaceSnap {
  const pose = { x: snap.position[0], z: snap.position[1], rotation: snap.rotation };
  const corners = rectCorners(size.width, size.depth).map((p) => toWorld(p, pose));
  let shift: number | undefined;
  for (const other of faces) {
    if (other.wall === snap.face.wall) continue;
    const un = dot(snap.face.u, other.n); // how sliding along the wall moves the item towards the other face
    if (Math.abs(un) < 0.5) continue; // roughly parallel walls make no corner
    if (dot(sub(snap.position, other.a), other.n) <= 0) continue; // the item is behind that face
    const dist = Math.min(...corners.map((c) => dot(sub(c, other.a), other.n)));
    if (dist > CORNER_SNAP_DISTANCE || dist < -SNAP_INSIDE) continue;
    const alongs = corners.map((c) => dot(sub(c, other.a), other.u));
    if (Math.max(...alongs) < 0 || Math.min(...alongs) > other.length) continue; // not in front of that face
    const s = -dist / un;
    if (shift === undefined || Math.abs(s) < Math.abs(shift)) shift = s;
  }
  return shift === undefined ? snap : { ...faceSnap(snap.face, snap.along + shift, size), corner: true };
}

/**
 * Wall items: hang on the nearest wall face (not on glass) on whose room side `point` is, kept within the face.
 * Returns undefined only if there is no suitable wall at all.
 */
export function mountOnWall(point: Vec2, size: Size, faces: readonly WallFace[]): FaceSnap | undefined {
  let best: { snap: FaceSnap; dist: number } | undefined;
  for (const face of faces) {
    if (face.kind === "glazing") continue;
    const rel = sub(point, face.a);
    const off = dot(rel, face.n);
    if (off < -face.thickness / 2) continue; // beyond the wall's centre line: the other face is meant
    const half = size.width / 2;
    const along = face.length >= size.width ? Math.min(face.length - half, Math.max(half, dot(rel, face.u))) : face.length / 2;
    const foot: Vec2 = [face.a[0] + face.u[0] * along, face.a[1] + face.u[1] * along];
    const dist = Math.hypot(point[0] - foot[0], point[1] - foot[1]);
    if (!best || dist < best.dist) best = { snap: faceSnap(face, along, size), dist };
  }
  return best?.snap;
}

/** Keep a wall item's centre on its face after grid snapping. */
export function clampOnFace(snap: FaceSnap, size: Size): FaceSnap {
  const half = size.width / 2;
  if (snap.face.length < size.width) return faceSnap(snap.face, snap.face.length / 2, size);
  const along = Math.min(snap.face.length - half, Math.max(half, snap.along));
  return along === snap.along ? snap : faceSnap(snap.face, along, size);
}
