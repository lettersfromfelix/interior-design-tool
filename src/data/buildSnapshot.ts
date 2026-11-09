import { validateApartment } from "../core/validate/apartment";
import { issue, type Issue } from "../core/validate/issues";
import { validateMaterials } from "../core/validate/materials";
import type { FileEntry } from "../core/files";
import type { DataSnapshot } from "./snapshot";

export const APARTMENT_FILE = "data/apartment.json";
export const MATERIALS_FILE = "data/materials.json";

/**
 * Build a validated snapshot from the raw files of the data/ folder.
 * Never throws: every problem becomes an issue. Without a valid apartment the status is "error".
 */
export function buildSnapshot(dataFiles: readonly FileEntry[], version: number): DataSnapshot {
  const issues: Issue[] = [];
  const byPath = new Map(dataFiles.map((f) => [f.path, f]));
  const read = (p: string): string | undefined => {
    const f = byPath.get(p);
    if (!f) issues.push(issue("error", p, "", "file not found"));
    else if (f.text === undefined) issues.push(issue("error", p, "", `could not read the file: ${f.error ?? "unknown error"}`));
    return f?.text;
  };

  const matText = read(MATERIALS_FILE);
  const mats = matText !== undefined ? validateMaterials(matText) : undefined;
  if (mats) issues.push(...mats.issues);
  if (mats && mats.byId.size === 0 && mats.issues.length) {
    issues.push(issue("warning", MATERIALS_FILE, "", "materials could not be loaded; everything is shown in neutral grey"));
  }

  const apText = read(APARTMENT_FILE);
  const ap = apText !== undefined ? validateApartment(apText, mats?.byId) : undefined;
  if (ap) issues.push(...ap.issues);

  return {
    status: ap?.apartment ? "ready" : "error",
    version,
    apartment: ap?.apartment,
    materials: mats?.byId ?? new Map(),
    issues,
    areaChecks: ap?.areaChecks ?? [],
  };
}
