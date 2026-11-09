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

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** The most similar known id, if one is close enough to be a likely typo ("wood.oak" -> "wood.oak-natural"). */
export function closestId(id: string, known: Iterable<string>): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const k of known) {
    const score = k.startsWith(id) || id.startsWith(k) ? 0.5 : editDistance(id, k);
    if (score <= Math.max(2, id.length / 5) && (!best || score < best.score)) best = { id: k, score };
  }
  return best?.id;
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
  const guess = closestId(id, byId.keys());
  const hint = sameGroup.length
    ? `Known "${group}" presets: ${sameGroup.slice(0, 8).join(", ")}${sameGroup.length > 8 ? ", …" : ""}`
    : "Add the preset to data/materials.json or use an existing id.";
  const message = `unknown material preset "${id}"${guess ? ` (did you mean "${guess}"?)` : ""}`;
  return issue("error", file, path, message, hint);
}
