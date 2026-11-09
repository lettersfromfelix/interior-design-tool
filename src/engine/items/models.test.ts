import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import type { CatalogueItem } from "../../core/schema/catalogue";
import { floatGeometry, prepareModel } from "./models";

const item = (geometry: Partial<Extract<CatalogueItem["geometry"], { type: "model" }>>, dims = { width: 40, depth: 50, height: 90 }): CatalogueItem => ({
  schemaVersion: 1,
  id: "chair",
  name: "Chair",
  category: "seating",
  dimensions: dims,
  placement: { type: "floor" },
  geometry: { type: "model", src: "model.glb", ...geometry },
  materialSlots: { seat: { default: "@original" } },
});

/** A model in metres with its origin away from the bottom centre, like many downloads. */
function scene(size: [number, number, number]): Group {
  const g = new Group();
  const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial({ name: "Seat" }));
  mesh.position.set(3, 1, -2);
  g.add(mesh);
  return g;
}

function bounds(model: ReturnType<typeof prepareModel>["model"]) {
  const g = model.meshes[0].geometry;
  g.computeBoundingBox();
  return { min: g.boundingBox!.min, size: g.boundingBox!.getSize(new Vector3()) };
}

describe("prepareModel", () => {
  it("scales and moves a model in metres to the declared size, standing on the floor, centred", () => {
    const { model, issues } = prepareModel(scene([0.4, 0.9, 0.5]), item({ materialMap: { Seat: "seat" } }), "catalogue/chair/item.json");
    const b = bounds(model);
    expect(b.size.x).toBeCloseTo(40);
    expect(b.size.y).toBeCloseTo(90);
    expect(b.size.z).toBeCloseTo(50);
    expect(b.min.x).toBeCloseTo(-20);
    expect(b.min.y).toBeCloseTo(0);
    expect(b.min.z).toBeCloseTo(-25);
    expect(issues).toEqual([]);
  });

  it("applies geometry.rotation before fitting (a Z-up model)", () => {
    const { model, issues } = prepareModel(scene([0.4, 0.5, 0.9]), item({ rotation: { x: -90 } }), "f");
    const b = bounds(model);
    expect([b.size.x, b.size.y, b.size.z].map((v) => Math.round(v))).toEqual([40, 90, 50]);
    expect(issues).toEqual([]);
  });

  it("warns when stretching distorts the model, and keeps proportions with fit: uniform", () => {
    const dims = { width: 80, depth: 50, height: 90 };
    const stretched = prepareModel(scene([0.4, 0.9, 0.5]), item({}, dims), "f");
    expect(stretched.issues.map((i) => i.severity)).toEqual(["warning"]);
    expect(stretched.issues[0].message).toMatch(/stretched unevenly/);

    const uniform = prepareModel(scene([0.4, 0.9, 0.5]), item({ fit: "uniform" }, dims), "f");
    const b = bounds(uniform.model);
    expect([b.size.x, b.size.y, b.size.z].map((v) => Math.round(v))).toEqual([40, 90, 50]);
    expect(b.min.x).toBeCloseTo(-20);
    expect(uniform.issues).toEqual([]);
  });

  it("warns about materialMap names that are not in the model and lists the real ones", () => {
    const { issues } = prepareModel(scene([0.4, 0.9, 0.5]), item({ materialMap: { Seat: "seat", Fabric: "seat" } }), "f");
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("geometry.materialMap.Fabric");
    expect(issues[0].hint).toContain('"Seat"');
  });
});

/** A 2 × 2 × 2 box (−1 … 1) whose vertex data is stored like in compressed / quantized glTF files. */
function storedBox(kind: "int16-normalized" | "uint16" | "interleaved"): Mesh {
  const box = new BoxGeometry(2, 2, 2);
  const pos = box.getAttribute("position") as BufferAttribute;
  const nor = box.getAttribute("normal") as BufferAttribute;
  const g = new BufferGeometry();
  g.setIndex(box.index);
  for (const grp of box.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  const mesh = new Mesh(g, new MeshStandardMaterial({ name: "Seat" }));
  if (kind === "int16-normalized") {
    g.setAttribute("position", new BufferAttribute(Int16Array.from(pos.array, (v) => Math.round(v * 32767)), 3, true));
    g.setAttribute("normal", new BufferAttribute(Int8Array.from(nor.array, (v) => Math.round(v * 127)), 3, true));
    mesh.scale.set(0.2, 0.45, 0.25); // the node transform undoes the quantization: 0.4 × 0.9 × 0.5 m
  } else if (kind === "uint16") {
    g.setAttribute("position", new BufferAttribute(Uint16Array.from(pos.array, (v) => (v + 1) * 1000), 3));
    g.setAttribute("normal", nor);
    mesh.scale.set(0.4 / 2000, 0.9 / 2000, 0.5 / 2000);
    mesh.position.set(-0.2, -0.45, -0.25);
  } else {
    const data = new Float32Array(pos.count * 6);
    for (let i = 0; i < pos.count; i++) data.set([pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i)], i * 6);
    const buffer = new InterleavedBuffer(data, 6);
    g.setAttribute("position", new InterleavedBufferAttribute(buffer, 3, 0));
    g.setAttribute("normal", new InterleavedBufferAttribute(buffer, 3, 3));
    mesh.scale.set(0.2, 0.45, 0.25);
  }
  return mesh;
}

describe("prepareModel with quantized or interleaved vertex data", () => {
  for (const kind of ["int16-normalized", "uint16", "interleaved"] as const) {
    it(`fits a model with ${kind} positions without corrupting it`, () => {
      const root = new Group().add(storedBox(kind));
      const { model, issues } = prepareModel(root, item({}), "f");
      const g = model.meshes[0].geometry;
      expect(g.getAttribute("position").array).toBeInstanceOf(Float32Array);
      const b = bounds(model);
      expect(b.size.x).toBeCloseTo(40, 1);
      expect(b.size.y).toBeCloseTo(90, 1);
      expect(b.size.z).toBeCloseTo(50, 1);
      expect(b.min.y).toBeCloseTo(0, 1);
      expect(b.min.x).toBeCloseTo(-20, 1);
      const n = g.getAttribute("normal");
      for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 2);
      expect(issues).toEqual([]);
    });
  }

  it("floatGeometry keeps the index and the material groups", () => {
    const src = storedBox("interleaved").geometry;
    const out = floatGeometry(src);
    expect(out.index?.count).toBe(src.index?.count);
    expect(out.groups).toEqual(src.groups);
    expect(out.getAttribute("normal").getZ(0)).toBeCloseTo(src.getAttribute("normal").getZ(0));
  });
});
