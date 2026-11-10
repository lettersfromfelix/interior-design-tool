/**
 * Several layouts, one file each in layouts/ (on the website: kept in the browser): open, create, duplicate, rename,
 * delete (to layouts/.trash/), reset (website), open a layout file, and compare. Opening another layout saves the
 * working one first.
 */
import { MAX_LAYOUT_BYTES } from "../core/files";
import { emptyLayout, renameLayout } from "../core/layout/commands";
import { serializeLayout } from "../core/layout/serialize";
import type { LayoutFile } from "../core/schema/layout";
import { issue, type Issue } from "../core/validate/issues";
import { parseLayout } from "../core/validate/layout";
import { DEFAULT_LAYOUT_FILE, type AppStore } from "../state/store";
import { backend as defaultBackend } from "./backend";
import type { FileBackend } from "./fileBackend";
import type { LayoutSync } from "./layoutSync";
import type { Repository } from "./repository";

/** "Variante Süd 2" -> "variante-sud-2" (file names stay plain ASCII). */
export function layoutSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "layout";
}

/** A file in layouts/ for a new layout called `name` that doesn't clash with `taken`. */
export function uniqueLayoutFile(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = layoutSlug(name);
  for (let n = 1; ; n++) {
    const file = `layouts/${n === 1 ? slug : `${slug}-${n}`}.json`;
    if (!used.has(file)) return file;
  }
}

const fileName = (file: string) => file.slice(file.lastIndexOf("/") + 1);

/** A file that was opened is not a valid layout; `issues` says why. */
export class LayoutImportError extends Error {
  constructor(
    readonly fileName: string,
    readonly issues: readonly Issue[],
  ) {
    super(`${fileName} is not a valid layout file, so it was not opened.`);
  }
}

export class LayoutManager {
  constructor(
    private readonly store: AppStore,
    private readonly sync: LayoutSync,
    private readonly repo: Repository,
    private readonly files: FileBackend = defaultBackend,
  ) {}

  /** Make `file` the working layout. The current one is saved first; if that fails it stays open. */
  async open(file: string): Promise<void> {
    const s = this.store.getState();
    if (s.layout.file === file) return;
    await this.settle();
    this.store.getState().openLayout(file);
    await this.repo.reload("layouts");
  }

  private async settle(): Promise<void> {
    if (!(await this.sync.settle())) {
      throw new Error(`${this.store.getState().layout.file} could not be saved, so it stays open (nothing is lost). Try again in a moment.`);
    }
  }

  /** Create a layout (empty, or a copy of the working one) and open it. Returns its file. */
  async create(name: string, copyOfCurrent = false): Promise<string> {
    const s = this.store.getState();
    const clean = name.trim();
    if (!clean) throw new Error("Give the layout a name.");
    let doc: LayoutFile = emptyLayout(clean);
    if (copyOfCurrent) {
      if (s.layout.status !== "ready") throw new Error(`${s.layout.file} has errors; fix it before copying it.`);
      const src = s.layout.doc;
      doc = { ...structuredClone(src), name: clean, createdFrom: src.name };
      delete doc.updatedAt;
    }
    const file = uniqueLayoutFile(clean, [...s.layouts.map((l) => l.file), s.layout.file]);
    // base [undefined]: only if the file doesn't exist yet
    await this.files.putLayout(fileName(file), serializeLayout(doc, new Date().toISOString()), { base: [undefined] });
    this.store.getState().dropHistory(file);
    await this.open(file);
    return file;
  }

  /**
   * Add a layout file (e.g. one that was downloaded or shared) as a new layout and open it: locally it is written to
   * layouts/, on the website it is kept in the browser. It is checked like any layout file; an invalid one is refused
   * with its problems (LayoutImportError). Returns the new layout's file.
   */
  async importFile(name: string, text: string): Promise<string> {
    if (new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES) {
      throw new LayoutImportError(name, [issue("error", name, "", "the file is larger than 1 MB")]);
    }
    const res = parseLayout(text, name);
    if (!res.layout) throw new LayoutImportError(name, res.issues);
    await this.settle();
    const s = this.store.getState();
    const file = uniqueLayoutFile(name.replace(/\.json$/i, "") || res.layout.name, [...s.layouts.map((l) => l.file), s.layout.file]);
    await this.files.putLayout(fileName(file), text, { base: [undefined] });
    this.store.getState().dropHistory(file);
    await this.open(file);
    return file;
  }

  /**
   * Website: forget this browser's changes to a layout that comes with the website, so the published version is shown
   * again. For the working layout, Undo brings the changes back.
   */
  async reset(file: string): Promise<void> {
    let base: string | undefined;
    if (this.store.getState().layout.file === file) {
      await this.sync.settle();
      base = this.store.getState().layout.diskText;
    } else {
      base = this.repo.layoutText(file);
    }
    try {
      await this.files.trashLayout(fileName(file), [base]);
    } finally {
      await this.repo.reload("layouts");
    }
  }

  /** The working layout's name (the file keeps its name). */
  rename(name: string): boolean {
    return this.store.getState().edit((doc) => renameLayout(doc, name));
  }

  /** Move a layout to layouts/.trash/. If it is the working layout, another one is opened first. */
  async remove(file: string): Promise<void> {
    const s = this.store.getState();
    const others = s.layouts.filter((l) => l.file !== file);
    if (others.length === 0) throw new Error("This is the only layout. Create another one before deleting it.");
    let base: string | undefined;
    if (s.layout.file === file) {
      await this.sync.settle(); // its last changes go into the trash with it
      base = this.store.getState().layout.diskText;
      this.store.getState().openLayout((others.find((l) => l.file === DEFAULT_LAYOUT_FILE) ?? others[0]).file);
    } else {
      base = this.repo.layoutText(file);
    }
    if (this.store.getState().compare?.file === file) this.store.getState().setCompare(null);
    try {
      if (base !== undefined) await this.files.trashLayout(fileName(file), [base]);
      this.store.getState().dropHistory(file);
    } finally {
      await this.repo.reload("layouts");
    }
  }

  /** Show `file` read-only next to the working layout (null: stop comparing). */
  compare(file: string | null): void {
    this.store.getState().setCompare(file ? { file, doc: null } : null);
  }

  /** Edit the layout on the right of the comparison; the working one moves to the right. */
  async swapCompared(): Promise<void> {
    const s = this.store.getState();
    const other = s.compare?.file;
    if (!other) return;
    const current = s.layout.file;
    await this.open(other);
    this.compare(current);
  }
}
