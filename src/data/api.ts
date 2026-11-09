/** Client side of the local file API (see server/localFsApi.ts). */
import { FS_CHANGE_EVENT, type DataDir, type FileEntry, type FilesResponse, type FsChange } from "../core/files";

export async function fetchDir(dir: DataDir): Promise<FileEntry[]> {
  const res = await fetch(`/api/files?dir=${dir}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read the ${dir}/ folder (HTTP ${res.status}). Is the tool running via "npm start"?`);
  return ((await res.json()) as FilesResponse).files;
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
