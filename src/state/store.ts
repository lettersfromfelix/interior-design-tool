import { createStore } from "zustand/vanilla";
import { emptyLayout } from "../core/layout/commands";
import type { LayoutFile } from "../core/schema/layout";
import type { Issue } from "../core/validate/issues";
import { emptyCatalogue, type CatalogueSnapshot } from "../data/catalogue";
import { emptySnapshot, type DataSnapshot } from "../data/snapshot";

export type ViewMode = "2d" | "3d";
export type SidePanel = "verify" | "inspect" | "issues";
export type LeftPanel = "catalogue" | "placed";

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

/** The working layout (Phase 2: always layouts/default.json). */
export interface LayoutState {
  /** Repository-relative path. */
  file: string;
  /** "invalid": the file on disk has errors; nothing is changed or saved until it is fixed. */
  status: "loading" | "ready" | "invalid";
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

/** UI preferences that survive a page reload (localStorage). */
export interface Preferences {
  view: ViewMode;
  underlay: { visible: boolean; opacity: number };
  labels: boolean;
  catalogueOpen: boolean;
}

export interface AppState extends Preferences {
  data: DataSnapshot;
  catalogue: CatalogueSnapshot;
  layout: LayoutState;
  /** Problems found while loading 3D models, by catalogue file. */
  runtimeIssues: Readonly<Record<string, readonly Issue[]>>;
  /** Catalogue thumbnails by item id. */
  thumbnails: Readonly<Record<string, Thumbnail>>;
  selection: Selection | null;
  placing: Placing | null;
  /** Checklist item whose dimension line is shown (e.g. "M02"). */
  activeCheck: string | null;
  sidePanel: SidePanel;
  leftPanel: LeftPanel;
  /** Bumped to ask the active view to frame the whole apartment. */
  fitRequest: number;

  setData(data: DataSnapshot): void;
  setCatalogue(catalogue: CatalogueSnapshot): void;
  /** The layout file was read from disk; `text` is undefined if it does not exist (yet). */
  loadLayout(doc: LayoutFile, text: string | undefined): void;
  /** The layout file on disk has errors. */
  layoutInvalid(issues: Issue[], text: string): void;
  /** Apply a layout command. Returns false (and changes nothing) while the layout is loading or invalid. */
  edit(command: (doc: LayoutFile) => LayoutFile): boolean;
  saveStarted(text: string): void;
  /** A save of `revision` landed on disk. */
  saveFinished(text: string, revision: number): void;
  /** A save of `revision` was not written. `error` is shown until the next save; none for a conflict (the file is reloaded). */
  saveFailed(revision: number, error?: string): void;
  setRuntimeIssues(file: string, issues: readonly Issue[]): void;
  setThumbnail(itemId: string, thumbnail: Thumbnail): void;

  setView(view: ViewMode): void;
  toggleView(): void;
  setUnderlay(patch: Partial<Preferences["underlay"]>): void;
  setLabels(on: boolean): void;
  setCatalogueOpen(open: boolean): void;
  select(selection: Selection | null): void;
  selectElement(id: string | null): void;
  selectItem(uid: string | null): void;
  startPlacing(itemId: string, via: Placing["via"]): void;
  rotatePlacing(delta: number): void;
  stopPlacing(): void;
  setActiveCheck(id: string | null): void;
  setSidePanel(panel: SidePanel): void;
  setLeftPanel(panel: LeftPanel): void;
  requestFit(): void;
}

export const DEFAULT_LAYOUT_FILE = "layouts/default.json";
const PREFS_KEY = "interior-design-tool.prefs.v1";
const defaultPrefs: Preferences = { view: "2d", underlay: { visible: false, opacity: 0.5 }, labels: true, catalogueOpen: true };

function loadPrefs(): Preferences {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PREFS_KEY) : null;
    if (!raw) return defaultPrefs;
    const p = JSON.parse(raw) as Partial<Preferences>;
    return {
      view: p.view === "3d" ? "3d" : "2d",
      underlay: {
        visible: p.underlay?.visible ?? defaultPrefs.underlay.visible,
        opacity: typeof p.underlay?.opacity === "number" ? p.underlay.opacity : defaultPrefs.underlay.opacity,
      },
      labels: p.labels ?? defaultPrefs.labels,
      catalogueOpen: p.catalogueOpen ?? defaultPrefs.catalogueOpen,
    };
  } catch {
    return defaultPrefs;
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

export function createAppStore(persist = typeof localStorage !== "undefined") {
  const store = createStore<AppState>()((set, get) => ({
    ...(persist ? loadPrefs() : defaultPrefs),
    data: emptySnapshot(),
    catalogue: emptyCatalogue(),
    layout: { file: DEFAULT_LAYOUT_FILE, status: "loading", doc: emptyLayout(), issues: [], revision: 0, savedRevision: 0 },
    runtimeIssues: {},
    thumbnails: {},
    selection: null,
    placing: null,
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
    loadLayout: (doc, text) =>
      set((s) => {
        const revision = s.layout.revision + 1;
        const layout: LayoutState = { ...s.layout, status: "ready", doc, issues: [], revision, savedRevision: revision, diskText: text, saveError: undefined };
        return { layout, selection: validSelection(s.selection, s.data, doc) };
      }),
    layoutInvalid: (issues, text) => set((s) => ({ layout: { ...s.layout, status: "invalid", issues, diskText: text } })),
    edit: (command) => {
      const s = get();
      if (s.layout.status !== "ready") return false;
      const doc = command(s.layout.doc);
      if (doc === s.layout.doc) return true;
      set({
        layout: { ...s.layout, doc, revision: s.layout.revision + 1 },
        selection: validSelection(s.selection, s.data, doc),
      });
      return true;
    },
    saveStarted: (text) => set((s) => ({ layout: { ...s.layout, pendingText: text } })),
    saveFinished: (text, revision) =>
      set((s) => ({
        layout: reloadedSince(s.layout, revision)
          ? { ...s.layout, pendingText: undefined }
          : { ...s.layout, savedRevision: Math.max(s.layout.savedRevision, revision), diskText: text, pendingText: undefined, saveError: undefined },
      })),
    saveFailed: (revision, error) =>
      set((s) => ({
        layout: {
          ...s.layout,
          pendingText: undefined,
          saveError: error !== undefined && !reloadedSince(s.layout, revision) ? error : s.layout.saveError,
        },
      })),
    setRuntimeIssues: (file, issues) =>
      set((s) => {
        const prev = s.runtimeIssues[file] ?? [];
        if (prev.length === 0 && issues.length === 0) return {};
        return { runtimeIssues: { ...s.runtimeIssues, [file]: issues } };
      }),
    setThumbnail: (itemId, thumbnail) => set((s) => ({ thumbnails: { ...s.thumbnails, [itemId]: thumbnail } })),

    setView: (view) => set({ view }),
    toggleView: () => set((s) => ({ view: s.view === "2d" ? "3d" : "2d" })),
    setUnderlay: (patch) => set((s) => ({ underlay: { ...s.underlay, ...patch } })),
    setLabels: (labels) => set({ labels }),
    setCatalogueOpen: (catalogueOpen) => set({ catalogueOpen }),
    select: (selection) => set((s) => ({ selection, sidePanel: selection ? "inspect" : s.sidePanel })),
    selectElement: (id) => get().select(id ? { kind: "element", id } : null),
    selectItem: (uid) => get().select(uid ? { kind: "item", uid } : null),
    startPlacing: (itemId, via) => set((s) => ({ placing: { itemId, via, rotation: s.placing?.rotation ?? 0 } })),
    rotatePlacing: (delta) => set((s) => (s.placing ? { placing: { ...s.placing, rotation: (((s.placing.rotation + delta) % 360) + 360) % 360 } } : {})),
    stopPlacing: () => set({ placing: null }),
    setActiveCheck: (activeCheck) => set({ activeCheck }),
    setSidePanel: (sidePanel) => set({ sidePanel }),
    setLeftPanel: (leftPanel) => set({ leftPanel }),
    requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  }));

  if (persist) {
    store.subscribe((s, prev) => {
      if (s.view === prev.view && s.underlay === prev.underlay && s.labels === prev.labels && s.catalogueOpen === prev.catalogueOpen) return;
      const prefs: Preferences = { view: s.view, underlay: s.underlay, labels: s.labels, catalogueOpen: s.catalogueOpen };
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    });
  }
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
