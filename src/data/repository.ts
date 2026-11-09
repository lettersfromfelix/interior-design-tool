import type { DataDir, FileEntry } from "../core/files";
import { emptyLayout } from "../core/layout/commands";
import type { LayoutFile } from "../core/schema/layout";
import { issue } from "../core/validate/issues";
import { parseLayout } from "../core/validate/layout";
import { DEFAULT_LAYOUT_FILE, type AppStore, type LayoutInfo } from "../state/store";
import { fetchDir, onFsChange } from "./api";
import { buildSnapshot } from "./buildSnapshot";
import { buildCatalogue, type DirListing } from "./catalogue";

/** A layout in layouts/ itself (not in a subfolder such as .trash/). */
const LAYOUT_FILE_RE = /^layouts\/[^/]+\.json$/;

/** What the layout menu shows about a file: its name and size, also when the file has errors. */
function layoutInfo(f: FileEntry): LayoutInfo {
  const fallback = f.path.slice("layouts/".length, -".json".length);
  if (f.text === undefined) return { file: f.path, name: fallback, valid: false, items: 0 };
  const res = parseLayout(f.text, f.path);
  if (res.layout) {
    const { name, items, createdFrom, updatedAt } = res.layout;
    return { file: f.path, name, valid: true, items: items.length, createdFrom, updatedAt };
  }
  let name = fallback;
  try {
    const raw = JSON.parse(f.text) as { name?: unknown };
    if (typeof raw?.name === "string" && raw.name.trim()) name = raw.name;
  } catch {
    // not JSON: keep the file name
  }
  return { file: f.path, name, valid: false, items: 0 };
}

/**
 * Loads the data folders through the file API, validates them and puts the result into the store:
 * data/ (apartment, materials), catalogue/ (furniture), the list of layouts in layouts/, the working layout and the
 * layout it is compared with. Reloads a folder automatically when its files change on disk (e.g. when GHCP edits them).
 */
export class Repository {
  private readonly versions: Record<DataDir, number> = { data: 0, catalogue: 0, layouts: 0 };
  private readonly timers = new Map<DataDir, ReturnType<typeof setTimeout>>();
  private catalogueListing?: DirListing;
  private catalogueVersion = 0;
  private layoutListing?: DirListing;
  /** The file text the comparison's document was parsed from. */
  private compareSource?: { file: string; text: string | undefined; doc: LayoutFile | null };
  private layoutsSeen = false;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeStore: (() => void) | undefined;

  constructor(private readonly store: AppStore) {}

  async start(): Promise<void> {
    this.unsubscribe = onFsChange((change) => this.schedule(change.dir));
    this.unsubscribeStore = this.store.subscribe((s, prev) => {
      if (s.compare?.file !== prev.compare?.file) this.applyCompare();
    });
    await this.reload("data");
    await Promise.all([this.reload("catalogue"), this.reload("layouts")]);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribeStore?.();
    for (const t of this.timers.values()) clearTimeout(t);
  }

  /** Text of a layout file as last read from disk (undefined: not there, or not read yet). */
  layoutText(file: string): string | undefined {
    return this.layoutListing?.files.find((f) => f.path === file)?.text;
  }

  /** Editors often write a file in several steps; wait until it settles. */
  private schedule(dir: DataDir): void {
    clearTimeout(this.timers.get(dir));
    this.timers.set(
      dir,
      setTimeout(() => void this.reload(dir), 150),
    );
  }

  async reload(dir: DataDir): Promise<void> {
    const version = ++this.versions[dir];
    try {
      const listing = await fetchDir(dir);
      if (version !== this.versions[dir]) return; // a newer reload is running
      if (dir === "data") {
        this.store.getState().setData(buildSnapshot(listing.files, version));
        this.rebuildCatalogue(); // presets and the ceiling height may have changed
      } else if (dir === "catalogue") {
        this.catalogueListing = listing;
        this.rebuildCatalogue();
      } else {
        this.applyLayouts(listing);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (dir === "data") {
        const prev = this.store.getState().data;
        this.store.getState().setData({ ...prev, status: prev.apartment ? prev.status : "error", loadError: message });
      } else {
        console.error(`Could not load ${dir}/`, err);
      }
    }
  }

  private rebuildCatalogue(): void {
    if (!this.catalogueListing) return;
    const { data } = this.store.getState();
    const snapshot = buildCatalogue(this.catalogueListing, data.materials, data.apartment?.ceilingHeight, ++this.catalogueVersion);
    this.store.getState().setCatalogue(snapshot);
  }

  private applyLayouts(listing: DirListing): void {
    this.layoutListing = listing;
    const files = listing.files.filter((f) => LAYOUT_FILE_RE.test(f.path));
    this.store.getState().setLayouts(files.map(layoutInfo).sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file)));
    if (!this.layoutsSeen) {
      this.layoutsSeen = true;
      // the layout that was open last time is gone: open the default one, or any
      const s = this.store.getState();
      if (files.length && !files.some((f) => f.path === s.layout.file)) {
        s.openLayout((files.find((f) => f.path === DEFAULT_LAYOUT_FILE) ?? files[0]).path);
      }
    }
    this.applyWorkingLayout(listing);
    this.applyCompare();
  }

  private applyWorkingLayout(listing: DirListing): void {
    const s = this.store.getState();
    const { file } = s.layout;
    const entry = listing.files.find((f) => f.path === file);
    if (!entry) {
      // not created yet (start with an empty layout), or deleted on disk after it was loaded
      if (s.layout.status === "loading" || s.layout.diskText !== undefined) s.loadLayout(emptyLayout(), undefined);
      return;
    }
    if (entry.text === undefined) {
      s.layoutInvalid([issue("error", file, "", `could not read the file: ${entry.error ?? "unknown error"}`)], "");
      return;
    }
    if (s.layout.status !== "loading" && (entry.text === s.layout.diskText || entry.text === s.layout.pendingText)) return; // our own write
    const res = parseLayout(entry.text, file);
    if (res.layout) s.loadLayout(res.layout, entry.text);
    else s.layoutInvalid(res.issues, entry.text);
  }

  /** Parse the layout shown next to the working one (when it is chosen, and when its file changes). */
  private applyCompare(): void {
    const c = this.store.getState().compare;
    if (!c || !this.layoutListing) return;
    const text = this.layoutText(c.file);
    const src = this.compareSource;
    if (src && src.file === c.file && src.text === text && src.doc === c.doc) return;
    const doc = text === undefined ? null : (parseLayout(text, c.file).layout ?? null);
    this.compareSource = { file: c.file, text, doc };
    this.store.getState().setCompare({ file: c.file, doc });
  }
}
