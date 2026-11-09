/**
 * npm run validate — validate every data file with the same rules the app uses.
 * Exit code 1 if there are errors. Run this after adding or editing catalogue items,
 * materials, layouts or the apartment.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listDir } from "../server/localFsApi";
import { validateApartment } from "../src/core/validate/apartment";
import { assetIndex, validateCatalogue } from "../src/core/validate/catalogue";
import type { Issue } from "../src/core/validate/issues";
import { checkLayout, parseLayout } from "../src/core/validate/layout";
import { validateMaterials } from "../src/core/validate/materials";

const root = resolve(import.meta.dirname, "..");
const read = (p: string) => (existsSync(resolve(root, p)) ? readFileSync(resolve(root, p), "utf8") : undefined);

const issues: Issue[] = [];
const matText = read("data/materials.json");
const mats = matText ? validateMaterials(matText) : undefined;
if (!mats) issues.push({ severity: "error", file: "data/materials.json", path: "", message: "file missing" });
else issues.push(...mats.issues);
const presets = mats?.byId ?? new Map();

const apText = read("data/apartment.json");
const ap = apText ? validateApartment(apText, presets) : undefined;
if (!ap) issues.push({ severity: "error", file: "data/apartment.json", path: "", message: "file missing" });
else {
  issues.push(...ap.issues);
  for (const c of ap.areaChecks) {
    console.log(
      `  area ${c.name.padEnd(14)} ${c.computed.toFixed(2)} m² (plan ${c.labelled} m², ${(c.deviation * 100).toFixed(1)} %) ${c.ok ? "ok" : "CHECK"}`,
    );
  }
}

const catalogueDir = await listDir(root, "catalogue");
const catalogue = validateCatalogue(catalogueDir.files, {
  presets,
  assets: assetIndex(catalogueDir.assets.map((a) => a.path)),
  ceilingHeight: ap?.apartment?.ceilingHeight,
});
issues.push(...catalogue.issues);
console.log(`  catalogue: ${catalogue.items.length} of ${catalogueDir.files.length} item file(s) load`);
const items = new Map(catalogue.items.map((i) => [i.item.id, i.item]));

const layouts = await listDir(root, "layouts");
for (const f of layouts.files) {
  if (f.text === undefined) {
    issues.push({ severity: "error", file: f.path, path: "", message: `could not read the file: ${f.error ?? "unknown error"}` });
    continue;
  }
  const res = parseLayout(f.text, f.path);
  issues.push(...res.issues);
  if (res.layout) {
    issues.push(...checkLayout(res.layout, f.path, (id) => items.get(id), presets));
    console.log(`  layout ${f.path}: ${res.layout.items.length} placed item(s)`);
  }
}

const icon = { error: "✖", warning: "⚠", info: "ℹ" } as const;
for (const i of issues) {
  console.log(`${icon[i.severity]} ${i.file}${i.path ? ` › ${i.path}` : ""}: ${i.message}${i.hint ? `\n    hint: ${i.hint}` : ""}`);
}
const errors = issues.filter((i) => i.severity === "error").length;
const warnings = issues.filter((i) => i.severity === "warning").length;
console.log(errors ? `\n${errors} error(s), ${warnings} warning(s)` : `\nAll data files are valid (${warnings} warning(s)).`);
process.exit(errors ? 1 : 0);
