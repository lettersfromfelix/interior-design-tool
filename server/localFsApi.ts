/**
 * Vite plugin: the local file API. This is the only code that touches the disk.
 *
 *   GET  /api/files?dir=data|catalogue|layouts -> { dir, files: [{ path, text, mtime }], assets: [{ path, size, mtime }] }
 *                                                 (all JSON files in the folder, recursive, plus models/images)
 *   PUT  /api/layouts/<name>.json              -> write a layout atomically (temp file + rename), max 1 MB; with the
 *                                                 x-layout-base header only if the file on disk is the version the
 *                                                 app based its change on (409 otherwise)
 *   DELETE /api/layouts/<name>.json            -> move a layout to layouts/.trash/ (same x-layout-base check)
 *   GET  /vendor/draco/*, /vendor/basis/*      -> the Draco and KTX2 decoders shipped with three.js (for GLB models)
 *   HMR event "fs:change" { dir, path, event } -> pushed when a file in one of the data folders changes
 *
 * Static assets (GLB models, textures, the floor-plan underlay) are served by Vite itself from the repository root.
 * The server listens on 127.0.0.1 only; requests from other hosts are rejected, and writes must come from the app's
 * own origin. Only layouts/*.json can be written.
 */
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import {
  contentTag,
  DATA_DIRS,
  FS_CHANGE_EVENT,
  isDataDir,
  isLayoutName,
  LAYOUT_BASE_HEADER,
  type AssetEntry,
  type DataDir,
  type FileEntry,
  type FsChange,
  type TrashResponse,
  type WriteResponse,
} from "../src/core/files.ts";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_LAYOUT_BYTES = 1024 * 1024;
const WATCHED_RE = /\.(json|glb|gltf|bin|png|jpe?g|webp|ktx2)$/i;
const ASSET_RE = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2)$/i;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Repository-relative POSIX path, or null if `abs` is not inside one of the data folders. */
export function toDataPath(root: string, abs: string): { dir: DataDir; path: string } | null {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const dir = rel.split("/")[0];
  if (!isDataDir(dir)) return null;
  if (rel.split("/").some((seg) => seg.startsWith("."))) return null; // .trash, temp files of atomic writes, editor files
  return { dir, path: rel };
}

/**
 * All JSON files below `<root>/<dir>` (with their text) and all model/image files (without content), skipping
 * dot-folders. Unreadable or too large JSON files carry `error`.
 */
export async function listDir(root: string, dir: DataDir): Promise<{ files: FileEntry[]; assets: AssetEntry[] }> {
  const files: FileEntry[] = [];
  const assets: AssetEntry[] = [];
  async function walk(abs: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return; // folder does not exist (yet)
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, child).split(path.sep).join("/");
      try {
        const st = await fs.stat(child);
        if (e.name.toLowerCase().endsWith(".json")) {
          if (st.size > MAX_FILE_BYTES) {
            files.push({ path: rel, mtime: st.mtimeMs, error: `file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` });
          } else {
            files.push({ path: rel, text: await fs.readFile(child, "utf8"), mtime: st.mtimeMs });
          }
        } else if (ASSET_RE.test(e.name)) {
          assets.push({ path: rel, size: st.size, mtime: st.mtimeMs });
        }
      } catch (err) {
        if (e.name.toLowerCase().endsWith(".json")) files.push({ path: rel, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  await walk(path.join(root, dir));
  return { files, assets };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Only accept requests from this machine, addressed to a local host name (guards against DNS rebinding). */
export function isLocalRequest(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  const remote = req.socket.remoteAddress ?? "";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  return loopback && LOCAL_HOSTS.has(host);
}

/** Writes must come from the app itself: browsers send an Origin header, and it has to be this server. */
export function isSameOrigin(req: Pick<IncomingMessage, "headers">): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // not a cross-origin browser request (e.g. curl on this machine)
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      // Windows: the target may be open for a moment (editor, virus scanner, file watcher)
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")) throw err;
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

/** Pending writes per file. */
const writeQueues = new Map<string, Promise<void>>();

/** Run `fn` after all earlier writes to the same file have finished, so that concurrent saves land in order. */
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const result = (writeQueues.get(key) ?? Promise.resolve()).then(fn);
  const done = result.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(key, done);
  void done.then(() => {
    if (writeQueues.get(key) === done) writeQueues.delete(key);
  });
  return result;
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * Write `layouts/<name>` atomically (temp file in the same folder, then rename over the target). With `base` (the
 * contentTag()s of the versions the new text is based on), only write if the file on disk is one of them.
 */
export async function writeLayout(root: string, name: string, text: string, base?: readonly string[]): Promise<WriteResponse> {
  if (!isLayoutName(name)) throw new HttpError(400, `invalid layout file name "${name}"`);
  if (Buffer.byteLength(text, "utf8") > MAX_LAYOUT_BYTES) throw new HttpError(413, "layout is larger than 1 MB");
  try {
    JSON.parse(text);
  } catch {
    throw new HttpError(400, "the layout is not valid JSON");
  }
  const dir = path.join(root, "layouts");
  const target = path.join(dir, name);
  // file names are case-insensitive on Windows
  return serialized(target.toLowerCase(), async () => {
    if (base && !base.includes(contentTag(await readIfExists(target)))) {
      throw new HttpError(409, `layouts/${name} was changed on disk since the app read it`);
    }
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, text, "utf8");
    try {
      await renameWithRetry(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    const st = await fs.stat(target);
    return { path: `layouts/${name}`, mtime: st.mtimeMs };
  });
}

/**
 * "Delete" `layouts/<name>`: move it to layouts/.trash/ (git-ignored, never cleaned up by the app), so nothing is
 * lost for good. With `base`, only if the file on disk is one of those versions (409 otherwise).
 */
export async function trashLayout(root: string, name: string, base?: readonly string[]): Promise<TrashResponse> {
  if (!isLayoutName(name)) throw new HttpError(400, `invalid layout file name "${name}"`);
  const dir = path.join(root, "layouts");
  const target = path.join(dir, name);
  return serialized(target.toLowerCase(), async () => {
    const text = await readIfExists(target);
    if (text === undefined) throw new HttpError(404, `layouts/${name} does not exist`);
    if (base && !base.includes(contentTag(text))) throw new HttpError(409, `layouts/${name} was changed on disk since the app read it`);
    const trash = path.join(dir, ".trash");
    await fs.mkdir(trash, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(trash, `${name.slice(0, -".json".length)}.${stamp}.json`);
    await renameWithRetry(target, dest);
    return { path: `layouts/${name}`, trashed: `layouts/.trash/${path.basename(dest)}` };
  });
}

/** The LAYOUT_BASE_HEADER of a request as a list of tags (undefined if it has none). */
export function baseTags(req: Pick<IncomingMessage, "headers">): string[] | undefined {
  const value = req.headers[LAYOUT_BASE_HEADER];
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value.join(",") : value)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c); // keep draining an oversized body so the 413 can still be sent
    });
    req.on("end", () => (size > limit ? reject(new HttpError(413, "layout is larger than 1 MB")) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

/** three.js decoders for compressed GLB models, served from node_modules (no CDN, works offline). */
const VENDOR: Record<string, string> = {
  draco: "node_modules/three/examples/jsm/libs/draco",
  basis: "node_modules/three/examples/jsm/libs/basis",
};
const VENDOR_FILE_RE = /^[a-z0-9_.-]+\.(js|wasm)$/i;

/** Absolute path of a vendor file, or null if it is not one of the decoder files. */
export function vendorFile(root: string, urlPath: string): string | null {
  const m = /^\/vendor\/([a-z]+)\/([^/]+)$/.exec(urlPath);
  if (!m || !VENDOR[m[1]] || !VENDOR_FILE_RE.test(m[2]) || m[2].includes("..")) return null;
  return path.join(root, VENDOR[m[1]], m[2]);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function localFsApi(): Plugin {
  let root = process.cwd();
  return {
    name: "local-fs-api",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const isApi = req.url?.startsWith("/api/");
        const isVendor = req.url?.startsWith("/vendor/");
        if (!isApi && !isVendor) return next();
        if (!isLocalRequest(req)) return sendJson(res, 403, { error: "local requests only" });
        const url = new URL(req.url!, "http://localhost");
        try {
          if (isVendor) {
            const file = req.method === "GET" ? vendorFile(root, url.pathname) : null;
            if (!file) return sendJson(res, 404, { error: "not found" });
            const body = await fs.readFile(file).catch(() => null);
            if (!body) return sendJson(res, 404, { error: "not found" });
            res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8");
            res.setHeader("Cache-Control", "max-age=3600");
            return res.end(body);
          }
          if (req.method === "GET" && url.pathname === "/api/files") {
            const dir = url.searchParams.get("dir");
            if (!isDataDir(dir)) return sendJson(res, 400, { error: `dir must be one of ${DATA_DIRS.join(", ")}` });
            return sendJson(res, 200, { dir, ...(await listDir(root, dir)) });
          }
          const layout = /^\/api\/layouts\/([^/]+)$/.exec(url.pathname);
          if (req.method === "PUT" && layout) {
            if (!isSameOrigin(req)) return sendJson(res, 403, { error: "writes are only accepted from the app itself" });
            const text = await readBody(req, MAX_LAYOUT_BYTES);
            return sendJson(res, 200, await writeLayout(root, decodeURIComponent(layout[1]), text, baseTags(req)));
          }
          if (req.method === "DELETE" && layout) {
            if (!isSameOrigin(req)) return sendJson(res, 403, { error: "writes are only accepted from the app itself" });
            return sendJson(res, 200, await trashLayout(root, decodeURIComponent(layout[1]), baseTags(req)));
          }
          return sendJson(res, 404, { error: `unknown endpoint ${req.method} ${url.pathname}` });
        } catch (err) {
          if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      server.watcher.add(DATA_DIRS.map((d) => path.join(root, d)));
      const notify = (event: FsChange["event"]) => (abs: string) => {
        const hit = toDataPath(root, abs);
        if (!hit || !WATCHED_RE.test(hit.path)) return;
        const data: FsChange = { ...hit, event };
        server.ws.send({ type: "custom", event: FS_CHANGE_EVENT, data });
      };
      server.watcher.on("add", notify("add"));
      server.watcher.on("change", notify("change"));
      server.watcher.on("unlink", notify("unlink"));
    },
  };
}
