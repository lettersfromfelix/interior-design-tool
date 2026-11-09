import { describe, expect, it } from "vitest";
import { layoutSlug, uniqueLayoutFile } from "./layouts";

describe("layout files", () => {
  it("turns names into plain file names", () => {
    expect(layoutSlug("Variant B")).toBe("variant-b");
    expect(layoutSlug("  Wohnzimmer – Süd/Ost!  ")).toBe("wohnzimmer-sud-ost");
    expect(layoutSlug("???")).toBe("layout");
    expect(layoutSlug("x".repeat(100))).toHaveLength(60);
  });

  it("never reuses a taken file", () => {
    const taken = ["layouts/default.json", "layouts/variant-b.json", "layouts/variant-b-2.json"];
    expect(uniqueLayoutFile("Variant B", taken)).toBe("layouts/variant-b-3.json");
    expect(uniqueLayoutFile("Variant C", taken)).toBe("layouts/variant-c.json");
  });
});
