/** Values derived from the store, memoized so the engine and the UI share one computation. */
import { resolvePoses, type ItemLookup } from "../core/layout/poses";
import { indexApartment } from "../core/placement/apartment";
import { layoutConflicts, type Conflict } from "../core/placement/collisions";
import type { LayoutFile } from "../core/schema/layout";
import type { AppState } from "./store";

type Inputs = Pick<AppState, "layout" | "catalogue" | "data" | "aids">;

export const itemLookup = (s: Pick<AppState, "catalogue">): ItemLookup => (id) => s.catalogue.entries.get(id)?.item;

const NONE: ReadonlyMap<string, readonly Conflict[]> = new Map();
/** The last results (the working layout and, while comparing, the other one). */
const memos: { key: unknown[]; value: ReadonlyMap<string, readonly Conflict[]> }[] = [];

/**
 * Conflicts of a layout (default: the working layout) by uid, as the aids ask for: collisions unless they are off,
 * clearance warnings while clearance zones are shown.
 */
export function conflictsOf(s: Inputs, doc: LayoutFile = s.layout.doc): ReadonlyMap<string, readonly Conflict[]> {
  const ap = s.data.apartment;
  const collisions = s.aids.collisions !== "off";
  const clearance = s.aids.clearance;
  if (!ap || (!collisions && !clearance)) return NONE;
  const key = [doc, s.catalogue, ap, collisions, clearance];
  const hit = memos.find((m) => m.key.every((k, i) => k === key[i]));
  if (hit) return hit.value;
  const lookup = itemLookup(s);
  const all = layoutConflicts(doc, lookup, indexApartment(ap), resolvePoses(doc, lookup, ap.ceilingHeight), { clearance });
  let value: Map<string, Conflict[]> = all;
  if (!collisions) {
    value = new Map();
    for (const [uid, list] of all) {
      const kept = list.filter((c) => c.kind === "clearance");
      if (kept.length) value.set(uid, kept);
    }
  }
  memos.unshift({ key, value });
  memos.length = Math.min(memos.length, 2);
  return value;
}

/** "hard" if an item has a real overlap, "soft" if it only has warnings. */
export function conflictLevel(list: readonly Conflict[] | undefined): "hard" | "soft" | undefined {
  if (!list?.length) return undefined;
  return list.some((c) => c.hard) ? "hard" : "soft";
}
