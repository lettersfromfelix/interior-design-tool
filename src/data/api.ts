/** Client side of the local file API (see server/localFsApi.ts). */
import {
  contentTag,
  FS_CHANGE_EVENT,
  LAYOUT_BASE_HEADER,
  type DataDir,
  type FilesResponse,
  type FsChange,
  type WriteResponse,
} from "../core/files";

export async function fetchDir(dir: DataDir): Promise<Pick<FilesResponse, "files" | "assets">> {
  const res = await fetch(`/api/files?dir=${dir}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read the ${dir}/ folder (HTTP ${res.status}). Is the tool running via "npm start"?`);
  const body = (await res.json()) as FilesResponse;
  return { files: body.files, assets: body.assets ?? [] };
}

/** The layout file on disk is not the version the write was based on (it was changed outside the app). */
export class LayoutConflictError extends Error {}

export interface PutLayoutOptions {
  /** Let the request finish while the page is being closed. */
  keepalive?: boolean;
  /** Texts of the versions this one is based on (`undefined`: the file didn't exist); omitted = overwrite. */
  base?: readonly (string | undefined)[];
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
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    const message = detail.error ?? `HTTP ${res.status}`;
    throw res.status === 409 ? new LayoutConflictError(message) : new Error(message);
  }
  return (await res.json()) as WriteResponse;
}

/** Subscribe to file changes on disk. Returns an unsubscribe function. */
export function onFsChange(cb: (change: FsChange) => void): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  hot.on(FS_CHANGE_EVENT, cb);
  return () => hot.off(FS_CHANGE_EVENT, cb);
}

/** URL for a repository-relative asset path (underlay, textures, GLB models). */
export const assetUrl = (repoPath: string, version?: number): string =>
  `/${repoPath.replace(/^\/+/, "")}${version ? `?v=${version}` : ""}`;
