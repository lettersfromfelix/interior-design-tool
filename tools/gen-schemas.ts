/**
 * npm run schemas — regenerate the JSON Schema files in schemas/ from the Zod schemas.
 * The data files reference them via "$schema", so VS Code validates and autocompletes them.
 * Do not edit schemas/*.json by hand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ApartmentFile } from "../src/core/schema/apartment";
import { CatalogueItem } from "../src/core/schema/catalogue";
import { LayoutFile } from "../src/core/schema/layout";
import { MaterialsFile } from "../src/core/schema/materials";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "schemas");
mkdirSync(out, { recursive: true });

const schemas: Record<string, z.ZodType> = {
  "apartment.schema.json": ApartmentFile,
  "materials.schema.json": MaterialsFile,
  "catalogue-item.schema.json": CatalogueItem,
  "layout.schema.json": LayoutFile,
};

for (const [file, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any", io: "input" });
  writeFileSync(resolve(out, file), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote schemas/${file}`);
}
