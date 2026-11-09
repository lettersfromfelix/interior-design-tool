import { useEffect, useRef, useState } from "react";
import { Engine, type CameraState } from "../engine/Engine";
import type { AppState } from "../state/store";
import { useServices } from "./services";
import { useApp, useAppStore } from "./store";

/** Keeps the cameras of the engines of a comparison together: move one view, the other follows. */
class CameraLink {
  private readonly members = new Set<Engine>();

  join(engine: Engine): () => void {
    const leader = this.members.values().next().value;
    this.members.add(engine);
    engine.onCameraChange = (state: CameraState) => {
      for (const m of this.members) if (m !== engine) m.setCameraState(state);
    };
    if (leader) engine.setCameraState(leader.cameraState());
    return () => {
      this.members.delete(engine);
      engine.onCameraChange = undefined;
    };
  }
}

const comparedDoc = (s: AppState) => s.compare?.doc ?? null;

/** Hosts one Three.js engine. The engine reads everything it needs from the store. */
function EngineHost({ link, readOnly = false }: { link: CameraLink; readOnly?: boolean }) {
  const store = useAppStore();
  const { models } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = new Engine(ref.current!, store, models, readOnly ? { readOnly: true, doc: comparedDoc } : {});
    const leave = link.join(engine);
    return () => {
      leave();
      engine.dispose();
    };
  }, [store, models, link, readOnly]);
  return <div className="viewport" ref={ref} />;
}

/** A dot in the middle of the view while the mouse looks around. */
function Crosshair() {
  const walking = useApp((s) => s.view === "walk");
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const update = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", update);
    return () => document.removeEventListener("pointerlockchange", update);
  }, []);
  return walking && locked ? <div className="crosshair" aria-hidden /> : null;
}

/** The view; while comparing, the working layout on the left and the other one (read-only) on the right. */
export function Viewport() {
  const [link] = useState(() => new CameraLink());
  const { layouts } = useServices();
  const compare = useApp((s) => s.compare);
  const current = useApp((s) => s.layout.doc.name);
  const otherName = useApp((s) => (s.compare ? (s.layouts.find((l) => l.file === s.compare!.file)?.name ?? s.compare.file) : ""));
  const otherValid = useApp((s) => (s.compare ? (s.layouts.find((l) => l.file === s.compare!.file)?.valid ?? false) : false));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`viewports ${compare ? "viewports--split" : ""}`}>
      <div className="viewport-pane">
        {compare && (
          <div className="pane-head">
            <b>{current}</b>
            <span className="muted">editing</span>
          </div>
        )}
        <EngineHost link={link} />
        <Crosshair />
      </div>
      {compare && (
        <div className="viewport-pane viewport-pane--compare">
          <div className="pane-head">
            <b>{otherName}</b>
            <span className="muted">{compare.doc ? "read-only" : otherValid ? "loading…" : "can't be shown: the file has errors or is missing"}</span>
            <span className="spacer" />
            {error && <span className="save--error" title={error}>⚠</span>}
            <button
              className="aid"
              onClick={() => {
                setError(null);
                layouts.swapCompared().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
              }}
              title="Edit this layout; the one you are editing moves to this side"
            >
              ⇄ Edit this one
            </button>
            <button className="aid" onClick={() => layouts.compare(null)} title="Stop comparing" aria-label="Stop comparing">
              ✕
            </button>
          </div>
          <EngineHost link={link} readOnly />
        </div>
      )}
    </div>
  );
}
