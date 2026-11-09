import { Box3, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { partsBounds } from "../../core/catalogue/bounds";
import type { Part } from "../../core/schema/common";
import { buildParts } from "./parts";

const at = (x = 0, y = 0, z = 0) => ({ x, y, z });

/** The pure bounds must match the real Three.js geometry (up to tessellation: the meshes lie inside the ideal shapes). */
describe("partsBounds matches the rendered parts", () => {
  const cases: Record<string, Part[]> = {
    "rotated rounded box": [{ shape: "box", size: { x: 80, y: 30, z: 40 }, cornerRadius: 6, position: at(5, 15, -3), rotation: { x: 12, y: 33, z: -8 }, material: "m" }],
    "tilted cone": [{ shape: "cylinder", radius: 12, radiusTop: 3, height: 50, position: at(0, 25, 0), rotation: { x: 20, y: 70 }, material: "m" }],
    "scaled tilted sphere": [{ shape: "sphere", radius: 10, scale: { x: 1.5, y: 0.6, z: 1 }, position: at(0, 10, 0), rotation: { z: 30, y: 15 }, material: "m" }],
    "partial torus": [{ shape: "torus", radius: 40, tube: 3, arc: 140, position: at(0, 50, 0), rotation: { y: 25 }, material: "m" }],
    "upright torus arc (CATALOGUE.md recipe)": [{ shape: "torus", radius: 50, tube: 1, arc: 90, position: at(0, 60, 0), rotation: { x: 45, y: -90, z: -90 }, material: "m" }],
    "partial lathe": [{ shape: "lathe", profile: [[30, 0], [35, 0], [35, 4], [30, 4]], arc: 200, position: at(), rotation: { y: 136 }, material: "m" }],
    "full lathe shade": [{ shape: "lathe", profile: [[3, 0], [20, 18], [22, 25]], position: at(0, 120, 0), material: "m" }],
    extrusion: [{ shape: "extrusion", points: [[-20, -10], [25, -10], [10, 15]], height: 3, position: at(0, 40, 0), rotation: { y: -30 }, material: "m" }],
    "legs with mirrors and repeats": [
      { shape: "cylinder", radius: 1.5, height: 40, position: at(50, 20, 25), rotation: { z: -6, x: 6 }, mirror: ["x", "z"], material: "m" },
      { shape: "box", size: { x: 3, y: 2, z: 50 }, position: at(-40, 41, 0), repeat: { count: 9, step: at(10, 0, 0) }, material: "m" },
      { shape: "box", size: { x: 4, y: 89, z: 1 }, position: at(100, 55, 0), rotation: { y: 10 }, repeatAround: { count: 12, step: 15 }, material: "m" },
    ],
  };

  for (const [name, parts] of Object.entries(cases)) {
    it(name, () => {
      const root = buildParts(parts, () => new MeshBasicMaterial());
      root.updateMatrixWorld(true);
      const real = new Box3().setFromObject(root, true);
      const pure = partsBounds(parts)!;
      for (const axis of ["x", "y", "z"] as const) {
        // never noticeably smaller than the mesh (sampled arcs may miss up to R·(1 − cos 1°)), at most a few mm larger
        expect(pure.min[axis]).toBeLessThanOrEqual(real.min[axis] + 0.02);
        expect(pure.max[axis]).toBeGreaterThanOrEqual(real.max[axis] - 0.02);
        expect(real.min[axis] - pure.min[axis]).toBeLessThan(0.5);
        expect(pure.max[axis] - real.max[axis]).toBeLessThan(0.5);
      }
    });
  }
});
