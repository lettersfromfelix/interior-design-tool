import { MaterialsFile, type MaterialPreset } from "../schema/materials";
import { fromZod, issue, parseJson, type Issue } from "./issues";

export interface MaterialsResult {
  materials?: MaterialsFile;
  /** Presets by id (only valid presets). */
  byId: Map<string, MaterialPreset>;
  issues: Issue[];
}

export function validateMaterials(text: string, file = "data/materials.json"): MaterialsResult {
  const issues: Issue[] = [];
  const parsed = parseJson(text, file);
  if (!parsed.ok) return { byId: new Map(), issues: [parsed.issue] };
  const res = MaterialsFile.safeParse(parsed.value);
  if (!res.success) {
    return { byId: new Map(), issues: fromZod(file, res.error.issues) };
  }
  const byId = new Map<string, MaterialPreset>();
  res.data.presets.forEach((p, i) => {
    if (byId.has(p.id)) {
      issues.push(issue("error", file, `presets[${i}].id`, `duplicate material id "${p.id}"`, "Every preset needs a unique id."));
      return;
    }
    byId.set(p.id, p);
  });
  return { materials: res.data, byId, issues };
}

/** Resolve a material reference: an exact preset id that exists. */
export function checkMaterialRef(
  id: string,
  byId: ReadonlyMap<string, MaterialPreset>,
  file: string,
  path: string,
): Issue | undefined {
  if (byId.size === 0 || byId.has(id)) return undefined;
  const group = id.split(".")[0];
  const sameGroup = [...byId.keys()].filter((k) => k.startsWith(`${group}.`));
  const hint = sameGroup.length
    ? `Known "${group}" presets: ${sameGroup.slice(0, 8).join(", ")}${sameGroup.length > 8 ? ", …" : ""}`
    : "Add the preset to data/materials.json or use an existing id.";
  return issue("error", file, path, `unknown material preset "${id}"`, hint);
}
