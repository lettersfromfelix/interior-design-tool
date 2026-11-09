import { useApp } from "./store";

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

  return (
    <header className="toolbar">
      <div className="brand">{name ?? "Apartment planner"}</div>
      <div className="segmented" role="group" aria-label="View">
        <button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")} title="Top-down plan (Tab)">
          2D
        </button>
        <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")} title="3D orbit view (Tab)">
          3D
        </button>
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
      <label className="toggle">
        <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
        Room labels
      </label>
      <button onClick={requestFit} title="Show the whole apartment (F)">
        Fit
      </button>
      <div className="spacer" />
      <span className="hint">
        {view === "2d" ? "Drag: pan · Wheel: zoom" : "Drag: orbit · Right-drag: pan · Wheel: zoom"} · Click: inspect · Tab: 2D/3D
      </span>
    </header>
  );
}
