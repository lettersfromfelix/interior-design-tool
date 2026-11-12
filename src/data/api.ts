/** Client side of the local file API (see server/localFsApi.ts): the "disk" file backend of `npm start`. */
import {
  contentTag,
  FS_CHANGE_EVENT,
  LAYOUT_BASE_HEADER,
  type DataDir,
  type FilesResponse,
  type FsChange,
  type TrashResponse,
  type WriteResponse,
} from "../core/files";
import { DEFAULT_LAYOUT_FILE } from "../state/store";
import { LayoutConflictError, type DirListing, type FileBackend, type PutLayoutOptions } from "./fileBackend";

export { LayoutConflictError, type PutLayoutOptions };

export async function fetchDir(dir: DataDir): Promise<DirListing> {
  const res = await fetch(`/api/files?dir=${dir}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read the ${dir}/ folder (HTTP ${res.status}). Is the tool running via "npm start"?`);
  const body = (await res.json()) as FilesResponse;
  return { files: body.files, assets: body.assets ?? [] };
}

/** Write layouts/<name>. Throws LayoutConflictError if the file on disk is none of the `base` versions. */
export async function putLayout(name: string, text: string, options: PutLayoutOptions = {}): Promise<WriteResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.base) headers[LAYOUT_BASE_HEADER] = options.base.map(contentTag).join(", ");
  const res = await fetch(`/api/layouts/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers,
    body: text,
    keepalive: options.keepalive ?? false,
  });
  return answer<WriteResponse>(res);
}

/** Move layouts/<name> to layouts/.trash/. Throws LayoutConflictError if the file on disk is none of the `base` versions. */
export async function trashLayout(name: string, base?: readonly (string | undefined)[]): Promise<TrashResponse> {
  const headers: Record<string, string> = {};
  if (base) headers[LAYOUT_BASE_HEADER] = base.map(contentTag).join(", ");
  return answer<TrashResponse>(await fetch(`/api/layouts/${encodeURIComponent(name)}`, { method: "DELETE", headers }));
}

async function answer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    const message = detail.error ?? `HTTP ${res.status}`;
    throw res.status === 409 ? new LayoutConflictError(message) : new Error(message);
  }
  return (await res.json()) as T;
}

/** Subscribe to file changes on disk. Returns an unsubscribe function. */
export function onFsChange(cb: (change: FsChange) => void): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  hot.on(FS_CHANGE_EVENT, cb);
  return () => hot.off(FS_CHANGE_EVENT, cb);
}

export const diskBackend: FileBackend = { kind: "disk", durable: true, startLayout: DEFAULT_LAYOUT_FILE, fetchDir, putLayout, trashLayout, onFsChange };

/** URL for a repository-relative asset path (underlay, textures, GLB models); the website lives below a base path. */
export const assetUrl = (repoPath: string, version?: number): string =>
  `${import.meta.env.BASE_URL}${repoPath.replace(/^\/+/, "")}${version ? `?v=${version}` : ""}`;
