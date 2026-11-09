import { describe, expect, it } from "vitest";
import { addItem, emptyLayout, moveItem } from "../core/layout/commands";
import { HISTORY_LIMIT, createAppStore } from "./store";

const ready = () => {
  const store = createAppStore(false);
  store.getState().loadLayout(emptyLayout(), undefined);
  return store;
};

describe("undo and redo", () => {
  it("undoes and redoes every edit, and a new edit clears the redo steps", () => {
    const store = ready();
    const s = () => store.getState();
    s().edit((d) => addItem(d, { uid: "a-1", item: "a", position: [0, 0], rotation: 0 }));
    s().edit((d) => moveItem(d, "a-1", [10, 0]));
    s().edit((d) => moveItem(d, "a-1", [20, 0]));
    expect(s().history.past).toHaveLength(3);

    const rev = s().layout.revision;
    s().undo();
    expect(s().layout.doc.items[0].position).toEqual([10, 0]);
    expect(s().layout.revision).toBe(rev + 1); // saved like any edit
    s().undo();
    s().undo();
    expect(s().layout.doc.items).toEqual([]);
    s().undo(); // nothing left: no change
    expect(s().history.future).toHaveLength(3);

    s().redo();
    s().redo();
    expect(s().layout.doc.items[0].position).toEqual([10, 0]);
    s().edit((d) => moveItem(d, "a-1", [5, 5]));
    expect(s().history.future).toEqual([]);
    s().redo();
    expect(s().layout.doc.items[0].position).toEqual([5, 5]);
  });

  it("drops the selection of an item that an undo removes", () => {
    const store = ready();
    const s = () => store.getState();
    s().edit((d) => addItem(d, { uid: "a-1", item: "a", position: [0, 0], rotation: 0 }));
    s().selectItem("a-1");
    s().undo();
    expect(s().selection).toBeNull();
  });

  it("keeps at most HISTORY_LIMIT steps and ignores edits that change nothing", () => {
    const store = ready();
    const s = () => store.getState();
    s().edit((d) => addItem(d, { uid: "a-1", item: "a", position: [0, 0], rotation: 0 }));
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) s().edit((d) => moveItem(d, "a-1", [i, 0]));
    expect(s().history.past).toHaveLength(HISTORY_LIMIT);
    s().edit((d) => moveItem(d, "a-1", [HISTORY_LIMIT + 20, 0]));
    expect(s().history.past).toHaveLength(HISTORY_LIMIT);
  });

  it("starts fresh on the first load and makes a reload after an outside edit undoable", () => {
    const store = createAppStore(false);
    const s = () => store.getState();
    s().loadLayout(emptyLayout(), undefined);
    expect(s().history.past).toEqual([]);
    s().edit((d) => addItem(d, { uid: "a-1", item: "a", position: [0, 0], rotation: 0 }));
    const mine = s().layout.doc;
    const theirs = { ...emptyLayout(), name: "Edited by GHCP" };
    s().loadLayout(theirs, "{}");
    expect(s().layout.doc).toBe(theirs);
    s().undo();
    expect(s().layout.doc).toBe(mine);
  });

  it("does nothing while the layout is loading or invalid", () => {
    const store = ready();
    const s = () => store.getState();
    s().edit((d) => addItem(d, { uid: "a-1", item: "a", position: [0, 0], rotation: 0 }));
    s().layoutInvalid([], "{");
    s().undo();
    expect(s().layout.doc.items).toHaveLength(1);
  });
});

describe("tools and aids", () => {
  it("switches the measure tool, stops placing and collects measurements", () => {
    const store = ready();
    const s = () => store.getState();
    s().startPlacing("a", "click");
    s().setTool("measure");
    expect(s().placing).toBeNull();
    s().addMeasurement({ a: [0, 0, 0], b: [100, 0, 0] });
    expect(s().measurements).toHaveLength(1);
    s().startPlacing("a", "click");
    expect(s().tool).toBe("select");
    s().clearMeasurements();
    expect(s().measurements).toEqual([]);
  });

  it("validates aid changes", () => {
    const store = ready();
    store.getState().setAids({ gridSize: 25, collisions: "block" });
    expect(store.getState().aids).toMatchObject({ gridSize: 25, collisions: "block" });
    store.getState().setAids({ gridSize: 3 });
    expect(store.getState().aids.gridSize).toBe(10);
  });
});
