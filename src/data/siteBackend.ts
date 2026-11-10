/**
 * The website's file backend (a static build, no server). data/, catalogue/ and the published layouts come from the
 * listings made at build time (files/<dir>.json, see server/staticSite.ts); there is no live reload.
 *
 * Layouts are kept in this browser (localStorage), as text, exactly as they would be written to layouts/:
 * - a published layout that is changed here is kept as this browser's copy ("changed"); deleting the copy shows the
 *   published version again;
 * - new layouts, copies and opened files exist only here ("browser").
 * So a reload or a closed tab loses nothing; Save in the app downloads a layout as a file to keep or share it.
 * Writes are checked against the version they are based on, as on disk: a change made in another tab is never
 * overwritten (that tab's version is loaded instead, and other tabs are told about every change).
 */
import { contentTag, isLayoutName, MAX_LAYOUT_BYTES, type DataDir, type FileEntry, type FilesResponse, type FsChange } from "../core/files";
import { LayoutConflictError, type DirListing, type FileBackend, type PutLayoutOptions } from "./fileBackend";

/** localStorage key of the layouts kept in this browser: { "layouts/<name>.json": { text, mtime } }. */
export const LAYOUTS_KEY = "interior-design-tool.layouts.v1";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;
type Kept = Record<string, { text: string; mtime: number }>;

const LAYOUT_PATH_RE = /^layouts\/[^/]+\.json$/;

/** localStorage, or a store that only lives as long as the page if the browser doesn't allow storage. */
export function browserStorage(): KeyValueStore {
  try {
    const s = window.localStorage;
    s.getItem(LAYOUTS_KEY);
    return s;
  } catch {
    const memory = new Map<string, string>();
    return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };
  }
}

export interface SiteBackendOptions {
  fetch?: typeof fetch;
  /** Where "storage" events of other tabs arrive (the window). */
  events?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

export function siteBackend(base: string, storage: KeyValueStore, options: SiteBackendOptions = {}): FileBackend {
  const fetchFn = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const listings = new Map<DataDir, Promise<DirListing>>();
  /** Published layouts by path (their text), once the listing is loaded. */
  let published: Map<string, string | undefined> | undefined;
  /** Told about every write, like the dev server's file watcher (the layout list shows what changed). */
  const listeners = new Set<(change: FsChange) => void>();
  const notify = (path: string, event: FsChange["event"]) =>
    queueMicrotask(() => {
      for (const cb of listeners) cb({ dir: "layouts", path, event });
    });

  const load = (dir: DataDir): Promise<DirListing> => {
    let p = listings.get(dir);
    if (!p) {
      p = (async () => {
        // revalidated on every visit, so a new version of the website shows its new files
        const res = await fetchFn(`${base}files/${dir}.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`Could not load the ${dir}/ folder of the website (HTTP ${res.status}).`);
        const body = (await res.json()) as FilesResponse;
        if (dir === "layouts") published = new Map(body.files.map((f) => [f.path, f.text]));
        return { files: body.files, assets: body.assets ?? [] };
      })();
      listings.set(dir, p);
      p.catch(() => listings.delete(dir)); // try again next time
    }
    return p;
  };

  const readKept = (): Kept => {
    const out: Kept = {};
    try {
      const raw = storage.getItem(LAYOUTS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object") return out;
      for (const [path, v] of Object.entries(parsed as Record<string, { text?: unknown; mtime?: unknown }>)) {
        if (LAYOUT_PATH_RE.test(path) && typeof v?.text === "string") out[path] = { text: v.text, mtime: typeof v.mtime === "number" ? v.mtime : 0 };
      }
    } catch {
      // unreadable: start without kept layouts (the stored text stays until the next write)
    }
    return out;
  };
  const writeKept = (kept: Kept): void => {
    try {
      storage.setItem(LAYOUTS_KEY, JSON.stringify(kept));
    } catch {
      throw new Error("This browser doesn't let the website keep layouts (its storage is full or switched off). Use Save to download the layout as a file.");
    }
  };
  const based = (base: readonly (string | undefined)[] | undefined, text: string | undefined) => !base || base.map(contentTag).includes(contentTag(text));
  const changedElsewhere = (path: string) => new LayoutConflictError(`${path} was changed in another tab since this one read it`);

  return {
    kind: "browser",

    async fetchDir(dir) {
      const listing = await load(dir);
      if (dir !== "layouts") return listing;
      const kept = readKept();
      const files: FileEntry[] = listing.files.map((f) => {
        const own = kept[f.path];
        return own ? { path: f.path, text: own.text, mtime: own.mtime, origin: "changed" } : { ...f, origin: "site" };
      });
      for (const [path, own] of Object.entries(kept)) {
        if (!published?.has(path)) files.push({ path, text: own.text, mtime: own.mtime, origin: "browser" });
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { files, assets: listing.assets };
    },

    // no await once the layouts are listed: the write happens at once, also while the page is being closed
    async putLayout(name: string, text: string, options: PutLayoutOptions = {}) {
      if (!isLayoutName(name)) throw new Error(`invalid layout file name "${name}"`);
      if (new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES) throw new Error("layout is larger than 1 MB");
      try {
        JSON.parse(text);
      } catch {
        throw new Error("the layout is not valid JSON");
      }
      if (!published) await load("layouts");
      const path = `layouts/${name}`;
      const kept = readKept();
      if (!based(options.base, kept[path]?.text ?? published!.get(path))) throw changedElsewhere(path);
      const mtime = Date.now();
      const event = kept[path] || published!.has(path) ? "change" : "add";
      kept[path] = { text, mtime };
      writeKept(kept);
      notify(path, event);
      return { path, mtime };
    },

    async trashLayout(name, base) {
      if (!published) await load("layouts");
      const path = `layouts/${name}`;
      const kept = readKept();
      const text = kept[path]?.text ?? published!.get(path);
      if (text === undefined) throw new Error(`${path} does not exist`);
      if (!based(base, text)) throw changedElsewhere(path);
      if (!kept[path]) throw new Error(`${path} comes with the website and has no changes in this browser, so there is nothing to delete`);
      delete kept[path];
      writeKept(kept);
      notify(path, published!.has(path) ? "change" : "unlink");
      return { path, trashed: "" };
    },

    onFsChange(cb: (change: FsChange) => void) {
      listeners.add(cb);
      const target = options.events;
      // other tabs: the browser fires "storage" there (not in the tab that wrote)
      const onStorage = (e: Event) => {
        const key = (e as StorageEvent).key;
        if (key === LAYOUTS_KEY || key === null) cb({ dir: "layouts", path: "layouts", event: "change" });
      };
      target?.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        target?.removeEventListener("storage", onStorage);
      };
    },
  };
}
