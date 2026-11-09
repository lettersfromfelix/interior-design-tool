import { createStore } from "zustand/vanilla";
import { emptySnapshot, type DataSnapshot } from "../data/snapshot";

export type ViewMode = "2d" | "3d";
export type SidePanel = "verify" | "inspect" | "issues";

/** UI preferences that survive a page reload (localStorage). */
export interface Preferences {
  view: ViewMode;
  underlay: { visible: boolean; opacity: number };
  labels: boolean;
}

export interface AppState extends Preferences {
  data: DataSnapshot;
  /** Selected apartment element (room, wall, opening or fixture id). */
  selection: string | null;
  /** Checklist item whose dimension line is shown (e.g. "M02"). */
  activeCheck: string | null;
  sidePanel: SidePanel;
  /** Bumped to ask the active view to frame the whole apartment. */
  fitRequest: number;

  setData(data: DataSnapshot): void;
  setView(view: ViewMode): void;
  toggleView(): void;
  setUnderlay(patch: Partial<Preferences["underlay"]>): void;
  setLabels(on: boolean): void;
  select(id: string | null): void;
  setActiveCheck(id: string | null): void;
  setSidePanel(panel: SidePanel): void;
  requestFit(): void;
}

const PREFS_KEY = "interior-design-tool.prefs.v1";
const defaultPrefs: Preferences = { view: "2d", underlay: { visible: false, opacity: 0.5 }, labels: true };

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
    };
  } catch {
    return defaultPrefs;
  }
}

export function createAppStore(persist = typeof localStorage !== "undefined") {
  const store = createStore<AppState>()((set) => ({
    ...(persist ? loadPrefs() : defaultPrefs),
    data: emptySnapshot(),
    selection: null,
    activeCheck: null,
    sidePanel: "verify",
    fitRequest: 0,

    setData: (data) =>
      set((s) => {
        const known = (id: string | null) =>
          !!id &&
          !!data.apartment &&
          [data.apartment.rooms, data.apartment.walls, data.apartment.openings, data.apartment.fixtures].some((list) =>
            list.some((e) => e.id === id),
          );
        return {
          data,
          selection: known(s.selection) ? s.selection : null,
          activeCheck: data.apartment?.checks?.some((c) => c.id === s.activeCheck) ? s.activeCheck : null,
        };
      }),
    setView: (view) => set({ view }),
    toggleView: () => set((s) => ({ view: s.view === "2d" ? "3d" : "2d" })),
    setUnderlay: (patch) => set((s) => ({ underlay: { ...s.underlay, ...patch } })),
    setLabels: (labels) => set({ labels }),
    select: (selection) => set((s) => ({ selection, sidePanel: selection ? "inspect" : s.sidePanel })),
    setActiveCheck: (activeCheck) => set({ activeCheck }),
    setSidePanel: (sidePanel) => set({ sidePanel }),
    requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  }));

  if (persist) {
    store.subscribe((s, prev) => {
      if (s.view === prev.view && s.underlay === prev.underlay && s.labels === prev.labels) return;
      const prefs: Preferences = { view: s.view, underlay: s.underlay, labels: s.labels };
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    });
  }
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
