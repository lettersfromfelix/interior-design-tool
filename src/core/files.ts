/** Wire types of the local file API (server/localFsApi.ts), shared by server and client. */

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
}

/** Payload of the "fs:change" HMR event, sent when a file in a data folder changes on disk. */
export interface FsChange {
  dir: DataDir;
  path: string;
  event: "add" | "change" | "unlink";
}

export const FS_CHANGE_EVENT = "fs:change";
