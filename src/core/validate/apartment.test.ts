import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateApartment } from "./apartment";
import { validateMaterials } from "./materials";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("data/apartment.json", () => {
  const mats = validateMaterials(read("data/materials.json"));
  const res = validateApartment(read("data/apartment.json"), mats.byId);

  it("has valid materials", () => {
    expect(mats.issues).toEqual([]);
  });

  it("passes schema and semantic validation without errors", () => {
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(res.apartment).toBeDefined();
  });

  it("reproduces every printed room area within ±1.5 %", () => {
    expect(res.areaChecks.length).toBe(5);
    for (const c of res.areaChecks) expect(Math.abs(c.deviation), c.name).toBeLessThanOrEqual(0.015);
  });

  it("models the expected elements", () => {
    const ap = res.apartment!;
    expect(ap.ceilingHeight).toBe(255);
    expect(ap.rooms.filter((r) => r.kind === "balcony")).toHaveLength(2);
    expect(ap.openings.filter((o) => o.kind === "door")).toHaveLength(10);
    expect(ap.openings.filter((o) => o.door?.isEntrance)).toHaveLength(1);
    const ids = ap.fixtures.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["kitchen", "built-in-wardrobe", "column"]));
    expect(ap.checks?.length).toBeGreaterThanOrEqual(30);
  });

  it("keeps the door styles you confirmed", () => {
    const style = (id: string) => res.apartment!.openings.find((o) => o.id === id)?.door?.style;
    expect(style("d-entree-living")).toBe("glazed");
    expect(style("d-entree-zimmer-15-9")).toBe("solid");
    expect(style("d-living-zimmer-15-9")).toBe("solid");
  });

  it("has kitchen wall cabinets level with the tall units", () => {
    const parts = res.apartment!.fixtures.find((f) => f.id === "kitchen")!.parts;
    const box = (name: string) => {
      const p = parts.find((x) => x.name === name);
      if (p?.shape !== "box") throw new Error(`kitchen part "${name}" missing`);
      return p;
    };
    const top = (name: string) => box(name).position.y + box(name).size.y / 2;
    expect(top("wall cabinets")).toBeCloseTo(top("tall unit 42"), 5);
    // above the whole base run: the same extent along the kitchen as all base cabinets together
    const extent = (name: string) => {
      const xs = parts.flatMap((p) => (p.name === name && p.shape === "box" ? [p.position.x - p.size.x / 2, p.position.x + p.size.x / 2] : []));
      return [Math.min(...xs), Math.max(...xs)];
    };
    const [wallMin, wallMax] = extent("wall cabinets");
    const [baseMin, baseMax] = extent("base cabinets");
    expect(wallMin).toBeCloseTo(baseMin, 5);
    expect(wallMax).toBeCloseTo(baseMax, 5);
    // overhead: dashed in the plan, so the worktop, sink and hob below stay visible
    expect(box("wall cabinets").plan).toBe("dashed");
  });

  it("runs the balcony railings along the open edge only, leaving the balcony doors clear", () => {
    const ap = res.apartment!;
    const walls = new Map(ap.walls.map((w) => [w.id, w]));
    const railings = ap.fixtures.filter((f) => f.kind === "railing");
    expect(railings).toHaveLength(2);
    for (const f of railings) {
      const rail = f.parts.find((p) => p.name === "top rail");
      if (rail?.shape !== "lathe") throw new Error(`${f.id}: top rail missing`);
      const start = rail.rotation?.y ?? 0;
      const sweep = rail.arc ?? 360;
      expect(sweep, f.id).toBeLessThan(300);
      const covered = (deg: number) => (((deg - start) % 360) + 360) % 360 <= sweep;
      const balcony = f.id.replace(/-railing$/, "");
      const doors = ap.openings.filter((o) => o.id.endsWith(balcony));
      expect(doors, f.id).toHaveLength(2);
      for (const o of doors) {
        const w = walls.get(o.wall)!;
        const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
        const t = o.centerFromStart / len;
        const x = w.start[0] + (w.end[0] - w.start[0]) * t - f.position[0];
        const z = w.start[1] + (w.end[1] - w.start[1]) * t - f.position[1];
        expect(covered((Math.atan2(z, x) * 180) / Math.PI), `${o.id} is behind the railing`).toBe(false);
      }
    }
  });

  it("only references existing checklist items in provenance notes", () => {
    const ids = new Set((res.apartment!.checks ?? []).map((c) => c.id));
    const notes: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          if (k === "note" && typeof x === "string") notes.push(x);
          else walk(x);
        }
      }
    };
    walk(res.apartment);
    const refs = notes.flatMap((n) => n.match(/\bM\d{2}\b/g) ?? []);
    expect(refs.length).toBeGreaterThan(20);
    expect(refs.filter((r) => !ids.has(r))).toEqual([]);
  });

  it("flags every value that is not read directly from the plan", () => {
    const ap = res.apartment!;
    for (const o of ap.openings) {
      expect(o.provenance.fields?.height?.confidence, o.id).toBe("low");
    }
  });
});

describe("validateApartment", () => {
  const base = JSON.parse(read("data/apartment.json"));
  const mats = validateMaterials(read("data/materials.json")).byId;

  it("reports invalid JSON with line and column", () => {
    const res = validateApartment('{\n  "a": 1,\n  oops\n}', mats);
    expect(res.issues[0].message).toMatch(/line 3/);
  });

  it("reports an opening that does not fit into its wall", () => {
    const bad = structuredClone(base);
    bad.openings[0].centerFromStart = 10_000;
    const res = validateApartment(JSON.stringify(bad), mats);
    expect(res.issues.some((i) => i.severity === "error" && /does not fit/.test(i.message))).toBe(true);
  });

  it("reports unknown material presets with a hint", () => {
    const bad = structuredClone(base);
    bad.defaults.wallMaterial = "paint.does-not-exist";
    const res = validateApartment(JSON.stringify(bad), mats);
    const found = res.issues.find((i) => i.path === "defaults.wallMaterial");
    expect(found?.hint).toMatch(/paint\./);
  });

  it("reports duplicate ids and unknown keys", () => {
    const bad = structuredClone(base);
    bad.walls[1].id = bad.walls[0].id;
    expect(validateApartment(JSON.stringify(bad), mats).issues.some((i) => /duplicate id/.test(i.message))).toBe(true);
    const typo = structuredClone(base);
    typo.walls[0].thicknes = 3;
    expect(validateApartment(JSON.stringify(typo), mats).issues[0].message).toMatch(/thicknes/);
  });
});
