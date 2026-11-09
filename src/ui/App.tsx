import { useEffect } from "react";
import { duplicate, nudgeSelected, remove, rotateSelected, selectedItem } from "./actions";
import { IssueLine } from "./components";
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
  const setSidePanel = useApp((s) => s.setSidePanel);
  if (invalid) {
    return (
      <button className="overlay-note overlay-note--error" onClick={() => setSidePanel("issues")}>
        <code>{invalid}</code> has errors, so furniture can't be changed or saved. Fix the file (see Issues); it reloads automatically.
      </button>
    );
  }
  if (placing) return <div className="overlay-note">Click into the view to place {placing} · R: rotate · Esc: cancel</div>;
  return null;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

function useShortcuts(): void {
  const store = useAppStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) && e.key !== "Escape") return;
      const s = store.getState();
      const item = selectedItem(store);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "d") {
        if (item) {
          e.preventDefault(); // the browser would add a bookmark
          duplicate(store, item.uid);
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
  useShortcuts();
  return (
    <div className={`app ${catalogueOpen ? "app--with-left" : ""}`}>
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
      </main>
      <ErrorBoundary name="side panel">
        <SidePanel />
      </ErrorBoundary>
    </div>
  );
}
