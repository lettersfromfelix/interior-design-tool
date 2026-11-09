/**
 * Validation of layout files (layouts/*.json).
 * File-level problems (bad JSON, schema, duplicate uids) are errors: the file is not loaded and not overwritten.
 * Problems with single placed items are warnings: the data is kept and a fallback is shown.
 */
import { isModelItem, resolveSlot } from "../catalogue/materials";
import { parentProblem, type ItemLookup } from "../layout/poses";
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

/** Warnings about single placed items (unknown catalogue ids, unavailable materials, broken stacking). */
export function checkLayout(
  doc: LayoutFile,
  file: string,
  item: ItemLookup,
  presets: ReadonlySet<string> | ReadonlyMap<string, unknown>,
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
  return issues;
}
