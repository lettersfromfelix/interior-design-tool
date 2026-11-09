/**
 * Builds Three.js objects from parametric parts (boxes, cylinders, …).
 * Shared by apartment fixtures and parametric catalogue items.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Part } from "../../core/schema/common";
import { isSeeThrough } from "../materials/MaterialLibrary";
import { applyCmUVs } from "./uv";

const DEG = Math.PI / 180;

/** Geometry of one part in part-local coordinates (cm). */
export function partGeometry(part: Part): BufferGeometry {
  let g: BufferGeometry;
  switch (part.shape) {
    case "box": {
      const { x, y, z } = part.size;
      const r = Math.min(part.cornerRadius ?? 0, Math.min(x, y, z) / 2 - 0.01);
      g = r > 0.05 ? new RoundedBoxGeometry(x, y, z, 3, r) : new BoxGeometry(x, y, z);
      break;
    }
    case "cylinder":
      g = new CylinderGeometry(part.radiusTop ?? part.radius, part.radius, part.height, 32);
      break;
    case "sphere":
      g = new SphereGeometry(part.radius, 32, 16);
      if (part.scale) g.scale(part.scale.x, part.scale.y, part.scale.z);
      break;
    case "torus":
      // lies flat (ring around the vertical axis)
      g = new TorusGeometry(part.radius, part.tube, 16, 64, (part.arc ?? 360) * DEG).rotateX(-Math.PI / 2);
      break;
    case "extrusion": {
      const shape = new Shape(part.points.map(([x, z]) => new Vector2(x, -z)));
      g = new ExtrudeGeometry(shape, { depth: part.height, bevelEnabled: false }).rotateX(-Math.PI / 2);
      break;
    }
    case "lathe":
      g = new LatheGeometry(
        part.profile.map(([r, y]) => new Vector2(r, y)),
        48,
      );
      break;
  }
  return applyCmUVs(g);
}

/** Item-local rotation of a part. y is clockwise seen from above (like item rotations). */
export const partEuler = (r: Part["rotation"]): Euler =>
  new Euler((r?.x ?? 0) * DEG, -(r?.y ?? 0) * DEG, (r?.z ?? 0) * DEG, "YXZ");

export type SlotMaterial = (slot: string) => Material;

/** Build all parts, including `repeat` and `mirror` copies. Meshes carry `userData.part` (the part name). */
export function buildParts(parts: readonly Part[], material: SlotMaterial): Group {
  const root = new Group();
  for (const part of parts) {
    const geometry = partGeometry(part);
    const mat = material(part.material);
    const count = part.repeat?.count ?? 1;
    const copies = new Group();
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh(geometry, mat);
      const step = part.repeat?.step ?? { x: 0, y: 0, z: 0 };
      mesh.position.set(part.position.x + step.x * i, part.position.y + step.y * i, part.position.z + step.z * i);
      mesh.rotation.copy(partEuler(part.rotation));
      mesh.castShadow = !isSeeThrough(mat);
      mesh.receiveShadow = true;
      mesh.userData.part = part.name;
      copies.add(mesh);
    }
    root.add(copies);
    const mirrors = part.mirror ?? [];
    const variants: [number, number][] = [];
    if (mirrors.includes("x")) variants.push([-1, 1]);
    if (mirrors.includes("z")) variants.push([1, -1]);
    if (mirrors.includes("x") && mirrors.includes("z")) variants.push([-1, -1]);
    for (const [sx, sz] of variants) {
      const m = copies.clone();
      m.scale.set(sx, 1, sz);
      root.add(m);
    }
  }
  return root;
}
