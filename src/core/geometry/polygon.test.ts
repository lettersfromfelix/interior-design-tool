import { describe, expect, it } from "vitest";
import { area, centroid, isSimplePolygon, labelPoint, pointInPolygon, rotatePlan, signedArea } from "./polygon";

describe("polygon helpers", () => {
  const square = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ] as [number, number][];

  it("computes area and centroid", () => {
    expect(area(square)).toBe(10_000);
    expect(signedArea(square)).toBeGreaterThan(0); // clockwise on screen (z down)
    expect(centroid(square)).toEqual([50, 50]);
  });

  it("tests points", () => {
    expect(pointInPolygon([50, 50], square)).toBe(true);
    expect(pointInPolygon([150, 50], square)).toBe(false);
  });

  it("rotates clockwise on the plan (z down)", () => {
    const [x, z] = rotatePlan([0, 1], 90); // front (+z) rotated 90° clockwise -> faces -x
    expect(x).toBeCloseTo(-1);
    expect(z).toBeCloseTo(0);
  });

  it("detects self-intersections", () => {
    expect(isSimplePolygon(square)).toBe(true);
    expect(
      isSimplePolygon([
        [0, 0],
        [100, 100],
        [100, 0],
        [0, 100],
      ]),
    ).toBe(false);
  });

  it("puts labels inside L-shaped rooms", () => {
    const l: [number, number][] = [
      [0, 0],
      [400, 0],
      [400, 100],
      [100, 100],
      [100, 400],
      [0, 400],
    ];
    const [cx, cz] = centroid(l);
    expect(pointInPolygon([cx, cz], l)).toBe(false); // the centroid is outside
    expect(pointInPolygon(labelPoint(l), l)).toBe(true);
  });
});
