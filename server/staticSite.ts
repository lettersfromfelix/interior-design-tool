/**
 * Vite plugin for the website build (`npm run build`), the static counterpart of the local file API:
 *
 *   files/<dir>.json            -> what GET /api/files?dir=<dir> returns, made at build time (data, catalogue, layouts)
 *   <models and textures>       -> the asset files of those folders, under their repository paths
 *   vendor/draco/, vendor/basis/ -> the decoders for compressed GLB models
 *
 * The website reads these instead of a server (see src/data/siteBackend.ts). It shows what was in the folders when it
 * was built: new furniture appears after the next build. Never published, even if present locally: data/underlay/
 * (the floor-plan image is made from the private plan).
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { DATA_DIRS, type DataDir, type FilesResponse } from "../src/core/files.ts";
import { listDir, VENDOR, VENDOR_FILE_RE } from "./localFsApi.ts";

/** Repository paths that never go on the website. */
export const UNPUBLISHED = /^data\/underlay\//i;

/** A number that changes with the file's content (the website versions model URLs with it instead of a date). */
export const contentVersion = (bytes: Uint8Array): number => parseInt(createHash("sha256").update(bytes).digest("hex").slice(0, 12), 16);

/** The listing of one data folder as the website gets it: everything except UNPUBLISHED, assets versioned by content. */
export async function siteListing(root: string, dir: DataDir): Promise<FilesResponse> {
  const { files, assets } = await listDir(root, dir);
  const published = assets.filter((a) => !UNPUBLISHED.test(a.path));
  return {
    dir,
    files: files.filter((f) => !UNPUBLISHED.test(f.path)).map(({ path, text, error }) => ({ path, text, error })),
    assets: await Promise.all(
      published.map(async (a) => ({ path: a.path, size: a.size, mtime: contentVersion(await fs.readFile(path.join(root, a.path))) })),
    ),
  };
}

/** The decoder files the website needs, as [url path, absolute file]. */
export async function vendorFiles(root: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const [name, folder] of Object.entries(VENDOR)) {
    for (const f of (await fs.readdir(path.join(root, folder))).sort()) {
      if (VENDOR_FILE_RE.test(f)) out.push([`vendor/${name}/${f}`, path.join(root, folder, f)]);
    }
  }
  return out;
}

export function staticSite(): Plugin {
  let root = process.cwd();
  return {
    name: "static-site",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async generateBundle() {
      for (const dir of DATA_DIRS) {
        const listing = await siteListing(root, dir);
        this.emitFile({ type: "asset", fileName: `files/${dir}.json`, source: JSON.stringify(listing) });
        for (const a of listing.assets) this.emitFile({ type: "asset", fileName: a.path, source: await fs.readFile(path.join(root, a.path)) });
      }
      for (const [url, file] of await vendorFiles(root)) this.emitFile({ type: "asset", fileName: url, source: await fs.readFile(file) });
    },
  };
}
