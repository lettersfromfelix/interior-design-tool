import type { DataDir } from "../core/files";
import { emptyLayout } from "../core/layout/commands";
import { issue } from "../core/validate/issues";
import { parseLayout } from "../core/validate/layout";
import type { AppStore } from "../state/store";
import { fetchDir, onFsChange } from "./api";
import { buildSnapshot } from "./buildSnapshot";
import { buildCatalogue, type DirListing } from "./catalogue";

/**
 * Loads the data folders through the file API, validates them and puts the result into the store:
 * data/ (apartment, materials), catalogue/ (furniture) and the working layout in layouts/.
 * Reloads a folder automatically when its files change on disk (e.g. when GHCP edits them).
 */
export class Repository {
  private readonly versions: Record<DataDir, number> = { data: 0, catalogue: 0, layouts: 0 };
  private readonly timers = new Map<DataDir, ReturnType<typeof setTimeout>>();
  private catalogueListing?: DirListing;
  private catalogueVersion = 0;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly store: AppStore) {}

  async start(): Promise<void> {
    this.unsubscribe = onFsChange((change) => this.schedule(change.dir));
    await this.reload("data");
    await Promise.all([this.reload("catalogue"), this.reload("layouts")]);
  }

  stop(): void {
    this.unsubscribe?.();
    for (const t of this.timers.values()) clearTimeout(t);
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
    if (entry.text === s.layout.diskText || entry.text === s.layout.pendingText) return; // our own write
    const res = parseLayout(entry.text, file);
    if (res.layout) s.loadLayout(res.layout, entry.text);
    else s.layoutInvalid(res.issues, entry.text);
  }
}
