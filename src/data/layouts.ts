/**
 * Several layouts, one file each in layouts/: open, create, duplicate, rename, delete (to layouts/.trash/) and
 * compare. Opening another layout saves the working one first.
 */
import { emptyLayout, renameLayout } from "../core/layout/commands";
import { serializeLayout } from "../core/layout/serialize";
import type { LayoutFile } from "../core/schema/layout";
import { DEFAULT_LAYOUT_FILE, type AppStore } from "../state/store";
import { putLayout, trashLayout } from "./api";
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

export class LayoutManager {
  constructor(
    private readonly store: AppStore,
    private readonly sync: LayoutSync,
    private readonly repo: Repository,
  ) {}

  /** Make `file` the working layout. The current one is saved first; if that fails it stays open. */
  async open(file: string): Promise<void> {
    const s = this.store.getState();
    if (s.layout.file === file) return;
    if (!(await this.sync.settle())) {
      throw new Error(`${s.layout.file} could not be saved, so it stays open (nothing is lost). Try again in a moment.`);
    }
    this.store.getState().openLayout(file);
    await this.repo.reload("layouts");
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
    await putLayout(fileName(file), serializeLayout(doc, new Date().toISOString()), { base: [undefined] });
    this.store.getState().dropHistory(file);
    await this.open(file);
    return file;
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
      if (base !== undefined) await trashLayout(fileName(file), [base]);
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
