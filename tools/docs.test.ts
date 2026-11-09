/** CATALOGUE.md shows complete items as examples: they must be the real files and validate without any issue. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listDir } from "../server/localFsApi";
import { assetIndex, validateCatalogue } from "../src/core/validate/catalogue";
import { validateMaterials } from "../src/core/validate/materials";

const root = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** Complete catalogue items in ```json blocks (fragments such as a single property are skipped). */
function exampleItems(markdown: string): { id: string; value: unknown }[] {
  const out: { id: string; value: unknown }[] = [];
  for (const m of markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
    let value: unknown;
    try {
      value = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (value && typeof value === "object" && "schemaVersion" in value && "id" in value) out.push({ id: String(value.id), value });
  }
  return out;
}

describe("CATALOGUE.md", async () => {
  const examples = exampleItems(read("CATALOGUE.md"));
  const dir = await listDir(root, "catalogue");
  const presets = validateMaterials(read("data/materials.json")).byId;
  const ceilingHeight = (JSON.parse(read("data/apartment.json")) as { ceilingHeight: number }).ceilingHeight;
  const { items, issues } = validateCatalogue(dir.files, { presets, assets: assetIndex(dir.assets.map((a) => a.path)), ceilingHeight });

  it("has complete examples", () => {
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  for (const { id, value } of examples) {
    it(`shows ${id} exactly as in catalogue/`, () => {
      const file = items.find((i) => i.item.id === id)?.file;
      expect(file, `no catalogue file with id "${id}"`).toBeDefined();
      expect(value).toEqual(JSON.parse(read(file!)));
      expect(issues.filter((i) => i.file === file)).toEqual([]);
    });
  }
});
