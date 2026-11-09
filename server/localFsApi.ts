/**
 * Vite plugin: the local file API. This is the only code that touches the disk.
 *
 *   GET /api/files?dir=data|catalogue|layouts   -> all JSON files in that folder (recursive) as { path, text, mtime }
 *   HMR event "fs:change" { dir, path, event }  -> pushed when a file in one of these folders changes
 *
 * Static assets (GLB models, textures, the floor-plan underlay) are served by Vite itself from the repository root.
 * The server listens on 127.0.0.1 only; requests from other hosts are rejected.
 */
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { DATA_DIRS, FS_CHANGE_EVENT, isDataDir, type DataDir, type FileEntry, type FsChange } from "../src/core/files.ts";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ASSET_RE = /\.(json|glb|gltf|bin|png|jpe?g|webp|ktx2)$/i;

/** Repository-relative POSIX path, or null if `abs` is not inside one of the data folders. */
export function toDataPath(root: string, abs: string): { dir: DataDir; path: string } | null {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const dir = rel.split("/")[0];
  if (!isDataDir(dir)) return null;
  if (rel.split("/").some((seg) => seg.startsWith("."))) return null; // .trash, editor temp files
  return { dir, path: rel };
}

/** All JSON files below `<root>/<dir>`, skipping dot-folders. Unreadable or too large files carry `error`. */
export async function listJsonFiles(root: string, dir: DataDir): Promise<FileEntry[]> {
  const base = path.join(root, dir);
  const out: FileEntry[] = [];
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
      if (e.isDirectory()) await walk(child);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) {
        const rel = path.relative(root, child).split(path.sep).join("/");
        try {
          const st = await fs.stat(child);
          if (st.size > MAX_FILE_BYTES) {
            out.push({ path: rel, mtime: st.mtimeMs, error: `file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` });
            continue;
          }
          out.push({ path: rel, text: await fs.readFile(child, "utf8"), mtime: st.mtimeMs });
        } catch (err) {
          out.push({ path: rel, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }
  await walk(base);
  return out;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Only accept requests from this machine, addressed to a local host name (guards against DNS rebinding). */
export function isLocalRequest(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  const remote = req.socket.remoteAddress ?? "";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  return loopback && LOCAL_HOSTS.has(host);
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
        if (!req.url?.startsWith("/api/")) return next();
        if (!isLocalRequest(req)) return sendJson(res, 403, { error: "local requests only" });
        const url = new URL(req.url, "http://localhost");
        try {
          if (req.method === "GET" && url.pathname === "/api/files") {
            const dir = url.searchParams.get("dir");
            if (!isDataDir(dir)) return sendJson(res, 400, { error: `dir must be one of ${DATA_DIRS.join(", ")}` });
            return sendJson(res, 200, { dir, files: await listJsonFiles(root, dir) });
          }
          return sendJson(res, 404, { error: `unknown endpoint ${req.method} ${url.pathname}` });
        } catch (err) {
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      server.watcher.add(DATA_DIRS.map((d) => path.join(root, d)));
      const notify = (event: FsChange["event"]) => (abs: string) => {
        const hit = toDataPath(root, abs);
        if (!hit || !ASSET_RE.test(hit.path)) return;
        const data: FsChange = { ...hit, event };
        server.ws.send({ type: "custom", event: FS_CHANGE_EVENT, data });
      };
      server.watcher.on("add", notify("add"));
      server.watcher.on("change", notify("change"));
      server.watcher.on("unlink", notify("unlink"));
    },
  };
}
