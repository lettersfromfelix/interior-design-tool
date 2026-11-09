/**
 * npm run validate — validate every data file with the same rules the app uses.
 * Exit code 1 if there are errors. Run this after adding or editing catalogue items,
 * materials, layouts or the apartment.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateApartment } from "../src/core/validate/apartment";
import type { Issue } from "../src/core/validate/issues";
import { validateMaterials } from "../src/core/validate/materials";

const root = resolve(import.meta.dirname, "..");
const read = (p: string) => (existsSync(resolve(root, p)) ? readFileSync(resolve(root, p), "utf8") : undefined);

const issues: Issue[] = [];
const matText = read("data/materials.json");
const mats = matText ? validateMaterials(matText) : undefined;
if (!mats) issues.push({ severity: "error", file: "data/materials.json", path: "", message: "file missing" });
else issues.push(...mats.issues);

const apText = read("data/apartment.json");
if (!apText) issues.push({ severity: "error", file: "data/apartment.json", path: "", message: "file missing" });
else {
  const res = validateApartment(apText, mats?.byId);
  issues.push(...res.issues);
  for (const c of res.areaChecks) {
    console.log(
      `  area ${c.name.padEnd(14)} ${c.computed.toFixed(2)} m² (plan ${c.labelled} m², ${(c.deviation * 100).toFixed(1)} %) ${c.ok ? "ok" : "CHECK"}`,
    );
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
