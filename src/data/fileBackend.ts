/**
 * Where the app reads its data folders from and keeps its layouts. Two implementations:
 * - "disk" (api.ts): the local file API of the dev server (`npm start`). Reads data/, catalogue/ and layouts/ from
 *   the disk, writes layouts/ and reports changes on disk, so edits made outside the app show up live.
 * - "browser" (siteBackend.ts): the published website, a static build without a server. The folders were listed at
 *   build time; the visitor's layouts are kept in this browser.
 */
import type { DataDir, FilesResponse, FsChange, TrashResponse, WriteResponse } from "../core/files";

export type DirListing = Pick<FilesResponse, "files" | "assets">;

/** The layout file is not the version the write was based on (it was changed outside the app, or in another tab). */
export class LayoutConflictError extends Error {}

export interface PutLayoutOptions {
  /** Let the request finish while the page is being closed. */
  keepalive?: boolean;
  /** Texts of the versions this one is based on (`undefined`: the file didn't exist); omitted = overwrite. */
  base?: readonly (string | undefined)[];
}

export interface FileBackend {
  readonly kind: "disk" | "browser";
  /** False if nothing outlives the page: the browser blocks storage, so layouts are kept only until the tab closes. */
  readonly durable: boolean;
  /** The layout opened when the app doesn't remember one (a first visit) or the remembered one is gone. */
  readonly startLayout: string;
  /** All files of a data folder (JSON with their text, models and images without). */
  fetchDir(dir: DataDir): Promise<DirListing>;
  /** Write layouts/<name>. Throws LayoutConflictError if the file is none of the `base` versions. */
  putLayout(name: string, text: string, options?: PutLayoutOptions): Promise<WriteResponse>;
  /** Delete layouts/<name> (on disk: move it to layouts/.trash/). Throws LayoutConflictError like putLayout. */
  trashLayout(name: string, base?: readonly (string | undefined)[]): Promise<TrashResponse>;
  /** Subscribe to changes made outside the app. Returns an unsubscribe function. */
  onFsChange(cb: (change: FsChange) => void): () => void;
}
