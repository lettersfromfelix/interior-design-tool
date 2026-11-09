/**
 * Validation of layout files (layouts/*.json).
 * File-level problems (bad JSON, schema, duplicate uids) are errors: the file is not loaded and not overwritten.
 * Problems with single placed items are warnings: the data is kept and a fallback is shown.
 */
import { isModelItem, resolveSlot } from "../catalogue/materials";
import { parentProblem, type ItemLookup } from "../layout/poses";
import type { ApartmentFile } from "../schema/apartment";
import { LayoutFile } from "../schema/layout";
import { fromZod, issue, parseJson, type Issue } from "./issues";

export function parseLayout(text: string, file: string): { layout?: LayoutFile; issues: Issue[] } {
  const parsed = parseJson(text, file);
  if (!parsed.ok) return { issues: [parsed.issue] };
  const res = LayoutFile.safeParse(parsed.value);
  if (!res.success) return { issues: fromZod(file, res.error.issues) };
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  res.data.items.forEach((p, i) => {
    const first = seen.get(p.uid);
    if (first !== undefined) {
      issues.push(issue("error", file, `items[${i}].uid`, `duplicate uid "${p.uid}" (also items[${first}])`, "Every placed item needs a unique uid."));
    } else seen.set(p.uid, i);
  });
  return issues.length ? { issues } : { layout: res.data, issues };
}

const PARENT_MESSAGES = {
  "missing-parent": "stands on an item that is not in this layout",
  cycle: "its parent chain loops back to itself",
  "missing-surface": "the base item has no surface with this index",
} as const;

/** Warnings about single placed items (unknown catalogue ids, unavailable materials, broken stacking) and about
 * door states and wall/floor finishes that refer to unknown doors, rooms, walls or presets. */
export function checkLayout(
  doc: LayoutFile,
  file: string,
  item: ItemLookup,
  presets: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  apartment?: ApartmentFile,
): Issue[] {
  const issues: Issue[] = [];
  const byUid = new Map(doc.items.map((p) => [p.uid, p]));
  doc.items.forEach((p, i) => {
    const at = `items[${i}]`;
    const entry = item(p.item);
    if (!entry) {
      issues.push(
        issue(
          "warning",
          file,
          `${at}.item`,
          `unknown catalogue item "${p.item}" (${p.uid})`,
          "It is shown as a red placeholder box and the entry is kept. Add the item to catalogue/ or fix the id.",
        ),
      );
    } else {
      for (const [slot, choice] of Object.entries(p.materials ?? {})) {
        const def = entry.materialSlots[slot];
        if (!def) {
          const known = Object.keys(entry.materialSlots);
          issues.push(issue("warning", file, `${at}.materials.${slot}`, `"${p.item}" has no material slot "${slot}"`, `Slots: ${known.join(", ") || "none"}.`));
          continue;
        }
        if (presets.size > 0 && resolveSlot(def, choice, presets, isModelItem(entry)).fallback) {
          issues.push(
            issue("warning", file, `${at}.materials.${slot}`, `"${choice}" is not available for this slot; the default "${def.default}" is used`),
          );
        }
      }
    }
    const problem = parentProblem(p, byUid, item);
    if (problem) {
      issues.push(issue("warning", file, `${at}.parent`, `${p.uid}: ${PARENT_MESSAGES[problem]}; it is placed on its own`));
    }
  });
  if (apartment) issues.push(...checkApartmentRefs(doc, file, presets, apartment));
  return issues;
}

/** `doors` and `surfaces` refer to doors, rooms and walls of the apartment, and to presets of the right group. */
function checkApartmentRefs(
  doc: LayoutFile,
  file: string,
  presets: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  ap: ApartmentFile,
): Issue[] {
  const issues: Issue[] = [];
  const warn = (path: string, message: string, hint?: string) => issues.push(issue("warning", file, path, message, hint));
  const doors = new Set(ap.openings.filter((o) => o.kind === "door").map((o) => o.id));
  for (const id of Object.keys(doc.doors ?? {})) {
    if (!doors.has(id)) warn(`doors.${id}`, `there is no door "${id}" in data/apartment.json; the entry is ignored`);
  }
  const rooms = new Set(ap.rooms.map((r) => r.id));
  const walls = new Set(ap.walls.map((w) => w.id));
  const preset = (path: string, id: string, group: string) => {
    if (presets.size > 0 && !presets.has(id)) warn(path, `unknown preset "${id}"; the apartment's own finish is shown`);
    else if (!id.startsWith(`${group}.`)) warn(path, `"${id}" is not a ${group}.* preset`, `Use one of the ${group}.* presets from data/materials.json.`);
  };
  for (const [room, id] of Object.entries(doc.surfaces?.walls?.rooms ?? {})) {
    if (!rooms.has(room)) warn(`surfaces.walls.rooms.${room}`, `there is no room "${room}"; the entry is ignored`);
    preset(`surfaces.walls.rooms.${room}`, id, "paint");
  }
  for (const [face, id] of Object.entries(doc.surfaces?.walls?.faces ?? {})) {
    const m = /^(.+):(left|right)$/.exec(face);
    if (!m || !walls.has(m[1])) warn(`surfaces.walls.faces.${face}`, `"${face}" is not "<wall id>:left" or "<wall id>:right" of a wall; the entry is ignored`);
    preset(`surfaces.walls.faces.${face}`, id, "paint");
  }
  for (const [room, id] of Object.entries(doc.surfaces?.floors ?? {})) {
    if (!rooms.has(room)) warn(`surfaces.floors.${room}`, `there is no room "${room}"; the entry is ignored`);
    preset(`surfaces.floors.${room}`, id, "floor");
  }
  return issues;
}
