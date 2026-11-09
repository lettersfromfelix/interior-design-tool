import { createStore } from "zustand/vanilla";
import { emptyLayout } from "../core/layout/commands";
import { DEFAULT_AIDS, readAids, type Aids } from "../core/placement/aids";
import type { LayoutFile } from "../core/schema/layout";
import type { Issue } from "../core/validate/issues";
import { emptyCatalogue, type CatalogueSnapshot } from "../data/catalogue";
import { emptySnapshot, type DataSnapshot } from "../data/snapshot";

/** "walk": first person at eye height, inside the 3D scene. */
export type ViewMode = "2d" | "3d" | "walk";
export type SidePanel = "verify" | "inspect" | "issues";
export type LeftPanel = "catalogue" | "placed";
/** "measure": clicks in the view set tape-measure points instead of selecting. */
export type Tool = "select" | "measure";

/** A tape-measure line, [x, y, z] in cm (y = 0 in the 2D plan). */
export interface Measurement {
  a: [number, number, number];
  b: [number, number, number];
}

/** Undo/redo steps of a layout (whole documents; they share unchanged parts). */
export interface History {
  past: LayoutFile[];
  future: LayoutFile[];
}

export const HISTORY_LIMIT = 200;
const NO_HISTORY: History = { past: [], future: [] };

/** What is selected: an apartment element (room, wall, opening, fixture) or a placed furniture item. */
export type Selection = { kind: "element"; id: string } | { kind: "item"; uid: string };

/** A catalogue item that is being placed: by clicking into the view, or by dragging its card into the view. */
export interface Placing {
  itemId: string;
  via: "click" | "drag";
  /** Rotation of the preview (R rotates it while placing). */
  rotation: number;
}

export interface Thumbnail {
  /** Item revision + materials version the image was rendered for. */
  key: string;
  url: string;
}

/** The working layout: the one that is shown, edited and saved. */
export interface LayoutState {
  /** Repository-relative path, e.g. "layouts/default.json". */
  file: string;
  /** "invalid": the file on disk has errors; nothing is changed or saved until it is fixed. */
  status: "loading" | "ready" | "invalid";
  /** False while `doc` is only a placeholder (nothing was read from disk yet); a placeholder never becomes an undo step. */
  loaded: boolean;
  doc: LayoutFile;
  /** File-level problems (bad JSON, schema, duplicate uids). */
  issues: Issue[];
  /** Bumped on every local edit. */
  revision: number;
  /** The revision that is on disk (saved or loaded). */
  savedRevision: number;
  /** The text last read from or written to disk; used to recognise our own writes. */
  diskText?: string;
  /** Text of a save that is in flight. */
  pendingText?: string;
  saveError?: string;
}

/** One file in layouts/. */
export interface LayoutInfo {
  file: string;
  /** The layout's name, or the file name if the file can't be read. */
  name: string;
  valid: boolean;
  items: number;
  createdFrom?: string;
  updatedAt?: string;
}

/** A second layout shown next to the working one, read-only. */
export interface Compare {
  file: string;
  /** null while loading, or if the file is missing or invalid. */
  doc: LayoutFile | null;
}

/** Sunlight through the windows instead of the neutral default light. */
export interface Daylight {
  on: boolean;
  /** "YYYY-MM-DD"; "" = today. */
  date: string;
  /** Local time at the apartment, minutes after midnight. */
  minutes: number;
}

export interface WalkSettings {
  /** Eye height above the floor, cm. */
  eyeHeight: number;
  /** Bump into furniture (walls, doors' frames and fixtures always stop you). */
  furniture: boolean;
}

/** UI preferences that survive a page reload (localStorage). */
export interface Preferences {
  view: ViewMode;
  underlay: { visible: boolean; opacity: number };
  labels: boolean;
  catalogueOpen: boolean;
  /** The Verify / Inspect / Issues panel on the right. */
  sidePanelOpen: boolean;
  aids: Aids;
  daylight: Daylight;
  walk: WalkSettings;
}

export interface AppState extends Preferences {
  data: DataSnapshot;
  catalogue: CatalogueSnapshot;
  layout: LayoutState;
  /** Undo/redo of the working layout. */
  history: History;
  /** Undo/redo of the other layouts opened in this session, by file. */
  histories: Readonly<Record<string, History>>;
  /** All files in layouts/ (empty until the folder was read). */
  layouts: readonly LayoutInfo[];
  compare: Compare | null;
  /** Problems found while loading 3D models, by catalogue file. */
  runtimeIssues: Readonly<Record<string, readonly Issue[]>>;
  /** Catalogue thumbnails by item id. */
  thumbnails: Readonly<Record<string, Thumbnail>>;
  selection: Selection | null;
  placing: Placing | null;
  tool: Tool;
  measurements: readonly Measurement[];
  /** Checklist item whose dimension line is shown (e.g. "M02"). */
  activeCheck: string | null;
  sidePanel: SidePanel;
  leftPanel: LeftPanel;
  /** Bumped to ask the active view to frame the whole apartment. */
  fitRequest: number;

  setData(data: DataSnapshot): void;
  setCatalogue(catalogue: CatalogueSnapshot): void;
  setLayouts(layouts: readonly LayoutInfo[]): void;
  /** Make `file` the working layout (it is then loaded from disk). Keeps the undo steps of each layout. */
  openLayout(file: string): void;
  /** Forget the undo steps kept for `file` (it was deleted). */
  dropHistory(file: string): void;
  /** The layout file was read from disk; `text` is undefined if it does not exist (yet). A reload can be undone. */
  loadLayout(doc: LayoutFile, text: string | undefined): void;
  /** The layout file on disk has errors. */
  layoutInvalid(issues: Issue[], text: string): void;
  /**
   * Apply a layout command (one undo step). Consecutive edits with the same `merge` key (a slider being dragged)
   * make one step together. Returns false (and changes nothing) while the layout is loading or invalid.
   */
  edit(command: (doc: LayoutFile) => LayoutFile, options?: { merge?: string }): boolean;
  undo(): void;
  redo(): void;
  /** Save callbacks; ignored if `file` is no longer the working layout. */
  saveStarted(file: string, text: string): void;
  /** A save of `revision` landed on disk. */
  saveFinished(file: string, text: string, revision: number): void;
  /** A save of `revision` was not written. `error` is shown until the next save; none for a conflict (the file is reloaded). */
  saveFailed(file: string, revision: number, error?: string): void;
  setCompare(compare: Compare | null): void;
  setRuntimeIssues(file: string, issues: readonly Issue[]): void;
  setThumbnail(itemId: string, thumbnail: Thumbnail): void;

  setView(view: ViewMode): void;
  /** 2D <-> 3D (walk mode goes back to 3D). */
  toggleView(): void;
  setUnderlay(patch: Partial<Preferences["underlay"]>): void;
  setLabels(on: boolean): void;
  setCatalogueOpen(open: boolean): void;
  setSidePanelOpen(open: boolean): void;
  setAids(patch: Partial<Aids>): void;
  setDaylight(patch: Partial<Daylight>): void;
  setWalk(patch: Partial<WalkSettings>): void;
  select(selection: Selection | null): void;
  selectElement(id: string | null): void;
  selectItem(uid: string | null): void;
  startPlacing(itemId: string, via: Placing["via"]): void;
  rotatePlacing(delta: number): void;
  stopPlacing(): void;
  setTool(tool: Tool): void;
  addMeasurement(m: Measurement): void;
  clearMeasurements(): void;
  setActiveCheck(id: string | null): void;
  setSidePanel(panel: SidePanel): void;
  setLeftPanel(panel: LeftPanel): void;
  requestFit(): void;
}

export const DEFAULT_LAYOUT_FILE = "layouts/default.json";
const PREFS_KEY = "interior-design-tool.prefs.v1";
export const DEFAULT_DAYLIGHT: Daylight = { on: false, date: "", minutes: 15 * 60 };
export const DEFAULT_WALK: WalkSettings = { eyeHeight: 160, furniture: true };
const defaultPrefs: Preferences = {
  view: "2d",
  underlay: { visible: false, opacity: 0.5 },
  labels: true,
  catalogueOpen: true,
  sidePanelOpen: true,
  aids: DEFAULT_AIDS,
  daylight: DEFAULT_DAYLIGHT,
  walk: DEFAULT_WALK,
};

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && v >= lo && v <= hi ? v : fallback);

export function readDaylight(raw: unknown): Daylight {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Daylight>;
  return {
    on: typeof d.on === "boolean" ? d.on : DEFAULT_DAYLIGHT.on,
    date: typeof d.date === "string" && /^(\d{4}-\d{2}-\d{2})?$/.test(d.date) ? d.date : DEFAULT_DAYLIGHT.date,
    minutes: Math.round(num(d.minutes, 0, 24 * 60 - 1, DEFAULT_DAYLIGHT.minutes)),
  };
}

export function readWalk(raw: unknown): WalkSettings {
  const w = (raw && typeof raw === "object" ? raw : {}) as Partial<WalkSettings>;
  return { eyeHeight: Math.round(num(w.eyeHeight, 80, 220, DEFAULT_WALK.eyeHeight)), furniture: typeof w.furniture === "boolean" ? w.furniture : DEFAULT_WALK.furniture };
}

interface Stored extends Preferences {
  layoutFile: string;
}

function loadPrefs(): Stored {
  const fallback = { ...defaultPrefs, layoutFile: DEFAULT_LAYOUT_FILE };
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PREFS_KEY) : null;
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Stored>;
    return {
      view: p.view === "3d" || p.view === "walk" ? "3d" : "2d", // walking needs a click to start; open in 3D
      underlay: {
        visible: p.underlay?.visible ?? defaultPrefs.underlay.visible,
        opacity: typeof p.underlay?.opacity === "number" ? p.underlay.opacity : defaultPrefs.underlay.opacity,
      },
      labels: p.labels ?? defaultPrefs.labels,
      catalogueOpen: p.catalogueOpen ?? defaultPrefs.catalogueOpen,
      sidePanelOpen: p.sidePanelOpen ?? defaultPrefs.sidePanelOpen,
      aids: readAids(p.aids),
      daylight: readDaylight(p.daylight),
      walk: readWalk(p.walk),
      layoutFile: typeof p.layoutFile === "string" && /^layouts\/[^/]+\.json$/.test(p.layoutFile) ? p.layoutFile : DEFAULT_LAYOUT_FILE,
    };
  } catch {
    return fallback;
  }
}

const elementExists = (data: DataSnapshot, id: string) =>
  !!data.apartment &&
  [data.apartment.rooms, data.apartment.walls, data.apartment.openings, data.apartment.fixtures].some((list) =>
    list.some((e) => e.id === id),
  );

/** Drop a selection whose element or item no longer exists. */
function validSelection(sel: Selection | null, data: DataSnapshot, doc: LayoutFile): Selection | null {
  if (!sel) return null;
  if (sel.kind === "element") return elementExists(data, sel.id) ? sel : null;
  return doc.items.some((p) => p.uid === sel.uid) ? sel : null;
}

/** Was the file (re)loaded from disk after a save of `revision` started? Then that version is the newer one. */
const reloadedSince = (layout: LayoutState, revision: number) => layout.status !== "ready" || layout.savedRevision > revision;

const pushPast = (h: History, doc: LayoutFile): History => ({ past: [...h.past, doc].slice(-HISTORY_LIMIT), future: [] });

export function createAppStore(persist = typeof localStorage !== "undefined") {
  const stored = persist ? loadPrefs() : { ...defaultPrefs, layoutFile: DEFAULT_LAYOUT_FILE };
  const { layoutFile, ...prefs } = stored;
  /** Key of the last edit if it may be merged with the next one (slider gestures). */
  let lastMerge: string | undefined;

  const store = createStore<AppState>()((set, get) => {
    /** Show `doc` (an undo or redo step); it is saved like any edit. */
    const jump = (doc: LayoutFile, history: History) => {
      lastMerge = undefined;
      set((s) => ({
        layout: { ...s.layout, doc, revision: s.layout.revision + 1 },
        history,
        selection: validSelection(s.selection, s.data, doc),
      }));
    };
    const sameFile = (file: string) => get().layout.file === file;
    return {
      ...prefs,
      data: emptySnapshot(),
      catalogue: emptyCatalogue(),
      layout: { file: layoutFile, status: "loading", loaded: false, doc: emptyLayout(), issues: [], revision: 0, savedRevision: 0 },
      history: NO_HISTORY,
      histories: {},
      layouts: [],
      compare: null,
      runtimeIssues: {},
      thumbnails: {},
      selection: null,
      placing: null,
      tool: "select",
      measurements: [],
      activeCheck: null,
      sidePanel: "verify",
      leftPanel: "catalogue",
      fitRequest: 0,

      setData: (data) =>
        set((s) => ({
          data,
          selection: validSelection(s.selection, data, s.layout.doc),
          activeCheck: data.apartment?.checks?.some((c) => c.id === s.activeCheck) ? s.activeCheck : null,
        })),
      setCatalogue: (catalogue) =>
        set((s) => ({
          catalogue,
          placing: s.placing && catalogue.entries.has(s.placing.itemId) ? s.placing : null,
        })),
      setLayouts: (layouts) => set({ layouts }),
      openLayout: (file) => {
        const s = get();
        if (s.layout.file === file) return;
        lastMerge = undefined;
        const revision = s.layout.revision + 1;
        set({
          layout: { file, status: "loading", loaded: false, doc: emptyLayout(), issues: [], revision, savedRevision: revision },
          history: s.histories[file] ?? NO_HISTORY,
          histories: { ...s.histories, [s.layout.file]: s.history },
          compare: s.compare?.file === file ? null : s.compare,
          selection: null,
          placing: null,
        });
      },
      dropHistory: (file) =>
        set((s) => {
          if (!(file in s.histories)) return {};
          const histories = { ...s.histories };
          delete histories[file];
          return { histories };
        }),
      loadLayout: (doc, text) =>
        set((s) => {
          lastMerge = undefined;
          const revision = s.layout.revision + 1;
          const layout: LayoutState = { ...s.layout, status: "ready", loaded: true, doc, issues: [], revision, savedRevision: revision, diskText: text, saveError: undefined };
          // opening a file keeps the undo steps it had; a reload after an outside edit can be undone
          const history = !s.layout.loaded || doc === s.layout.doc ? s.history : pushPast(s.history, s.layout.doc);
          return { layout, history, selection: validSelection(s.selection, s.data, doc) };
        }),
      layoutInvalid: (issues, text) => set((s) => ({ layout: { ...s.layout, status: "invalid", issues, diskText: text } })),
      edit: (command, options) => {
        const s = get();
        if (s.layout.status !== "ready") return false;
        const doc = command(s.layout.doc);
        if (doc === s.layout.doc) return true;
        const merge = options?.merge;
        const history = merge !== undefined && merge === lastMerge ? { past: s.history.past, future: [] } : pushPast(s.history, s.layout.doc);
        lastMerge = merge;
        set({
          layout: { ...s.layout, doc, revision: s.layout.revision + 1 },
          history,
          selection: validSelection(s.selection, s.data, doc),
        });
        return true;
      },
      undo: () => {
        const s = get();
        const doc = s.history.past.at(-1);
        if (s.layout.status !== "ready" || !doc) return;
        jump(doc, { past: s.history.past.slice(0, -1), future: [s.layout.doc, ...s.history.future] });
      },
      redo: () => {
        const s = get();
        const doc = s.history.future[0];
        if (s.layout.status !== "ready" || !doc) return;
        jump(doc, { past: [...s.history.past, s.layout.doc].slice(-HISTORY_LIMIT), future: s.history.future.slice(1) });
      },
      saveStarted: (file, text) => {
        if (sameFile(file)) set((s) => ({ layout: { ...s.layout, pendingText: text } }));
      },
      saveFinished: (file, text, revision) => {
        if (!sameFile(file)) return;
        set((s) => ({
          layout: reloadedSince(s.layout, revision)
            ? { ...s.layout, pendingText: undefined }
            : { ...s.layout, savedRevision: Math.max(s.layout.savedRevision, revision), diskText: text, pendingText: undefined, saveError: undefined },
        }));
      },
      saveFailed: (file, revision, error) => {
        if (!sameFile(file)) return;
        set((s) => ({
          layout: {
            ...s.layout,
            pendingText: undefined,
            saveError: error !== undefined && !reloadedSince(s.layout, revision) ? error : s.layout.saveError,
          },
        }));
      },
      setCompare: (compare) => set((s) => ({ compare: compare && compare.file === s.layout.file ? null : compare })),
      setRuntimeIssues: (file, issues) =>
        set((s) => {
          const prev = s.runtimeIssues[file] ?? [];
          if (prev.length === 0 && issues.length === 0) return {};
          return { runtimeIssues: { ...s.runtimeIssues, [file]: issues } };
        }),
      setThumbnail: (itemId, thumbnail) => set((s) => ({ thumbnails: { ...s.thumbnails, [itemId]: thumbnail } })),

      setView: (view) => set((s) => ({ view, tool: view === "walk" ? "select" : s.tool, placing: view === "walk" ? null : s.placing })),
      toggleView: () => get().setView(get().view === "3d" ? "2d" : "3d"),
      setUnderlay: (patch) => set((s) => ({ underlay: { ...s.underlay, ...patch } })),
      setLabels: (labels) => set({ labels }),
      setCatalogueOpen: (catalogueOpen) => set({ catalogueOpen }),
      setSidePanelOpen: (sidePanelOpen) => set({ sidePanelOpen }),
      setAids: (patch) => set((s) => ({ aids: readAids({ ...s.aids, ...patch }) })),
      setDaylight: (patch) => set((s) => ({ daylight: readDaylight({ ...s.daylight, ...patch }) })),
      setWalk: (patch) => set((s) => ({ walk: readWalk({ ...s.walk, ...patch }) })),
      select: (selection) => set((s) => ({ selection, sidePanel: selection ? "inspect" : s.sidePanel })),
      selectElement: (id) => get().select(id ? { kind: "element", id } : null),
      selectItem: (uid) => get().select(uid ? { kind: "item", uid } : null),
      startPlacing: (itemId, via) =>
        set((s) => ({ placing: { itemId, via, rotation: s.placing?.rotation ?? 0 }, tool: "select", view: s.view === "walk" ? "3d" : s.view })),
      rotatePlacing: (delta) => set((s) => (s.placing ? { placing: { ...s.placing, rotation: (((s.placing.rotation + delta) % 360) + 360) % 360 } } : {})),
      stopPlacing: () => set({ placing: null }),
      setTool: (tool) => set((s) => ({ tool, placing: tool === "measure" ? null : s.placing, view: tool === "measure" && s.view === "walk" ? "3d" : s.view })),
      addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, m] })),
      clearMeasurements: () => set({ measurements: [] }),
      setActiveCheck: (activeCheck) => set({ activeCheck }),
      setSidePanel: (sidePanel) => set({ sidePanel }),
      setLeftPanel: (leftPanel) => set({ leftPanel }),
      requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
    };
  });

  if (persist) {
    store.subscribe((s, prev) => {
      const same =
        s.view === prev.view &&
        s.underlay === prev.underlay &&
        s.labels === prev.labels &&
        s.catalogueOpen === prev.catalogueOpen &&
        s.sidePanelOpen === prev.sidePanelOpen &&
        s.aids === prev.aids &&
        s.daylight === prev.daylight &&
        s.walk === prev.walk &&
        s.layout.file === prev.layout.file;
      if (same) return;
      const out: Stored = {
        view: s.view,
        underlay: s.underlay,
        labels: s.labels,
        catalogueOpen: s.catalogueOpen,
        sidePanelOpen: s.sidePanelOpen,
        aids: s.aids,
        daylight: s.daylight,
        walk: s.walk,
        layoutFile: s.layout.file,
      };
      localStorage.setItem(PREFS_KEY, JSON.stringify(out));
    });
  }
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
