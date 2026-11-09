/** Item actions shared by keyboard shortcuts and panel buttons. All of them are layout commands (one undo step each). */
import { duplicateItem, nextUid, nudgeItem, removeItem, rotateItem, setPlacement } from "../core/layout/commands";
import { descendants, resolvePoses } from "../core/layout/poses";
import { indexApartment } from "../core/placement/apartment";
import { layoutConflicts, newHardConflicts } from "../core/placement/collisions";
import { solvePlacement } from "../core/placement/solve";
import type { LayoutFile, PlacedItem } from "../core/schema/layout";
import { itemLookup } from "../state/derived";
import type { AppStore } from "../state/store";

/** Offset of a duplicate (cm, plan x and z), so it doesn't hide the original. */
export const DUPLICATE_OFFSET: [number, number] = [20, 20];

/** The selected placed item, if any. */
export function selectedItem(store: AppStore): PlacedItem | undefined {
  const s = store.getState();
  const sel = s.selection;
  return sel?.kind === "item" ? s.layout.doc.items.find((p) => p.uid === sel.uid) : undefined;
}

/**
 * Apply a command that moves or turns `uid`. In block mode it is refused (returns false) if the item, or anything
 * standing on it, would run into something it didn't touch before.
 */
export function guardedEdit(store: AppStore, uid: string, command: (doc: LayoutFile) => LayoutFile): boolean {
  const s = store.getState();
  const ap = s.data.apartment;
  if (s.aids.collisions !== "block" || !ap || s.layout.status !== "ready") return s.edit(command);
  const before = s.layout.doc;
  const after = command(before);
  if (after === before) return true;
  const lookup = itemLookup(s);
  const index = indexApartment(ap);
  const moving = new Set([uid, ...descendants(after, uid)]);
  const check = (doc: LayoutFile) => layoutConflicts(doc, lookup, index, resolvePoses(doc, lookup, ap.ceilingHeight), { only: moving, clearance: false });
  const was = check(before);
  const now = check(after);
  if ([...moving].some((u) => newHardConflicts(now.get(u), was.get(u)).length > 0)) return false;
  return s.edit(() => after);
}

export function duplicate(store: AppStore, uid: string): void {
  const s = store.getState();
  const p = s.layout.doc.items.find((x) => x.uid === uid);
  if (!p) return;
  const copy = nextUid(s.layout.doc, p.item);
  if (s.edit((doc) => duplicateItem(doc, uid, copy, DUPLICATE_OFFSET))) s.selectItem(copy);
}

export function remove(store: AppStore, uid: string): void {
  store.getState().edit((doc) => removeItem(doc, uid));
}

const isWallItem = (store: AppStore, p: PlacedItem) => store.getState().catalogue.entries.get(p.item)?.item.placement.type === "wall";

/** Rotate the selected item, or the preview of the item being placed. Wall items keep facing away from their wall. */
export function rotateSelected(store: AppStore, delta: number): void {
  const s = store.getState();
  if (s.placing) return s.rotatePlacing(delta);
  const p = selectedItem(store);
  if (p && !p.locked && !isWallItem(store, p)) guardedEdit(store, p.uid, (doc) => rotateItem(doc, p.uid, delta));
}

/** Move the selected item by a plan offset (cm). Wall items slide along their wall. */
export function nudgeSelected(store: AppStore, dx: number, dz: number): void {
  const p = selectedItem(store);
  if (!p || p.locked) return;
  const s = store.getState();
  const item = s.catalogue.entries.get(p.item)?.item;
  const ap = s.data.apartment;
  if (item && ap && !p.parent && item.placement.type === "wall") {
    const lookup = itemLookup(s);
    const ctx = {
      doc: s.layout.doc,
      lookup,
      ap: indexApartment(ap),
      aids: { ...s.aids, grid: false },
      poses: resolvePoses(s.layout.doc, lookup, ap.ceilingHeight),
    };
    const sol = solvePlacement(item, { point: [p.position[0] + dx, p.position[1] + dz], rotation: p.rotation }, ctx, new Set([p.uid]));
    guardedEdit(store, p.uid, (doc) => setPlacement(doc, p.uid, sol.placement));
    return;
  }
  guardedEdit(store, p.uid, (doc) => nudgeItem(doc, p.uid, [dx, dz]));
}
