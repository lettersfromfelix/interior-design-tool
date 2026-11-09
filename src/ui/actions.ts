/** Item actions shared by keyboard shortcuts and panel buttons. All of them are layout commands. */
import { duplicateItem, nextUid, nudgeItem, removeItem, rotateItem } from "../core/layout/commands";
import type { PlacedItem } from "../core/schema/layout";
import type { AppStore } from "../state/store";

/** Offset of a duplicate (cm, plan x and z), so it doesn't hide the original. */
export const DUPLICATE_OFFSET: [number, number] = [20, 20];

/** The selected placed item, if any. */
export function selectedItem(store: AppStore): PlacedItem | undefined {
  const s = store.getState();
  const sel = s.selection;
  return sel?.kind === "item" ? s.layout.doc.items.find((p) => p.uid === sel.uid) : undefined;
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

/** Rotate the selected item, or the preview of the item being placed. */
export function rotateSelected(store: AppStore, delta: number): void {
  const s = store.getState();
  if (s.placing) return s.rotatePlacing(delta);
  const p = selectedItem(store);
  if (p && !p.locked) s.edit((doc) => rotateItem(doc, p.uid, delta));
}

export function nudgeSelected(store: AppStore, dx: number, dz: number): void {
  const p = selectedItem(store);
  if (p && !p.locked) store.getState().edit((doc) => nudgeItem(doc, p.uid, [dx, dz]));
}
