import type { ViewMode } from "../state/store";
import { countIssues, useAllIssues } from "./issues";
import { LayoutMenu } from "./LayoutMenu";
import { useApp } from "./store";

function SaveStatus() {
  const layout = useApp((s) => s.layout);
  const setSidePanel = useApp((s) => s.setSidePanel);
  if (layout.status === "loading") return null;
  if (layout.status === "invalid") {
    return (
      <button className="save save--error" onClick={() => setSidePanel("issues")} title={`${layout.file} has errors. Fix the file; it reloads automatically.`}>
        ⚠ Layout not saved: file has errors
      </button>
    );
  }
  if (layout.saveError) {
    return (
      <span className="save save--error" title={layout.saveError}>
        ⚠ Could not save, retrying…
      </span>
    );
  }
  const dirty = layout.revision !== layout.savedRevision || layout.pendingText !== undefined;
  return (
    <span className="save" title={`Saved automatically to ${layout.file}`}>
      {dirty ? "Saving…" : layout.diskText === undefined ? "Nothing placed yet" : "✓ Saved"}
    </span>
  );
}

function UndoRedo() {
  const canUndo = useApp((s) => s.layout.status === "ready" && s.history.past.length > 0);
  const canRedo = useApp((s) => s.layout.status === "ready" && s.history.future.length > 0);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  return (
    <span className="segmented" role="group" aria-label="Undo and redo">
      <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        ↶
      </button>
      <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y or Ctrl+Shift+Z)" aria-label="Redo">
        ↷
      </button>
    </span>
  );
}

function Hint() {
  const view = useApp((s) => s.view);
  const itemSelected = useApp((s) => s.selection?.kind === "item");
  let text: string;
  if (view === "walk") text = "W A S D: walk · Arrows: turn / look up and down · Shift: run · Click: mouse look (Esc frees it) · F: back to the entrance";
  else if (itemSelected) text = "Drag: move · Ring: rotate (Shift 90°, Alt free) · R/Q/E: rotate · Del: delete · Ctrl+D: duplicate · Ctrl+Z: undo";
  else text = `${view === "2d" ? "Drag: pan · Wheel: zoom" : "Drag: orbit · Right-drag: pan · Wheel: zoom"} · Click: select · Tab: 2D/3D · M: measure`;
  return <span className="hint">{text}</span>;
}

/** Shows or hides the Verify / Inspect / Issues panel (with the issue count while it is hidden). */
function SidePanelToggle() {
  const open = useApp((s) => s.sidePanelOpen);
  const setOpen = useApp((s) => s.setSidePanelOpen);
  const loadError = useApp((s) => !!s.data.loadError);
  const counts = countIssues(useAllIssues());
  const errors = counts.errors + (loadError ? 1 : 0);
  const total = errors + counts.warnings;
  return (
    <button className={open ? "active" : ""} onClick={() => setOpen(!open)} aria-pressed={open} title="Show or hide the Verify / Inspect / Issues panel">
      Inspect ☰{!open && total > 0 && <span className={`count ${errors ? "count--error" : "count--warning"}`}>{total}</span>}
    </button>
  );
}

const VIEWS: { view: ViewMode; label: string; title: string }[] = [
  { view: "2d", label: "2D", title: "Top-down plan (Tab)" },
  { view: "3d", label: "3D", title: "3D orbit view (Tab)" },
  { view: "walk", label: "Walk", title: "Walk through the apartment at eye height (first person)" },
];

export function Toolbar() {
  const name = useApp((s) => s.data.apartment?.name);
  const hasUnderlay = useApp((s) => !!s.data.apartment?.underlay);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const underlay = useApp((s) => s.underlay);
  const setUnderlay = useApp((s) => s.setUnderlay);
  const labels = useApp((s) => s.labels);
  const setLabels = useApp((s) => s.setLabels);
  const requestFit = useApp((s) => s.requestFit);
  const catalogueOpen = useApp((s) => s.catalogueOpen);
  const setCatalogueOpen = useApp((s) => s.setCatalogueOpen);
  const daylight = useApp((s) => s.daylight.on);
  const setDaylight = useApp((s) => s.setDaylight);

  return (
    <header className="toolbar">
      <button className={catalogueOpen ? "active" : ""} onClick={() => setCatalogueOpen(!catalogueOpen)} aria-pressed={catalogueOpen} title="Show or hide the furniture catalogue">
        ☰ Furniture
      </button>
      <div className="brand">{name ?? "Apartment planner"}</div>
      <LayoutMenu />
      <div className="segmented" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.view} className={view === v.view ? "active" : ""} aria-pressed={view === v.view} onClick={() => setView(v.view)} title={v.title}>
            {v.label}
          </button>
        ))}
      </div>
      {view === "2d" && hasUnderlay && (
        <div className="tool-group">
          <label className="toggle">
            <input type="checkbox" checked={underlay.visible} onChange={(e) => setUnderlay({ visible: e.target.checked })} />
            Plan underlay
          </label>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={underlay.opacity}
            disabled={!underlay.visible}
            onChange={(e) => setUnderlay({ opacity: Number(e.target.value) })}
            aria-label="Underlay opacity"
            title={`Opacity ${Math.round(underlay.opacity * 100)} %`}
          />
        </div>
      )}
      {view !== "walk" && (
        <label className="toggle">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
          Room labels
        </label>
      )}
      <button onClick={requestFit} title={view === "walk" ? "Back to the entrance (F)" : "Show the whole apartment (F)"}>
        {view === "walk" ? "⌂ Entrance" : "Fit"}
      </button>
      <button className={daylight ? "active" : ""} onClick={() => setDaylight({ on: !daylight })} aria-pressed={daylight} title="Sunlight through the windows at a chosen date and time">
        ☀ Daylight
      </button>
      <UndoRedo />
      <div className="spacer" />
      <Hint />
      <SaveStatus />
      <SidePanelToggle />
    </header>
  );
}
