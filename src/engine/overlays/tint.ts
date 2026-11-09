/**
 * Conflict tints: a translucent copy of every mesh of an item, added as a child of that mesh so it follows the item
 * through previews (dragging, rotating) without being rebuilt.
 */
import { Mesh, MeshBasicMaterial, type Object3D } from "three";

export type TintLevel = "hard" | "soft";

const make = (color: string, opacity: number) =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

/** Red for overlaps, amber for warnings. Shared by all tints; never disposed (two materials for the app's lifetime). */
export const TINTS: Record<TintLevel, MeshBasicMaterial> = { hard: make("#e53935", 0.5), soft: make("#f2a516", 0.42) };

/** Tint all meshes under `root` (or remove the tint with `undefined`). */
export function applyTint(root: Object3D, level: TintLevel | undefined): void {
  const current = root.userData.tint as TintLevel | undefined;
  if (current === level) return;
  const old: Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.isTint) old.push(o);
  });
  for (const o of old) o.removeFromParent();
  root.userData.tint = level;
  if (!level) return;
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh && !o.userData.isTint) meshes.push(o as Mesh);
  });
  for (const m of meshes) {
    const copy = new Mesh(m.geometry, TINTS[level]);
    copy.userData.isTint = true;
    copy.raycast = () => {}; // never picked
    copy.renderOrder = 6;
    copy.layers.mask = m.layers.mask;
    m.add(copy);
  }
}

/** Forget a tint (the item's meshes changed, e.g. a model finished loading), so the next applyTint redoes it. */
export function resetTint(root: Object3D): void {
  if (root.userData.tint === undefined) return;
  const level = root.userData.tint as TintLevel;
  root.userData.tint = undefined;
  applyTint(root, level);
}
