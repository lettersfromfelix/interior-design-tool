import { describe, expect, it } from "vitest";
import { MaterialPreset } from "../../core/schema/materials";
import { fromMiddle, stripePx, watercolourPatches, type Pattern } from "./patterns";

/** A small seeded random generator, so each test run sees the same patches. */
const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const n = 1024;
const grey: [number, number, number] = [200, 200, 200];
// red clouds and blue accents on grey, easy to tell apart
const abstract: Pattern = { type: "watercolour", color2: "#AA0000", color3: "#0000AA", scale: 300, strength: 0.6, edges: 1 };

describe("watercolour pattern", () => {
  it("is the same every time for the same preset", () => {
    expect(watercolourPatches(abstract, grey, n, seeded(7))).toEqual(watercolourPatches(abstract, grey, n, seeded(7)));
  });

  it("with edges, gets busier away from the middle of the part; without, it is even", () => {
    // patches per unit of area: within 0.3 of the middle (9 % of the repeat) against beyond 0.75 (44 %)
    const outerToInner = (p: Pattern) => {
      let inner = 0;
      let outer = 0;
      for (let seed = 1; seed <= 30; seed++) {
        for (const q of watercolourPatches(p, grey, n, seeded(seed))) {
          const r = fromMiddle(q.x, q.y, n);
          if (r < 0.3) inner++;
          else if (r > 0.75) outer++;
        }
      }
      return outer / (1 - 0.75 ** 2) / (inner / 0.3 ** 2);
    };
    expect(outerToInner(abstract)).toBeGreaterThan(3);
    const even = outerToInner({ ...abstract, edges: 0 });
    expect(even).toBeGreaterThan(0.7);
    expect(even).toBeLessThan(1.4);
  });

  it("adds fewer and smaller clouds in color3, and none without it", () => {
    const patches = Array.from({ length: 10 }, (_, i) => watercolourPatches(abstract, grey, n, seeded(i + 1))).flat();
    const accents = patches.filter((q) => q.color[2] > q.color[0]);
    const main = patches.filter((q) => q.color[0] > q.color[2]);
    expect(accents.length).toBeGreaterThan(0);
    expect(accents.length).toBeLessThan(main.length / 1.5);
    const mean = (l: typeof patches) => l.reduce((s, q) => s + q.rx, 0) / l.length;
    expect(mean(accents)).toBeLessThan(mean(main));
    const plain = watercolourPatches({ ...abstract, color3: undefined }, grey, n, seeded(3));
    expect(plain.every((q) => q.color[0] > q.color[2])).toBe(true);
  });
});

describe("stripes pattern", () => {
  it("draws stripes stripeWidth wide, one per repeat, and never thinner than 1.5 px", () => {
    const stripe: Pattern = { type: "stripes", color2: "#333333", scale: 8, stripeWidth: 1 };
    expect(stripePx(stripe, 256)).toBe(32);
    expect(stripePx({ ...stripe, stripeWidth: undefined }, 256)).toBe(32);
    expect(stripePx({ ...stripe, stripeWidth: 0.01 }, 256)).toBe(1.5);
    expect(stripePx({ ...stripe, stripeWidth: 20 }, 256)).toBe(256);
  });
});

describe("material presets with the new patterns", () => {
  it("accept watercolour and stripes with their options, and reject options out of range", () => {
    const preset = (pattern: Record<string, unknown>) => MaterialPreset.safeParse({ id: "rug.test", name: "Test", color: "#DDD3C5", pattern });
    expect(preset({ type: "watercolour", color2: "#75665A", color3: "#5D6870", scale: 300, strength: 0.6, edges: 0.8 }).success).toBe(true);
    expect(preset({ type: "stripes", color2: "#4F4F4F", scale: 7, stripeWidth: 0.8 }).success).toBe(true);
    expect(preset({ type: "watercolour", color2: "#75665A", scale: 300, edges: 2 }).success).toBe(false);
    expect(preset({ type: "stripes", color2: "#4F4F4F", scale: 7, stripeWidth: 0 }).success).toBe(false);
  });
});
