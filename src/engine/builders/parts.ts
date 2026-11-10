/**
 * Builds Three.js objects from parametric parts (boxes, cylinders, …).
 * Shared by apartment fixtures and parametric catalogue items.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Line,
  LineDashedMaterial,
  Mesh,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Part } from "../../core/schema/common";
import { Layer, setLayer } from "../layers";
import { isSeeThrough } from "../materials/MaterialLibrary";
import { applyCmUVs } from "./uv";

const DEG = Math.PI / 180;

/** Plan outline of parts with `plan: "dashed"` (shared by all builds; dash lengths in cm). */
const DASHED_OUTLINE = new LineDashedMaterial({ color: "#4a4e55", dashSize: 8, gapSize: 5 });

/** Closed outline of a part's footprint (its bounding rectangle in part-local x/z) at the part's top. */
export function footprintOutline(geometry: BufferGeometry): BufferGeometry {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  const corners: [number, number][] = [
    [min.x, min.z],
    [max.x, min.z],
    [max.x, max.z],
    [min.x, max.z],
    [min.x, min.z],
  ];
  const points = corners.map(([x, z]) => new Vector3(x, max.y, z));
  let d = 0;
  const distances = points.map((p, i) => (d += i > 0 ? p.distanceTo(points[i - 1]) : 0));
  return new BufferGeometry().setFromPoints(points).setAttribute("lineDistance", new Float32BufferAttribute(distances, 1));
}

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
      // lies flat; a partial arc starts at local +x and runs clockwise seen from above (towards +z)
      g = new TorusGeometry(part.radius, part.tube, 16, 64, (part.arc ?? 360) * DEG).rotateX(Math.PI / 2);
      break;
    case "extrusion": {
      const shape = new Shape(part.points.map(([x, z]) => new Vector2(x, -z)));
      g = new ExtrudeGeometry(shape, { depth: part.height, bevelEnabled: false }).rotateX(-Math.PI / 2);
      break;
    }
    case "lathe": {
      // LatheGeometry places vertices at (r·sin φ, y, r·cos φ); φ ∈ [90° − arc, 90°] starts at +x and runs clockwise
      const arc = (part.arc ?? 360) * DEG;
      const segments = Math.max(8, Math.ceil((48 * arc) / (2 * Math.PI)));
      g = new LatheGeometry(
        part.profile.map(([r, y]) => new Vector2(r, y)),
        segments,
        Math.PI / 2 - arc,
        arc,
      );
      break;
    }
  }
  return applyCmUVs(g);
}

/** Item-local rotation of a part. y is clockwise seen from above (like item rotations). */
export const partEuler = (r: Part["rotation"]): Euler =>
  new Euler((r?.x ?? 0) * DEG, -(r?.y ?? 0) * DEG, (r?.z ?? 0) * DEG, "YXZ");

export type SlotMaterial = (slot: string) => Material;

/**
 * Build all parts, including `repeat`, `repeatAround` and `mirror` copies. Meshes carry `userData.part` (the part name).
 * Parts with `plan: "dashed"` render in 3D only and get a dashed footprint outline in the 2D plan instead; parts with
 * `plan: "hidden"` render in 3D only.
 */
export function buildParts(parts: readonly Part[], material: SlotMaterial): Group {
  const root = new Group();
  for (const part of parts) {
    const geometry = partGeometry(part);
    const outline = part.plan === "dashed" ? footprintOutline(geometry) : null;
    const mat = material(part.material);
    const count = part.repeat?.count ?? 1;
    const step = part.repeat?.step ?? { x: 0, y: 0, z: 0 };
    const around = part.repeatAround ?? { count: 1, step: 0 };
    const copies = new Group();
    for (let k = 0; k < around.count; k++) {
      // rotates the copy around the item's vertical axis (clockwise seen from above)
      const pivot = new Group();
      pivot.rotation.y = -k * around.step * DEG;
      for (let i = 0; i < count; i++) {
        const mesh = new Mesh(geometry, mat);
        mesh.position.set(part.position.x + step.x * i, part.position.y + step.y * i, part.position.z + step.z * i);
        mesh.rotation.copy(partEuler(part.rotation));
        mesh.castShadow = !isSeeThrough(mat);
        mesh.receiveShadow = true;
        mesh.userData.part = part.name;
        pivot.add(mesh);
        if (part.plan === "hidden") setLayer(mesh, Layer.ONLY_3D);
        if (outline) {
          setLayer(mesh, Layer.ONLY_3D);
          const line = new Line(outline, DASHED_OUTLINE);
          line.position.copy(mesh.position);
          line.rotation.copy(mesh.rotation);
          line.userData.part = part.name;
          pivot.add(setLayer(line, Layer.ONLY_2D));
        }
      }
      copies.add(pivot);
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
