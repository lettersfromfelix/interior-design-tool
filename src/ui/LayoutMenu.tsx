import { useEffect, useRef, useState } from "react";
import type { LayoutInfo } from "../state/store";
import { useServices } from "./services";
import { useApp } from "./store";

type Mode = "new" | "duplicate" | "rename" | "delete";

const TITLES: Record<Exclude<Mode, "delete">, string> = {
  new: "New empty layout",
  duplicate: "Duplicate as a new layout",
  rename: "Rename",
};

/** The layouts in layouts/: switch, create, duplicate, rename, delete and compare. */
export function LayoutMenu() {
  const { layouts: manager } = useServices();
  const files = useApp((s) => s.layouts);
  const file = useApp((s) => s.layout.file);
  const name = useApp((s) => s.layout.doc.name);
  const items = useApp((s) => s.layout.doc.items.length);
  const status = useApp((s) => s.layout.status);
  const saved = useApp((s) => s.layout.diskText !== undefined);
  const compare = useApp((s) => s.compare?.file ?? null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setMode(null);
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (mode) setMode(null);
      else close();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, mode]);

  const run = async (action: () => Promise<unknown> | unknown, closeAfter: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode(null);
      if (closeAfter) setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = (m: Mode) => {
    setError(null);
    setMode(m);
    setText(m === "duplicate" ? `${name} (copy)` : m === "rename" ? name : "");
  };

  const submit = () => {
    if (mode === "new") void run(() => manager.create(text), true);
    else if (mode === "duplicate") void run(() => manager.create(text, true), true);
    else if (mode === "rename") void run(() => manager.rename(text), false);
  };

  // the working layout may not be on disk yet (nothing placed so far)
  const rows: readonly LayoutInfo[] = files.some((l) => l.file === file) ? files : [{ file, name, valid: status !== "invalid", items }, ...files];
  const canDelete = files.some((l) => l.file === file) && files.length > 1;

  return (
    <div className="layout-menu" ref={ref}>
      <button className={`layout-menu__button ${open ? "active" : ""}`} onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} title="Layouts: switch, create, duplicate, compare">
        ▤ <b>{name}</b> ▾
      </button>
      {open && (
        <div className="layout-menu__pop" role="dialog" aria-label="Layouts">
          <div className="layout-menu__head">
            <b>Layouts</b>
            <span className="muted small">one JSON file each in layouts/</span>
          </div>
          <ul className="layout-list">
            {rows.map((l) => {
              const current = l.file === file;
              return (
                <li key={l.file} className={`layout-row ${current ? "layout-row--current" : ""}`}>
                  <button
                    className="layout-row__open"
                    disabled={current || busy}
                    onClick={() => void run(() => manager.open(l.file), true)}
                    title={current ? "You are editing this layout" : `Open ${l.file}`}
                  >
                    <span className="layout-row__name">
                      {current ? "● " : ""}
                      {current ? name : l.name}
                      {!l.valid && <span className="save--error"> · has errors</span>}
                    </span>
                    <span className="muted small">
                      {current ? `${items} item${items === 1 ? "" : "s"}` : `${l.items} item${l.items === 1 ? "" : "s"}`}
                      {l.createdFrom ? ` · from ${l.createdFrom}` : ""}
                      {current && !saved ? " · not saved yet" : ""}
                    </span>
                  </button>
                  {!current && (
                    <button
                      className={`aid ${compare === l.file ? "aid--on" : ""}`}
                      aria-pressed={compare === l.file}
                      disabled={busy}
                      onClick={() => {
                        manager.compare(compare === l.file ? null : l.file);
                        close();
                      }}
                      title="Show this layout next to the one you are editing (read-only)"
                    >
                      {compare === l.file ? "Comparing" : "Compare"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {mode === null && (
            <div className="actions actions--compact">
              <button onClick={() => start("new")} disabled={busy}>
                New…
              </button>
              <button onClick={() => start("duplicate")} disabled={busy || status !== "ready"} title="Start a new layout from this one">
                Duplicate…
              </button>
              <button onClick={() => start("rename")} disabled={busy || status !== "ready"}>
                Rename…
              </button>
              <button onClick={() => start("delete")} disabled={busy || !canDelete} title={canDelete ? "Move this layout to layouts/.trash/" : "The only layout can't be deleted"}>
                Delete…
              </button>
            </div>
          )}

          {mode && mode !== "delete" && (
            <form
              className="layout-form"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <label className="small muted" htmlFor="layout-name">
                {TITLES[mode]}
              </label>
              <input id="layout-name" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Variant B" maxLength={80} />
              <div className="actions actions--compact">
                <button type="submit" disabled={busy || !text.trim()}>
                  {mode === "rename" ? "Rename" : "Create"}
                </button>
                <button type="button" onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
              {mode === "rename" && <p className="muted small">Changes the name shown here; the file keeps its name ({file}).</p>}
            </form>
          )}

          {mode === "delete" && (
            <div className="layout-form">
              <p>
                Delete <b>{name}</b>? The file is moved to <code>layouts/.trash/</code>, so it can be restored.
              </p>
              <div className="actions actions--compact">
                <button className="danger" onClick={() => void run(() => manager.remove(file), true)} disabled={busy}>
                  Delete
                </button>
                <button onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && <p className="notice notice--error">{error}</p>}
        </div>
      )}
    </div>
  );
}
