import { describe, expect, it, vi } from "vitest";
import type { FilesResponse, FsChange } from "../core/files";
import { emptyLayout } from "../core/layout/commands";
import { serializeLayout } from "../core/layout/serialize";
import { createAppStore } from "../state/store";
import { LayoutConflictError } from "./fileBackend";
import { LayoutImportError, LayoutManager } from "./layouts";
import { LayoutSync } from "./layoutSync";
import { Repository } from "./repository";
import { browserStorage, LAYOUTS_KEY, siteBackend } from "./siteBackend";

const layoutText = (name: string, items = 0) =>
  serializeLayout({
    ...emptyLayout(name),
    items: Array.from({ length: items }, (_, i) => ({ uid: `chair-${i + 1}`, item: "chair", position: [i * 50, 0] as [number, number], rotation: 0 })),
  });
const DEMO = layoutText("Demo", 2);
const DEFAULT = layoutText("Default");

/** The website: the build's listings, a localStorage and the window that other tabs' "storage" events arrive at. */
function website(layouts: Record<string, string> = { "layouts/default.json": DEFAULT, "layouts/demo.json": DEMO }) {
  const listings: Record<string, FilesResponse> = {
    "/site/files/data.json": { dir: "data", files: [], assets: [] },
    "/site/files/catalogue.json": { dir: "catalogue", files: [], assets: [{ path: "catalogue/stool/model.glb", size: 10, mtime: 7 }] },
    "/site/files/layouts.json": { dir: "layouts", files: Object.entries(layouts).map(([path, text]) => ({ path, text })), assets: [] },
  };
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    const body = listings[String(url)];
    return body ? new Response(JSON.stringify(body)) : new Response("{}", { status: 404 });
  });
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: vi.fn((k: string, v: string) => void memory.set(k, v)) };
  const events = new EventTarget();
  const files = siteBackend("/site/", storage, { fetch: fetch as typeof globalThis.fetch, events });
  const kept = () => JSON.parse(memory.get(LAYOUTS_KEY) ?? "{}") as Record<string, { text: string }>;
  return { files, fetch, memory, storage, events, kept };
}

const origins = async (files: ReturnType<typeof website>["files"]) =>
  Object.fromEntries((await files.fetchDir("layouts")).files.map((f) => [f.path, f.origin]));

describe("the website's file backend", () => {
  it("reads the folders from the listings made at build time, each once", async () => {
    const { files, fetch } = website();
    expect((await files.fetchDir("catalogue")).assets.map((a) => a.path)).toEqual(["catalogue/stool/model.glb"]);
    await files.fetchDir("catalogue");
    await files.fetchDir("data");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(["/site/files/catalogue.json", "/site/files/data.json"]);
    expect(await origins(files)).toEqual({ "layouts/default.json": "site", "layouts/demo.json": "site" });
  });

  it("keeps changes in the browser: a changed copy of a published layout, and layouts made here", async () => {
    const { files, kept } = website();
    await files.fetchDir("layouts");
    const changed = layoutText("Demo", 3);
    await files.putLayout("demo.json", changed, { base: [DEMO] });
    await files.putLayout("variant-b.json", layoutText("Variant B"), { base: [undefined] });
    expect(Object.keys(kept())).toEqual(["layouts/demo.json", "layouts/variant-b.json"]);
    const listing = await files.fetchDir("layouts");
    expect(listing.files.map((f) => [f.path, f.origin])).toEqual([
      ["layouts/default.json", "site"],
      ["layouts/demo.json", "changed"],
      ["layouts/variant-b.json", "browser"],
    ]);
    expect(listing.files[1].text).toBe(changed);
  });

  it("never writes over a version it didn't read (e.g. a change made in another tab)", async () => {
    const { files } = website();
    await files.fetchDir("layouts");
    await files.putLayout("demo.json", layoutText("Demo", 3), { base: [DEMO] });
    await expect(files.putLayout("demo.json", layoutText("Demo", 4), { base: [DEMO] })).rejects.toBeInstanceOf(LayoutConflictError);
    await expect(files.putLayout("default.json", layoutText("New"), { base: [undefined] })).rejects.toBeInstanceOf(LayoutConflictError);
    await expect(files.trashLayout("demo.json", [DEMO])).rejects.toBeInstanceOf(LayoutConflictError);
  });

  it("writes at once, without waiting, so a closing page still keeps its last change", async () => {
    const { files, kept } = website();
    await files.fetchDir("layouts");
    void files.putLayout("demo.json", layoutText("Demo", 5), { base: [DEMO], keepalive: true });
    expect(kept()["layouts/demo.json"].text).toBe(layoutText("Demo", 5));
  });

  it("deletes layouts made here and resets published ones to their published version", async () => {
    const { files } = website();
    await files.fetchDir("layouts");
    const changed = layoutText("Demo", 3);
    await files.putLayout("demo.json", changed, { base: [DEMO] });
    await files.putLayout("mine.json", layoutText("Mine"), { base: [undefined] });
    await files.trashLayout("mine.json", [layoutText("Mine")]);
    await files.trashLayout("demo.json", [changed]);
    const listing = await files.fetchDir("layouts");
    expect(listing.files.map((f) => [f.path, f.origin])).toEqual([
      ["layouts/default.json", "site"],
      ["layouts/demo.json", "site"],
    ]);
    expect(listing.files[1].text).toBe(DEMO);
    await expect(files.trashLayout("demo.json", [DEMO])).rejects.toThrow(/comes with the website/);
    await expect(files.trashLayout("nothing.json")).rejects.toThrow(/does not exist/);
  });

  it("refuses what isn't a layout file, and says when the browser can't keep anything", async () => {
    const { files, storage } = website();
    await expect(files.putLayout("../evil.json", "{}")).rejects.toThrow(/invalid layout file name/);
    await expect(files.putLayout("x.json", "{")).rejects.toThrow(/not valid JSON/);
    await expect(files.putLayout("x.json", `"${"x".repeat(1024 * 1024)}"`)).rejects.toThrow(/larger than 1 MB/);
    storage.setItem.mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await expect(files.putLayout("x.json", layoutText("X"))).rejects.toThrow(/Use Save to download the layout/);
  });

  it("ignores unreadable stored data", async () => {
    const { files, memory } = website();
    memory.set(LAYOUTS_KEY, "not json");
    expect(await origins(files)).toEqual({ "layouts/default.json": "site", "layouts/demo.json": "site" });
    memory.set(LAYOUTS_KEY, JSON.stringify({ "layouts/a.json": { text: 5 }, "../b.json": { text: "{}" } }));
    expect(await origins(files)).toEqual({ "layouts/default.json": "site", "layouts/demo.json": "site" });
  });

  it("keeps layouts in memory, and says so, where the browser has no storage or blocks it", async () => {
    const { storage, durable } = browserStorage(); // there is no window in the tests
    expect(durable).toBe(false);
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
    expect(siteBackend("/site/", storage, { durable }).durable).toBe(false);
    expect(website().files.durable).toBe(true);
  });

  it("reports its own writes and other tabs' changes", async () => {
    const { files, events } = website();
    await files.fetchDir("layouts");
    const seen: FsChange[] = [];
    const stop = files.onFsChange((c) => seen.push(c));
    await files.putLayout("mine.json", layoutText("Mine"), { base: [undefined] });
    await Promise.resolve();
    events.dispatchEvent(Object.assign(new Event("storage"), { key: LAYOUTS_KEY }));
    events.dispatchEvent(Object.assign(new Event("storage"), { key: "something-else" }));
    expect(seen).toEqual([
      { dir: "layouts", path: "layouts/mine.json", event: "add" },
      { dir: "layouts", path: "layouts", event: "change" },
    ]);
    stop();
    events.dispatchEvent(Object.assign(new Event("storage"), { key: LAYOUTS_KEY }));
    expect(seen).toHaveLength(2);
  });
});

describe("layouts on the website", () => {
  async function app() {
    const site = website();
    const store = createAppStore(false);
    const repo = new Repository(store, site.files);
    const sync = new LayoutSync(store, { files: site.files, onConflict: () => void repo.reload("layouts") });
    const manager = new LayoutManager(store, sync, repo, site.files);
    await repo.start();
    return { ...site, store, repo, sync, manager };
  }

  it("opens a layout file as a new layout, kept in the browser", async () => {
    const { store, manager, kept } = await app();
    const file = await manager.importFile("Demo.json", layoutText("Shared", 1));
    expect(file).toBe("layouts/demo-2.json");
    expect(store.getState().layout).toMatchObject({ file, status: "ready" });
    expect(store.getState().layout.doc.name).toBe("Shared");
    expect(kept()[file].text).toBe(layoutText("Shared", 1));
    expect(store.getState().layouts.find((l) => l.file === file)?.origin).toBe("browser");
  });

  it("refuses an invalid file with its problems and keeps the open layout", async () => {
    const { store, manager, kept } = await app();
    const error = await manager.importFile("broken.json", JSON.stringify({ schemaVersion: 1, name: 5, items: [] })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LayoutImportError);
    expect((error as LayoutImportError).issues.map((i) => i.path)).toContain("name");
    await expect(manager.importFile("notes.json", "hello")).rejects.toThrow("notes.json is not a valid layout file, so it was not opened.");
    expect(store.getState().layout.file).toBe("layouts/default.json");
    expect(kept()).toEqual({});
  });

  it("resets a published layout; undo brings the change back", async () => {
    const { store, sync, manager, kept } = await app();
    await manager.open("layouts/demo.json");
    store.getState().edit((d) => ({ ...d, items: d.items.slice(1) }));
    await sync.flush();
    expect(kept()["layouts/demo.json"]).toBeDefined();
    await manager.reset("layouts/demo.json");
    expect(kept()["layouts/demo.json"]).toBeUndefined();
    expect(store.getState().layout.doc.items).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().layout.doc.items).toHaveLength(1);
  });
});
