/** Wire types of the local file API (server/localFsApi.ts), shared by server and client. */
// with ".ts": the Vite config loads this file through server/localFsApi.ts (Vite's native config loader needs it)
import { hashText } from "./hash.ts";

export const DATA_DIRS = ["data", "catalogue", "layouts"] as const;
export type DataDir = (typeof DATA_DIRS)[number];

export const isDataDir = (d: unknown): d is DataDir => typeof d === "string" && (DATA_DIRS as readonly string[]).includes(d);

/** One file returned by GET /api/files. `text` is missing if the file could not be read (`error`). */
export interface FileEntry {
  /** Repository-relative path with forward slashes, e.g. "catalogue/sofa.json". */
  path: string;
  text?: string;
  /** Last modification, ms since epoch. */
  mtime?: number;
  error?: string;
}

export interface FilesResponse {
  dir: DataDir;
  files: FileEntry[];
  /** Non-JSON files in the folder (models, textures), recursive. */
  assets: AssetEntry[];
}

/** A model or image file in a data folder. */
export interface AssetEntry {
  /** Repository-relative path with forward slashes, e.g. "catalogue/stool/model.glb". */
  path: string;
  size: number;
  mtime: number;
}

/** Response of PUT /api/layouts/<name>.json. */
export interface WriteResponse {
  path: string;
  mtime: number;
}

/** Layout file names: letters, digits, space, ".", "_" and "-", ending in ".json"; no folders. */
export const LAYOUT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}\.json$/;
export const isLayoutName = (name: string): boolean => LAYOUT_NAME_RE.test(name) && !name.includes("..");

/**
 * Request header of PUT /api/layouts/<name>.json: the version(s) of the file the write is based on, as contentTag()s,
 * comma-separated. The server only writes if the file on disk is one of them and answers 409 otherwise, so a change
 * made outside the app (by you or GHCP) is never overwritten. Without the header the write is unconditional.
 */
export const LAYOUT_BASE_HEADER = "x-layout-base";
/** contentTag() of a file that doesn't exist. */
export const NO_FILE_TAG = "none";

/** Identifies one version of a file by its text; `undefined` = the file doesn't exist. */
export const contentTag = (text: string | undefined): string =>
  text === undefined ? NO_FILE_TAG : `${text.length.toString(36)}-${hashText(text)}`;

/** Payload of the "fs:change" HMR event, sent when a file in a data folder changes on disk. */
export interface FsChange {
  dir: DataDir;
  path: string;
  event: "add" | "change" | "unlink";
}

export const FS_CHANGE_EVENT = "fs:change";
