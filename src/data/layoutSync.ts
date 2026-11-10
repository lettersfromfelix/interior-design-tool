import { serializeLayout } from "../core/layout/serialize";
import type { AppStore } from "../state/store";
import { backend as defaultBackend } from "./backend";
import { LayoutConflictError, type FileBackend } from "./fileBackend";

export interface LayoutSyncOptions {
  /** The file was changed on disk since the app read it (a save was refused): reload it. */
  onConflict?: () => void;
  delayMs?: number;
  retryMs?: number;
  files?: FileBackend;
}

const fileName = (file: string) => file.slice(file.lastIndexOf("/") + 1);

/**
 * Autosave: writes the working layout shortly after every change, so there is never an "unsaved" state (locally to
 * layouts/, on the website into the browser).
 * - Every write names the version of the file it is based on. The write is refused if the file was changed outside
 *   the app in the meantime (by you or GHCP, or in another tab); that version wins and is loaded instead, as with any
 *   external edit.
 * - Nothing is written while the file is invalid, so a broken file is never overwritten.
 */
export class LayoutSync {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The save that is in flight. */
  private inFlight: { text: string; revision: number; done: Promise<void> } | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly onConflict: () => void;
  private readonly delayMs: number;
  private readonly retryMs: number;
  private readonly files: FileBackend;

  constructor(
    private readonly store: AppStore,
    options: LayoutSyncOptions = {},
  ) {
    this.onConflict = options.onConflict ?? (() => {});
    this.delayMs = options.delayMs ?? 500;
    this.retryMs = options.retryMs ?? 3000;
    this.files = options.files ?? defaultBackend;
  }

  start(): void {
    this.unsubscribe = this.store.subscribe((s, prev) => {
      if (s.layout !== prev.layout) this.schedule(this.delayMs);
    });
    window.addEventListener("pagehide", this.onPageHide);
  }

  stop(): void {
    this.unsubscribe?.();
    clearTimeout(this.timer);
    window.removeEventListener("pagehide", this.onPageHide);
  }

  private get dirty(): boolean {
    const l = this.store.getState().layout;
    return l.status === "ready" && l.revision !== l.savedRevision;
  }

  private schedule(delay: number): void {
    if (!this.dirty || this.inFlight) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** Write the layout now if it has unsaved changes. */
  async flush(): Promise<void> {
    if (!this.dirty || this.inFlight) return;
    clearTimeout(this.timer);
    const { layout } = this.store.getState();
    const file = layout.file;
    const text = serializeLayout(layout.doc, new Date().toISOString());
    const revision = layout.revision;
    let finished = () => {};
    this.inFlight = { text, revision, done: new Promise<void>((resolve) => (finished = resolve)) };
    this.store.getState().saveStarted(file, text);
    let next: number | undefined = this.delayMs; // for changes made while saving
    try {
      await this.files.putLayout(fileName(file), text, { base: [layout.diskText] });
      this.store.getState().saveFinished(file, text, revision);
    } catch (err) {
      if (err instanceof LayoutConflictError) {
        console.warn(`${file} was changed on disk; loading it instead of saving over it`);
        this.store.getState().saveFailed(file, revision);
        next = undefined; // the reload replaces the local changes
        this.onConflict();
      } else {
        this.store.getState().saveFailed(file, revision, err instanceof Error ? err.message : String(err));
        next = this.retryMs;
      }
    } finally {
      this.inFlight = undefined;
      finished();
    }
    if (next !== undefined) this.schedule(next);
  }

  /** Wait until the working layout is on disk (e.g. before opening another one). False if it could not be saved. */
  async settle(): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.inFlight) await this.inFlight.done;
      else if (this.dirty) await this.flush();
      else return true;
    }
    return !this.dirty && !this.inFlight;
  }

  /**
   * The page is being closed: send unsaved changes with a request that outlives it. If a save is still in flight,
   * this one may reach the server before or after it, so it may be based on either version.
   */
  flushOnExit(): void {
    const { layout } = this.store.getState();
    if (layout.status !== "ready") return;
    const inFlight = this.inFlight;
    // nothing unsaved (a reload while saving leaves nothing either), or the save in flight already has everything
    if (!this.dirty || (inFlight && layout.revision === inFlight.revision)) return;
    const base = inFlight ? [layout.diskText, inFlight.text] : [layout.diskText];
    const text = serializeLayout(layout.doc, new Date().toISOString());
    void this.files.putLayout(fileName(layout.file), text, { keepalive: true, base }).catch(() => {});
  }

  private onPageHide = (): void => this.flushOnExit();
}
