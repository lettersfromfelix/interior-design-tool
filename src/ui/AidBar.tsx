import { GRID_SIZES, type CollisionMode } from "../core/placement/aids";
import { useApp } from "./store";

function Toggle(props: { on: boolean; onChange: (on: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <button className={`aid ${props.on ? "aid--on" : ""}`} aria-pressed={props.on} title={props.title} onClick={() => props.onChange(!props.on)}>
      {props.children}
    </button>
  );
}

const MODES: { mode: CollisionMode; label: string; title: string }[] = [
  { mode: "off", label: "Off", title: "No collision checks" },
  { mode: "warn", label: "Warn", title: "Overlaps turn red, warnings amber; the Inspect panel lists them" },
  { mode: "block", label: "Block", title: "Items stop at walls, fixtures and other items and slide along them" },
];

/** Placement aids and the tape measure, floating over the view. Every setting is remembered. */
export function AidBar() {
  const aids = useApp((s) => s.aids);
  const setAids = useApp((s) => s.setAids);
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const measured = useApp((s) => s.measurements.length);
  const clearMeasurements = useApp((s) => s.clearMeasurements);
  return (
    <div className="aidbar" role="toolbar" aria-label="Placement aids">
      <Toggle on={aids.wallSnap} onChange={(wallSnap) => setAids({ wallSnap })} title="Items whose back comes within 25 cm of a wall turn to it, stand flush and slide into corners">
        Wall snap
      </Toggle>
      <span className="aid-group">
        <Toggle on={aids.grid} onChange={(grid) => setAids({ grid })} title="Snap positions to a grid (along the wall for items at a wall)">
          Grid
        </Toggle>
        <select
          value={aids.gridSize}
          disabled={!aids.grid}
          onChange={(e) => setAids({ gridSize: Number(e.target.value) })}
          aria-label="Grid size"
          title="Grid size"
        >
          {GRID_SIZES.map((g) => (
            <option key={g} value={g}>
              {g} cm
            </option>
          ))}
        </select>
      </span>
      <Toggle on={aids.rotationSnap} onChange={(rotationSnap) => setAids({ rotationSnap })} title="Rotate with the ring in 15° steps (Shift: 90°, Alt: free)">
        15° steps
      </Toggle>
      <span className="aid-group" role="group" aria-label="Collisions">
        <span className="aid-label">Collisions</span>
        <span className="segmented segmented--small">
          {MODES.map((m) => (
            <button key={m.mode} className={aids.collisions === m.mode ? "active" : ""} aria-pressed={aids.collisions === m.mode} title={m.title} onClick={() => setAids({ collisions: m.mode })}>
              {m.label}
            </button>
          ))}
        </span>
      </span>
      <Toggle on={aids.distances} onChange={(distances) => setAids({ distances })} title="While moving: distances to the nearest wall, fixture or item">
        Distances
      </Toggle>
      <Toggle on={aids.clearance} onChange={(clearance) => setAids({ clearance })} title="Free space items need (doors, drawers, pulling out a chair); amber when something is in the way">
        Clearance
      </Toggle>
      <span className="aid-sep" />
      <Toggle on={tool === "measure"} onChange={(on) => setTool(on ? "measure" : "select")} title="Tape measure (M): click two points. Snaps to corners, edges and midpoints; Shift: straight, Alt: no snapping">
        📏 Measure
      </Toggle>
      {measured > 0 && (
        <button className="aid" onClick={clearMeasurements} title="Remove all measuring lines">
          Clear ({measured})
        </button>
      )}
    </div>
  );
}
