import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApartmentFile } from "../schema/apartment";
import { checksFor, elementFacts, findElement, groupUncertain, uncertainValues } from "./elements";

const ap = ApartmentFile.parse(JSON.parse(readFileSync(new URL("../../../data/apartment.json", import.meta.url), "utf8")));

describe("apartment element helpers", () => {
  it("finds every element by id", () => {
    for (const list of [ap.rooms, ap.walls, ap.openings, ap.fixtures]) {
      for (const e of list) expect(findElement(ap, e.id)?.element).toBe(e);
    }
    expect(findElement(ap, "does-not-exist")).toBeUndefined();
  });

  it("describes elements", () => {
    const facts = elementFacts(ap, findElement(ap, ap.walls[0].id)!);
    expect(facts.map(([k]) => k)).toContain("Thickness");
  });

  it("lists uncertain values, low confidence first", () => {
    const list = uncertainValues(ap);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].confidence).toBe("low");
    expect(list.some((u) => u.field === "height")).toBe(true);
  });

  it("groups uncertain values by reason", () => {
    const list = uncertainValues(ap);
    const groups = groupUncertain(list);
    expect(groups.length).toBeLessThan(list.length);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(list.length);
  });

  it("finds the checks that refer to an element", () => {
    const withRefs = (ap.checks ?? []).find((c) => c.refs?.length);
    expect(withRefs).toBeDefined();
    expect(checksFor(ap, withRefs!.refs![0])).toContain(withRefs);
  });
});
