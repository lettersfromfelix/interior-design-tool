import { Box3, MeshBasicMaterial, Vector3, type BufferAttribute, type Line, type LineDashedMaterial, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import type { Part } from "../../core/schema/common";
import { Layer } from "../layers";
import { buildParts, partGeometry } from "./parts";

const mat = new MeshBasicMaterial();
const bounds = (part: Part) => new Box3().setFromBufferAttribute(partGeometry(part).getAttribute("position") as BufferAttribute);
const meshes = (parts: Part[]) => {
  const root = buildParts(parts, () => mat);
  root.updateMatrixWorld(true);
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};
const worldCentre = (m: Mesh) => new Box3().setFromObject(m).getCenter(new Vector3());

describe("parametric parts", () => {
  it("repeats a part around the item's vertical axis, clockwise seen from above", () => {
    const bar: Part = {
      shape: "box",
      size: { x: 4, y: 80, z: 1 },
      position: { x: 100, y: 50, z: 0 },
      material: "m",
      repeatAround: { count: 4, step: 90 },
    };
    const centres = meshes([bar]).map(worldCentre);
    expect(centres).toHaveLength(4);
    // +x, then +z (clockwise on the plan, where z points down), then -x, then -z
    const expected = [
      [100, 0],
      [0, 100],
      [-100, 0],
      [0, -100],
    ];
    centres.forEach((c, i) => {
      expect(c.x).toBeCloseTo(expected[i][0], 5);
      expect(c.z).toBeCloseTo(expected[i][1], 5);
      expect(c.y).toBeCloseTo(50, 5);
    });
  });

  it("revolves a lathe profile over a partial arc from +x clockwise", () => {
    const rail: Part = {
      shape: "lathe",
      profile: [
        [98, 0],
        [102, 0],
        [102, 1],
        [98, 1],
        [98, 0],
      ],
      arc: 90,
      position: { x: 0, y: 0, z: 0 },
      material: "m",
    };
    const box = bounds(rail);
    expect(box.min.x).toBeGreaterThan(-0.01);
    expect(box.min.z).toBeGreaterThan(-0.01);
    expect(box.max.x).toBeCloseTo(102, 1);
    expect(box.max.z).toBeCloseTo(102, 1);
  });

  it("draws partial tori in the same direction as lathes", () => {
    const ring: Part = { shape: "torus", radius: 50, tube: 2, arc: 90, position: { x: 0, y: 0, z: 0 }, material: "m" };
    const box = bounds(ring);
    expect(box.min.z).toBeGreaterThan(-2.01);
    expect(box.max.z).toBeCloseTo(52, 1);
  });

  it("shows dashed parts in 3D only and as a dashed footprint outline in the plan", () => {
    const cabinet: Part = {
      shape: "box",
      size: { x: 200, y: 95, z: 35 },
      position: { x: 10, y: 192.5, z: -20 },
      rotation: { y: 90 },
      material: "m",
      plan: "dashed",
    };
    const shelf: Part = { shape: "box", size: { x: 50, y: 2, z: 20 }, position: { x: 0, y: 100, z: 0 }, material: "m" };
    const root = buildParts([cabinet, shelf], () => mat);
    root.updateMatrixWorld(true);
    const lines: Line[] = [];
    root.traverse((o) => {
      if ((o as Line).isLine) lines.push(o as Line);
    });
    const [solidCabinet, solidShelf] = meshes([cabinet, shelf]);
    expect(solidCabinet.layers.mask).toBe(1 << Layer.ONLY_3D);
    expect(solidShelf.layers.mask).toBe(1 << Layer.BOTH);

    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line.layers.mask).toBe(1 << Layer.ONLY_2D);
    expect((line.material as LineDashedMaterial).isLineDashedMaterial).toBe(true);
    const outline = new Box3().setFromObject(line);
    const solid = new Box3().setFromObject(solidCabinet);
    // rotated by 90°: 35 wide in x, 200 deep in z, drawn at the top (240)
    for (const axis of ["x", "z"] as const) {
      expect(outline.min[axis]).toBeCloseTo(solid.min[axis], 5);
      expect(outline.max[axis]).toBeCloseTo(solid.max[axis], 5);
    }
    expect(outline.max.x - outline.min.x).toBeCloseTo(35, 5);
    expect(outline.min.y).toBeCloseTo(240, 5);
    const distances = line.geometry.getAttribute("lineDistance");
    expect(distances.getX(distances.count - 1)).toBeCloseTo(2 * (200 + 35), 5);
  });

  it("shows hidden parts in 3D only, without an outline in the plan", () => {
    const handle: Part = { shape: "box", size: { x: 2.5, y: 24, z: 2 }, position: { x: 0, y: 160, z: 18 }, material: "m", plan: "hidden" };
    const root = buildParts([handle], () => mat);
    const lines: Line[] = [];
    root.traverse((o) => {
      if ((o as Line).isLine) lines.push(o as Line);
    });
    expect(meshes([handle])[0].layers.mask).toBe(1 << Layer.ONLY_3D);
    expect(lines).toHaveLength(0);
  });
});
