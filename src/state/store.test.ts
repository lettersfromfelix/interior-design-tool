import { describe, expect, it } from "vitest";
import { addItem, emptyLayout, moveItem, renameLayout, setDoorOpening } from "../core/layout/commands";
import { DEFAULT_DAYLIGHT, DEFAULT_LAYOUT_FILE, DEFAULT_WALK, HISTORY_LIMIT, createAppStore } from "./store";

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

describe("slider edits", () => {
  it("makes one undo step of a slider gesture (same merge key)", () => {
    const store = ready();
    const s = () => store.getState();
    for (const deg of [80, 60, 40]) s().edit((d) => setDoorOpening(d, "d-1", deg), { merge: "door:d-1:1" });
    expect(s().layout.doc.doors).toEqual({ "d-1": 40 });
    expect(s().history.past).toHaveLength(1);
    // the next gesture is its own step
    s().edit((d) => setDoorOpening(d, "d-1", 10), { merge: "door:d-1:2" });
    expect(s().history.past).toHaveLength(2);
    s().undo();
    expect(s().layout.doc.doors).toEqual({ "d-1": 40 });
    s().undo();
    expect(s().layout.doc.doors).toBeUndefined();
  });

  it("doesn't merge across an undo or another edit", () => {
    const store = ready();
    const s = () => store.getState();
    s().edit((d) => setDoorOpening(d, "d-1", 50), { merge: "k" });
    s().undo();
    s().edit((d) => setDoorOpening(d, "d-1", 30), { merge: "k" });
    expect(s().history.past).toHaveLength(1);
    s().edit((d) => addItem(d, { uid: "a-1", item: "a", position: [0, 0], rotation: 0 }));
    s().edit((d) => setDoorOpening(d, "d-1", 20), { merge: "k" });
    expect(s().history.past).toHaveLength(3);
  });
});

describe("several layouts", () => {
  it("keeps each layout's undo steps when switching between them", () => {
    const store = ready();
    const s = () => store.getState();
    s().edit((d) => addItem(d, { uid: "a-1", item: "a", position: [0, 0], rotation: 0 }));
    s().openLayout("layouts/b.json");
    expect(s().layout).toMatchObject({ file: "layouts/b.json", status: "loading", loaded: false });
    expect(s().history.past).toEqual([]);
    s().loadLayout({ ...emptyLayout("B"), items: [] }, "{}");
    s().edit((d) => renameLayout(d, "Variant B"));
    s().openLayout(DEFAULT_LAYOUT_FILE);
    s().loadLayout({ ...emptyLayout(), items: [{ uid: "a-1", item: "a", position: [0, 0], rotation: 0 }] }, "{}");
    expect(s().history.past).toHaveLength(1);
    s().undo();
    expect(s().layout.doc.items).toEqual([]);
    s().dropHistory("layouts/b.json");
    s().openLayout("layouts/b.json");
    expect(s().history.past).toEqual([]);
  });

  it("never makes the placeholder of a layout that couldn't be read an undo step", () => {
    const store = createAppStore(false);
    const s = () => store.getState();
    s().layoutInvalid([], "{ broken");
    const fixed = { ...emptyLayout(), items: [{ uid: "a-1", item: "a", position: [0, 0] as [number, number], rotation: 0 }] };
    s().loadLayout(fixed, "{}");
    expect(s().history.past).toEqual([]);
    s().edit((d) => moveItem(d, "a-1", [10, 0]));
    s().undo();
    s().undo(); // nothing before the file was loaded
    expect(s().layout.doc).toBe(fixed);
  });

  it("doesn't compare a layout with itself, and stops comparing it when it is opened", () => {
    const store = ready();
    const s = () => store.getState();
    s().setCompare({ file: DEFAULT_LAYOUT_FILE, doc: null });
    expect(s().compare).toBeNull();
    s().setCompare({ file: "layouts/b.json", doc: null });
    s().openLayout("layouts/b.json");
    expect(s().compare).toBeNull();
  });

  it("ignores save callbacks of a layout that is no longer open", () => {
    const store = ready();
    const s = () => store.getState();
    s().saveStarted(DEFAULT_LAYOUT_FILE, "{}");
    s().openLayout("layouts/b.json");
    s().saveFinished(DEFAULT_LAYOUT_FILE, "{}", 1);
    s().saveFailed(DEFAULT_LAYOUT_FILE, 1, "disk full");
    expect(s().layout.file).toBe("layouts/b.json");
    expect(s().layout.diskText).toBeUndefined();
    expect(s().layout.saveError).toBeUndefined();
  });
});

describe("views and preferences", () => {
  it("leaves walking with Tab and when placing or measuring", () => {
    const store = ready();
    const s = () => store.getState();
    s().setView("walk");
    s().toggleView();
    expect(s().view).toBe("3d");
    s().setView("walk");
    s().startPlacing("a", "click");
    expect(s().view).toBe("3d");
    s().setView("walk");
    expect(s().placing).toBeNull();
    s().setTool("measure");
    expect(s().view).toBe("3d");
  });

  it("validates daylight and walking settings", () => {
    const store = ready();
    const s = () => store.getState();
    s().setDaylight({ on: true, minutes: 2000, date: "June" });
    expect(s().daylight).toEqual({ on: true, minutes: DEFAULT_DAYLIGHT.minutes, date: "" });
    s().setDaylight({ minutes: 600, date: "2024-06-21" });
    expect(s().daylight).toMatchObject({ minutes: 600, date: "2024-06-21" });
    s().setWalk({ eyeHeight: 500 });
    expect(s().walk.eyeHeight).toBe(DEFAULT_WALK.eyeHeight);
    s().setWalk({ eyeHeight: 150.4, furniture: false });
    expect(s().walk).toEqual({ eyeHeight: 150, furniture: false });
    s().setSidePanelOpen(false);
    expect(s().sidePanelOpen).toBe(false);
  });
});
