import { useEffect } from "react";
import { duplicate, nudgeSelected, remove, rotateSelected, selectedItem } from "./actions";
import { AidBar } from "./AidBar";
import { IssueLine } from "./components";
import { DaylightBar, WalkBar } from "./DaylightBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { LeftPanel } from "./panels/LeftPanel";
import { SidePanel } from "./SidePanel";
import { useApp, useAppStore } from "./store";
import { Toolbar } from "./Toolbar";
import { Viewport } from "./Viewport";

function DataError() {
  const issues = useApp((s) => s.data.issues);
  const loadError = useApp((s) => s.data.loadError);
  return (
    <div className="overlay-card" role="alert">
      <h2>The apartment could not be loaded</h2>
      <p>Fix the problems below and save the file. The view reloads automatically.</p>
      <ul className="issues">
        {loadError && <IssueLine issue={{ severity: "error", file: "file API", path: "", message: loadError }} />}
        {issues
          .filter((i) => i.severity === "error")
          .map((i, n) => (
            <IssueLine key={n} issue={i} />
          ))}
      </ul>
    </div>
  );
}

function Banners() {
  const invalid = useApp((s) => (s.layout.status === "invalid" ? s.layout.file : null));
  const placing = useApp((s) => (s.placing?.via === "click" ? s.catalogue.entries.get(s.placing.itemId)?.item.name : null));
  const measuring = useApp((s) => s.tool === "measure");
  const walking = useApp((s) => s.view === "walk");
  const setSidePanel = useApp((s) => s.setSidePanel);
  const setSidePanelOpen = useApp((s) => s.setSidePanelOpen);
  if (invalid) {
    return (
      <button
        className="overlay-note overlay-note--error"
        onClick={() => {
          setSidePanelOpen(true);
          setSidePanel("issues");
        }}
      >
        <code>{invalid}</code> has errors, so furniture can't be changed or saved. Fix the file (see Issues); it reloads automatically.
      </button>
    );
  }
  if (walking) return <div className="overlay-note overlay-note--walk">Click into the view to look around · W A S D or arrow keys: walk · Shift: run · Esc: free the mouse, again: leave</div>;
  if (placing) return <div className="overlay-note">Click into the view to place {placing} · R: rotate · Esc: cancel</div>;
  if (measuring) {
    return <div className="overlay-note">Tape measure: click two points · snaps to corners and edges · Shift: straight · Alt: no snapping · Esc: done</div>;
  }
  return null;
}

/** Keys typed into a text field belong to it. Sliders, checkboxes and buttons don't take text. */
const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "submit", "reset", "color"].includes((el as HTMLInputElement).type);
};

/** A focused slider moves with the arrow keys (and Home/End) itself. */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const isSlider = (t: EventTarget | null) => (t as HTMLInputElement | null)?.tagName === "INPUT" && (t as HTMLInputElement).type === "range";

function useShortcuts(): void {
  const store = useAppStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) && e.key !== "Escape") return;
      if (isSlider(e.target) && SLIDER_KEYS.has(e.key)) return;
      const s = store.getState();
      // walking: the keys move you (the furniture isn't selected or edited there); Tab, F and undo still work
      if (s.view === "walk" && !["Tab", "f", "F", "Escape"].includes(e.key) && !e.ctrlKey && !e.metaKey) return;
      const item = s.view === "walk" ? undefined : selectedItem(store);
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === "d" && item) {
          e.preventDefault(); // the browser would add a bookmark
          duplicate(store, item.uid);
        } else if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          s.undo();
        } else if (key === "y" || (key === "z" && e.shiftKey)) {
          e.preventDefault();
          s.redo();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case "Tab":
          e.preventDefault();
          s.toggleView();
          break;
        case "f":
        case "F":
          s.requestFit();
          break;
        case "m":
        case "M":
          s.setTool(s.tool === "measure" ? "select" : "measure");
          break;
        case "Escape":
          if (s.placing) s.stopPlacing();
          else {
            s.select(null);
            s.setActiveCheck(null);
          }
          break;
        case "Delete":
        case "Backspace":
          if (item && !item.locked) {
            e.preventDefault();
            remove(store, item.uid);
          }
          break;
        case "r":
        case "R":
          rotateSelected(store, e.shiftKey ? -90 : 90);
          break;
        case "q":
        case "Q":
          rotateSelected(store, -15);
          break;
        case "e":
        case "E":
          rotateSelected(store, 15);
          break;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown":
          if (item && !item.locked) {
            e.preventDefault();
            const [dx, dz] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            nudgeSelected(store, dx, dz);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

export function App() {
  const status = useApp((s) => s.data.status);
  const catalogueOpen = useApp((s) => s.catalogueOpen);
  const sidePanelOpen = useApp((s) => s.sidePanelOpen);
  const walking = useApp((s) => s.view === "walk");
  useShortcuts();
  return (
    <div className={`app ${catalogueOpen ? "app--left" : ""} ${sidePanelOpen ? "app--side" : ""}`}>
      <Toolbar />
      {catalogueOpen && (
        <ErrorBoundary name="catalogue">
          <LeftPanel />
        </ErrorBoundary>
      )}
      <main className="main">
        <ErrorBoundary name="view">
          <Viewport />
        </ErrorBoundary>
        {status === "loading" && <div className="overlay-note">Loading…</div>}
        {status === "error" && <DataError />}
        {status === "ready" && <Banners />}
        {status === "ready" && <DaylightBar />}
      </main>
      {/* a grid item: floats over the bottom of the view, or docks below the panels on narrow screens */}
      {status === "ready" && (walking ? <WalkBar /> : <AidBar />)}
      {sidePanelOpen && (
        <ErrorBoundary name="side panel">
          <SidePanel />
        </ErrorBoundary>
      )}
    </div>
  );
}
