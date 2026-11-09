import { describe, expect, it } from "vitest";
import type { Part } from "../schema/common";
import { partsBounds } from "./bounds";

const at = (x = 0, y = 0, z = 0) => ({ x, y, z });
const close = (a: { x: number; y: number; z: number }, b: [number, number, number], digits = 3) => {
  expect(a.x).toBeCloseTo(b[0], digits);
  expect(a.y).toBeCloseTo(b[1], digits);
  expect(a.z).toBeCloseTo(b[2], digits);
};

describe("partsBounds", () => {
  it("is undefined for no parts", () => {
    expect(partsBounds([])).toBeUndefined();
  });

  it("rotates boxes clockwise seen from above", () => {
    const b = partsBounds([{ shape: "box", size: { x: 100, y: 10, z: 20 }, position: at(0, 5, 0), rotation: { y: 90 }, material: "m" }])!;
    close(b.min, [-10, 0, -50]);
    close(b.max, [10, 10, 50]);
  });

  it("keeps rounded corners exact when rotated", () => {
    // 45°: a sharp 20×20 box reaches 14.14; with 5 cm rounding the corners stay 5 cm inside: 5·√2 + 5
    const b = partsBounds([
      { shape: "box", size: { x: 20, y: 20, z: 20 }, cornerRadius: 5, position: at(), rotation: { y: 45 }, material: "m" },
    ])!;
    expect(b.max.x).toBeCloseTo(5 * Math.SQRT2 + 5, 6);
    expect(b.max.y).toBeCloseTo(10, 6);
  });

  it("treats cylinder ends as discs, also when tilted", () => {
    const upright = partsBounds([{ shape: "cylinder", radius: 10, radiusTop: 4, height: 30, position: at(0, 15, 0), material: "m" }])!;
    close(upright.min, [-10, 0, -10]);
    close(upright.max, [10, 30, 10]);
    // lying along x (tilted 90° around z): length 30 along x, radius 10 in y and z
    const lying = partsBounds([{ shape: "cylinder", radius: 10, height: 30, position: at(), rotation: { z: 90 }, material: "m" }])!;
    close(lying.min, [-15, -10, -10]);
    close(lying.max, [15, 10, 10]);
  });

  it("handles scaled spheres (ellipsoids)", () => {
    const b = partsBounds([{ shape: "sphere", radius: 10, scale: { x: 2, y: 1, z: 0.5 }, position: at(0, 10, 0), material: "m" }])!;
    close(b.min, [-20, 0, -5]);
    close(b.max, [20, 20, 5]);
  });

  it("follows partial arcs of tori and lathes clockwise from +x", () => {
    const torus = partsBounds([{ shape: "torus", radius: 50, tube: 2, arc: 90, position: at(), material: "m" }])!;
    close(torus.min, [0, -2, 0], 1);
    close(torus.max, [52, 2, 52], 1);
    const lathe = partsBounds([
      { shape: "lathe", profile: [[40, 0], [40, 10]], arc: 90, position: at(), rotation: { y: 90 }, material: "m" },
    ])!;
    // a quarter from +z (after rotating 90° clockwise) to −x
    close(lathe.min, [-40, 0, 0], 1);
    close(lathe.max, [0, 10, 40], 1);
  });

  it("stands arcs upright with the rotations documented in CATALOGUE.md", () => {
    // a quarter ring of radius 50 with a 0.5 cm tube; angles are seen from the front, counter-clockwise from +x
    const arc = (rotation: Part["rotation"]) =>
      partsBounds([{ shape: "torus", radius: 50, tube: 0.5, arc: 90, position: at(), rotation, material: "m" }])!;
    const c45 = 50 * Math.SQRT1_2;
    const t45 = 0.5 * Math.SQRT1_2;
    // { x: -90 }: from +x up to +y
    close(arc({ x: -90 }).min, [0, 0, -0.5], 1);
    close(arc({ x: -90 }).max, [50.5, 50.5, 0.5], 1);
    // { x: -90, y: 180 }: from −x up to +y
    close(arc({ x: -90, y: 180 }).min, [-50.5, 0, -0.5], 1);
    close(arc({ x: -90, y: 180 }).max, [0, 50.5, 0.5], 1);
    // start angle s in 0…180: { x: s − 90, y: 90, z: 90 }; s = 45 runs from 45° over the top to 135°
    close(arc({ x: -45, y: 90, z: 90 }).min, [-(c45 + t45), c45 - t45, -0.5], 1);
    close(arc({ x: -45, y: 90, z: 90 }).max, [c45 + t45, 50.5, 0.5], 1);
    // start angle s in 180…360: { x: 270 − s, y: -90, z: -90 }; s = 225 runs from 225° under the bottom to 315°
    close(arc({ x: 45, y: -90, z: -90 }).min, [-(c45 + t45), -50.5, -0.5], 1);
    close(arc({ x: 45, y: -90, z: -90 }).max, [c45 + t45, -(c45 - t45), 0.5], 1);
    // y is applied last: { x: -90, y: 90 } turns the first arc into the side plane, from +z up to +y
    close(arc({ x: -90, y: 90 }).min, [-0.5, 0, 0], 1);
    close(arc({ x: -90, y: 90 }).max, [0.5, 50.5, 50.5], 1);
  });

  it("includes repeat, repeatAround and mirror copies", () => {
    const legs: Part = { shape: "box", size: { x: 4, y: 40, z: 4 }, position: at(40, 20, 20), material: "m", mirror: ["x", "z"] };
    const b = partsBounds([legs])!;
    close(b.min, [-42, 0, -22]);
    close(b.max, [42, 40, 22]);
    const slats: Part = { shape: "box", size: { x: 2, y: 2, z: 2 }, position: at(0, 1, 0), material: "m", repeat: { count: 5, step: at(10, 0, 0) } };
    expect(partsBounds([slats])!.max.x).toBeCloseTo(41, 6);
    const bars: Part = { shape: "box", size: { x: 2, y: 2, z: 2 }, position: at(30, 1, 0), material: "m", repeatAround: { count: 2, step: 90 } };
    close(partsBounds([bars])!.max, [31, 2, 31]);
  });

  it("extrudes footprints upwards", () => {
    const b = partsBounds([{ shape: "extrusion", points: [[0, 0], [30, 0], [0, -20]], height: 5, position: at(10, 2, 0), material: "m" }])!;
    close(b.min, [10, 2, -20]);
    close(b.max, [40, 7, 0]);
  });
});
