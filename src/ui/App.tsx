import { useEffect } from "react";
import { IssueLine } from "./components";
import { ErrorBoundary } from "./ErrorBoundary";
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

function useShortcuts(): void {
  const store = useAppStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) && e.key !== "Escape") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = store.getState();
      if (e.key === "Tab") {
        e.preventDefault();
        s.toggleView();
      } else if (e.key === "f" || e.key === "F") {
        s.requestFit();
      } else if (e.key === "Escape") {
        s.select(null);
        s.setActiveCheck(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

export function App() {
  const status = useApp((s) => s.data.status);
  useShortcuts();
  return (
    <div className="app">
      <Toolbar />
      <main className="main">
        <ErrorBoundary name="view">
          <Viewport />
        </ErrorBoundary>
        {status === "loading" && <div className="overlay-note">Loading…</div>}
        {status === "error" && <DataError />}
      </main>
      <ErrorBoundary name="side panel">
        <SidePanel />
      </ErrorBoundary>
    </div>
  );
}
