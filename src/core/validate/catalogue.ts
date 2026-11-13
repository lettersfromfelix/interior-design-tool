/**
 * Validation of catalogue item files (catalogue/**.json). Errors skip that one item, warnings load it with a badge.
 * Every problem names the file, the property path and, where possible, how to fix it.
 */
import { partsBounds } from "../catalogue/bounds";
import { isAllowed, isModelItem, matchesAllowed, ORIGINAL } from "../catalogue/materials";
import { dirname, expectedId, resolveRelative } from "../catalogue/paths";
import { CatalogueItem, hangsBelow } from "../schema/catalogue";
import type { MaterialPreset } from "../schema/materials";
import { fromZod, issue, parseJson, type Issue } from "./issues";
import { checkMaterialRef } from "./materials";

/** Parts may stick out of the declared dimensions by this much (cm) before a warning. */
export const DIMENSION_TOLERANCE = 1;

export interface CatalogueContext {
  presets: ReadonlyMap<string, MaterialPreset>;
  /** Non-JSON files in catalogue/ (models, textures): lower-case path -> actual repository-relative path. */
  assets: ReadonlyMap<string, string>;
  ceilingHeight?: number;
}

/** Lower-case lookup for asset paths (file names on Windows are case-insensitive). */
export const assetIndex = (paths: Iterable<string>): Map<string, string> => new Map([...paths].map((p) => [p.toLowerCase(), p]));

export interface CatalogueFileResult {
  item?: CatalogueItem;
  /** Repository-relative path of the model file (model items whose file exists). */
  modelPath?: string;
  issues: Issue[];
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

/** Validate one catalogue file on its own (no cross-file checks). */
export function validateCatalogueFile(file: string, text: string, ctx: CatalogueContext): CatalogueFileResult {
  const parsed = parseJson(text, file);
  if (!parsed.ok) return { issues: [parsed.issue] };
  const res = CatalogueItem.safeParse(parsed.value);
  if (!res.success) return { issues: fromZod(file, res.error.issues) };
  const item = res.data;
  const issues: Issue[] = [];
  const err = (path: string, message: string, hint?: string) => issues.push(issue("error", file, path, message, hint));
  const warn = (path: string, message: string, hint?: string) => issues.push(issue("warning", file, path, message, hint));
  const model = isModelItem(item);
  const slots = item.materialSlots;
  const slotNames = Object.keys(slots);
  const { width: w, depth: d, height: h } = item.dimensions;
  const T = DIMENSION_TOLERANCE;

  const expected = expectedId(file);
  if (item.id !== expected) {
    warn(
      "id",
      `id "${item.id}" does not match the file name "${expected}"`,
      /\/item\.json$/i.test(file) ? "Rename the folder or change the id so they match." : `Rename the file to "${item.id}.json" or change the id.`,
    );
  }

  // material slots
  const groups = [...new Set([...ctx.presets.keys()].map((id) => id.slice(0, id.indexOf("."))))];
  for (const [name, slot] of Object.entries(slots)) {
    const at = `materialSlots.${name}`;
    if (slot.default === ORIGINAL) {
      if (!model) err(`${at}.default`, '"@original" only works for 3D model items (geometry.type "model")', "Use a preset id instead.");
    } else {
      const bad = checkMaterialRef(slot.default, ctx.presets, file, `${at}.default`);
      if (bad) issues.push({ ...bad, severity: "warning", message: `${bad.message}; the slot is shown in neutral grey` });
      else if (!isAllowed(slot, slot.default, model)) {
        warn(`${at}.default`, `the default "${slot.default}" is not in "allowed"`, "Add it to allowed or choose an allowed preset as the default.");
      }
    }
    (slot.allowed ?? []).forEach((a, i) => {
      const path = `${at}.allowed[${i}]`;
      if (a === ORIGINAL) {
        if (!model) err(path, '"@original" only works for 3D model items (geometry.type "model")');
      } else if (ctx.presets.size > 0 && a.endsWith(".*")) {
        if (![...ctx.presets.keys()].some((id) => matchesAllowed(a, id))) {
          warn(path, `there are no presets in the group "${a.slice(0, -2)}"`, `Groups in data/materials.json: ${groups.join(", ")}.`);
        }
      } else if (ctx.presets.size > 0 && !ctx.presets.has(a)) {
        const bad = checkMaterialRef(a, ctx.presets, file, path);
        if (bad) issues.push({ ...bad, severity: "warning" });
      }
    });
  }

  // geometry
  let modelPath: string | undefined;
  if (item.geometry.type === "parametric") {
    const used = new Set<string>();
    item.geometry.parts.forEach((p, i) => {
      used.add(p.material);
      if (!(p.material in slots)) {
        err(
          `geometry.parts[${i}].material`,
          `material slot "${p.material}" is not defined in materialSlots`,
          slotNames.length ? `Defined slots: ${slotNames.join(", ")}.` : "Add it to materialSlots.",
        );
      }
    });
    for (const name of slotNames) if (!used.has(name)) warn(`materialSlots.${name}`, `slot "${name}" is not used by any part`);

    const b = partsBounds(item.geometry.parts);
    if (b) {
      const below = hangsBelow(item);
      const out: string[] = [];
      if (b.min.x < -w / 2 - T || b.max.x > w / 2 + T) out.push(`x from ${fmt(b.min.x)} to ${fmt(b.max.x)} (width ${w}: ±${fmt(w / 2)})`);
      if (b.min.z < -d / 2 - T || b.max.z > d / 2 + T) out.push(`z from ${fmt(b.min.z)} to ${fmt(b.max.z)} (depth ${d}: ±${fmt(d / 2)})`);
      if (b.min.y < -below - T || b.max.y > h + T) {
        out.push(`y from ${fmt(b.min.y)} to ${fmt(b.max.y)} (height ${h}${below ? `, hangsBelow ${below}` : ""}: ${fmt(-below)} to ${h})`);
      }
      if (out.length) {
        warn(
          "geometry.parts",
          `the parts extend beyond the declared dimensions: ${out.join("; ")}`,
          "The origin is the bottom centre of the item: x runs from −width/2 to +width/2, z from −depth/2 to +depth/2 (front = +z), y from 0 to height (onTop items with hangsBelow: from −hangsBelow).",
        );
      }
    }
  } else {
    const g = item.geometry;
    const resolved = resolveRelative(dirname(file), g.src);
    if (!resolved) {
      err("geometry.src", `"${g.src}" points outside the catalogue folder`, 'Put the model next to the item file and use e.g. "model.glb".');
    } else {
      modelPath = ctx.assets.get(resolved.toLowerCase());
      if (!modelPath) {
        err("geometry.src", `model file not found: ${resolved}`, "The path is relative to the item file. Check the file name and folder.");
      } else if (modelPath !== resolved) {
        warn("geometry.src", `the file is called "${modelPath}" (different upper/lower case)`, "Use the exact file name.");
      }
    }
    for (const [matName, slot] of Object.entries(g.materialMap ?? {})) {
      if (!(slot in slots)) err(`geometry.materialMap.${matName}`, `slot "${slot}" is not defined in materialSlots`);
    }
    const mapped = new Set(Object.values(g.materialMap ?? {}));
    for (const name of slotNames) {
      if (!mapped.has(name)) {
        warn(`materialSlots.${name}`, `slot "${name}" is not used: no model material is mapped to it in geometry.materialMap`);
      }
    }
  }

  // surfaces
  (item.surfaces ?? []).forEach((s, i) => {
    const [cx, cz] = s.center ?? [0, 0];
    if (Math.abs(cx) + s.width / 2 > w / 2 + T || Math.abs(cz) + s.depth / 2 > d / 2 + T) {
      warn(`surfaces[${i}]`, "the surface extends beyond the item's footprint", "Surfaces are measured from the item's centre: |center| + size/2 must fit into width/2 and depth/2.");
    }
    if (s.height > h + T) warn(`surfaces[${i}].height`, `the surface (${s.height} cm) is higher than the item (${h} cm)`);
  });

  // placement
  const p = item.placement;
  const ceiling = ctx.ceilingHeight;
  if (p.type === "wall") {
    if (p.minElevation !== undefined && p.maxElevation !== undefined && p.minElevation > p.maxElevation) {
      err("placement", "minElevation is greater than maxElevation");
    } else if (
      (p.minElevation !== undefined && p.defaultElevation < p.minElevation) ||
      (p.maxElevation !== undefined && p.defaultElevation > p.maxElevation)
    ) {
      warn("placement.defaultElevation", "defaultElevation is outside minElevation … maxElevation");
    }
    if (ceiling && p.defaultElevation + h > ceiling + T) {
      warn("placement.defaultElevation", `at its default elevation the item reaches ${fmt(p.defaultElevation + h)} cm, above the ceiling (${ceiling} cm)`);
    }
  } else if (ceiling && h > ceiling + T) {
    warn("dimensions.height", `the item (${h} cm) is taller than the ceiling height (${ceiling} cm)`);
  }

  return { item, modelPath, issues };
}

export interface ValidatedItem {
  item: CatalogueItem;
  file: string;
  modelPath?: string;
  warnings: number;
}

export interface CatalogueFileInput {
  path: string;
  text?: string;
  error?: string;
}

/** Validate all catalogue files: per file, then unique ids (the first file in path order wins). */
export function validateCatalogue(
  files: readonly CatalogueFileInput[],
  ctx: CatalogueContext,
): { items: ValidatedItem[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const items: ValidatedItem[] = [];
  const owner = new Map<string, string>();
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (f.text === undefined) {
      issues.push(issue("error", f.path, "", `could not read the file: ${f.error ?? "unknown error"}`));
      continue;
    }
    const res = validateCatalogueFile(f.path, f.text, ctx);
    issues.push(...res.issues);
    if (!res.item || res.issues.some((i) => i.severity === "error")) continue;
    const first = owner.get(res.item.id);
    if (first) {
      issues.push(issue("error", f.path, "id", `duplicate id "${res.item.id}" (also used by ${first}); this file is skipped`, "Every item needs a unique id."));
      continue;
    }
    owner.set(res.item.id, f.path);
    items.push({ item: res.item, file: f.path, modelPath: res.modelPath, warnings: res.issues.filter((i) => i.severity === "warning").length });
  }
  return { items, issues };
}
