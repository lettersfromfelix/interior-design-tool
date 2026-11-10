import { useEffect, useRef, useState } from "react";
import { isWebsite } from "../data/backend";
import { LayoutImportError } from "../data/layouts";
import type { LayoutInfo } from "../state/store";
import { downloadLayout } from "./layoutFiles";
import { useServices } from "./services";
import { useApp, useAppStore } from "./store";

type Mode = "new" | "duplicate" | "rename" | "delete" | "reset";

const TITLES: Record<"new" | "duplicate" | "rename", string> = {
  new: "New empty layout",
  duplicate: "Duplicate as a new layout",
  rename: "Rename",
};

interface MenuError {
  message: string;
  /** The problems of a layout file that could not be opened. */
  details?: string[];
}

const MAX_DETAILS = 6;

function menuError(e: unknown): MenuError {
  if (e instanceof LayoutImportError) {
    const details = e.issues.slice(0, MAX_DETAILS).map((i) => `${i.path ? `${i.path}: ` : ""}${i.message}`);
    if (e.issues.length > MAX_DETAILS) details.push(`… and ${e.issues.length - MAX_DETAILS} more`);
    return { message: e.message, details };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}

/**
 * The layouts: switch, create, duplicate, rename, delete, compare, and open a layout file. Locally they are the files
 * in layouts/; on the website they are kept in the browser, and a published layout's changes can be reset.
 */
export function LayoutMenu() {
  const { layouts: manager } = useServices();
  const store = useAppStore();
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
  const [error, setError] = useState<MenuError | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

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
      setError(menuError(e));
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

  const openFile = (picked: File | undefined) => {
    if (picked) void run(async () => manager.importFile(picked.name, await picked.text()), true);
  };

  // the working layout may not be stored yet (nothing placed so far)
  const rows: readonly LayoutInfo[] = files.some((l) => l.file === file) ? files : [{ file, name, valid: status !== "invalid", items }, ...files];
  const origin = files.find((l) => l.file === file)?.origin;
  // on the website, a published layout is reset instead of deleted
  const published = isWebsite && (origin === "site" || origin === "changed");
  const canDelete = files.some((l) => l.file === file) && files.length > 1 && !published;
  const deleteTitle = canDelete
    ? isWebsite
      ? "Remove this layout from this browser"
      : "Move this layout to layouts/.trash/"
    : "The only layout can't be deleted";

  return (
    <div className="layout-menu" ref={ref}>
      <button className={`layout-menu__button ${open ? "active" : ""}`} onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} title="Layouts: switch, create, duplicate, compare, open a file">
        ▤ <b>{name}</b> ▾
      </button>
      {open && (
        <div className="layout-menu__pop" role="dialog" aria-label="Layouts">
          <div className="layout-menu__head">
            <b>Layouts</b>
            <span className="muted small">{isWebsite ? "kept in this browser · Save downloads a file" : "one JSON file each in layouts/"}</span>
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
                      {l.origin === "changed" ? " · changed in this browser" : ""}
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
            <>
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
                {published ? (
                  <button
                    onClick={() => start("reset")}
                    disabled={busy || origin !== "changed"}
                    title={origin === "changed" ? "Drop this browser's changes and show the version that comes with the website" : "This layout comes with the website and has no changes in this browser"}
                  >
                    Reset…
                  </button>
                ) : (
                  <button onClick={() => start("delete")} disabled={busy || !canDelete} title={deleteTitle}>
                    Delete…
                  </button>
                )}
              </div>
              <div className="actions actions--compact">
                <button
                  onClick={() => picker.current?.click()}
                  disabled={busy}
                  title={isWebsite ? "Open a layout file you saved or got from someone; it is kept in this browser" : "Add a layout file you downloaded or got from someone to layouts/"}
                >
                  Open file…
                </button>
                {isWebsite && (
                  <button onClick={() => downloadLayout(store.getState().layout)} disabled={busy || status !== "ready"} title="Download this layout as a JSON file, to keep it or share it">
                    Save to file
                  </button>
                )}
                <input
                  ref={picker}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    openFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </>
          )}

          {(mode === "new" || mode === "duplicate" || mode === "rename") && (
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
              {isWebsite ? (
                <p>
                  Delete <b>{name}</b> from this browser? This can't be undone; use <b>Save to file</b> first to keep a copy.
                </p>
              ) : (
                <p>
                  Delete <b>{name}</b>? The file is moved to <code>layouts/.trash/</code>, so it can be restored.
                </p>
              )}
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

          {mode === "reset" && (
            <div className="layout-form">
              <p>
                Reset <b>{name}</b> to the version that comes with the website? The changes made in this browser are dropped; Undo brings them back.
              </p>
              <div className="actions actions--compact">
                <button className="danger" onClick={() => void run(() => manager.reset(file), true)} disabled={busy}>
                  Reset
                </button>
                <button onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="notice notice--error" role="alert">
              {error.message}
              {error.details && (
                <ul className="notice__list">
                  {error.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
