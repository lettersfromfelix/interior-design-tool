import type { AppStore } from "../state/store";
import { fetchDir, onFsChange } from "./api";
import { buildSnapshot } from "./buildSnapshot";

/**
 * Loads the data folders through the file API, validates them and puts the result into the store.
 * Reloads automatically when files change on disk (e.g. when GHCP edits them).
 */
export class Repository {
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly store: AppStore) {}

  async start(): Promise<void> {
    this.unsubscribe = onFsChange((change) => {
      if (change.dir === "data") this.scheduleReload();
    });
    await this.reload();
  }

  stop(): void {
    this.unsubscribe?.();
    clearTimeout(this.timer);
  }

  /** Editors often write a file in several steps; wait until it settles. */
  private scheduleReload(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.reload(), 150);
  }

  async reload(): Promise<void> {
    const version = ++this.version;
    try {
      const files = await fetchDir("data");
      if (version !== this.version) return; // a newer reload is running
      this.store.getState().setData(buildSnapshot(files, version));
    } catch (err) {
      const prev = this.store.getState().data;
      this.store.getState().setData({
        ...prev,
        status: prev.apartment ? prev.status : "error",
        loadError: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
