import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentTag, LAYOUT_BASE_HEADER } from "../core/files";
import { addItem, emptyLayout } from "../core/layout/commands";
import { createAppStore } from "../state/store";
import { LayoutSync } from "./layoutSync";

interface Put {
  body: string;
  base: string[];
  keepalive: boolean;
  respond(status: number): void;
}

/** A fake file API: every PUT waits until the test answers it. */
function fakeServer() {
  const puts: Put[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        const headers = init.headers as Record<string, string>;
        puts.push({
          body: init.body as string,
          base: headers[LAYOUT_BASE_HEADER]?.split(", ") ?? [],
          keepalive: !!init.keepalive,
          respond: (status) =>
            resolve(new Response(JSON.stringify(status === 200 ? { path: "layouts/default.json", mtime: 1 } : { error: "changed" }), { status })),
        });
      }),
  );
  return { puts, fetch };
}

function setup() {
  const store = createAppStore(false);
  store.getState().loadLayout(emptyLayout(), undefined); // no file on disk yet
  const onConflict = vi.fn();
  const sync = new LayoutSync(store, { onConflict });
  const place = (uid: string) => store.getState().edit((d) => addItem(d, { uid, item: "chair", position: [0, 0], rotation: 0 }));
  return { store, sync, onConflict, place };
}

describe("LayoutSync", () => {
  let server: ReturnType<typeof fakeServer>;
  beforeEach(() => {
    vi.useFakeTimers();
    server = fakeServer();
    vi.stubGlobal("fetch", server.fetch);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("bases every save on the version last read from or written to disk", async () => {
    const { store, sync, place } = setup();
    place("chair-1");
    let saving = sync.flush();
    expect(server.puts[0].base).toEqual([contentTag(undefined)]);
    server.puts[0].respond(200);
    await saving;
    expect(store.getState().layout.diskText).toBe(server.puts[0].body);

    place("chair-2");
    saving = sync.flush();
    expect(server.puts[1].base).toEqual([contentTag(server.puts[0].body)]);
    server.puts[1].respond(200);
    await saving;
    const { layout } = store.getState();
    expect(layout.savedRevision).toBe(layout.revision);
  });

  it("reloads instead of retrying when the file was changed on disk", async () => {
    const { store, sync, onConflict, place } = setup();
    place("chair-1");
    const saving = sync.flush();
    server.puts[0].respond(409);
    await saving;
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(store.getState().layout.saveError).toBeUndefined();
    expect(store.getState().layout.pendingText).toBeUndefined();
    vi.advanceTimersByTime(10_000);
    expect(server.puts).toHaveLength(1);
  });

  it("retries other failures and shows the error", async () => {
    const { store, sync, place } = setup();
    place("chair-1");
    const saving = sync.flush();
    server.puts[0].respond(500);
    await saving;
    expect(store.getState().layout.saveError).toBe("changed");
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.puts).toHaveLength(2);
  });

  it("keeps a version that was reloaded from disk while a save was in flight", async () => {
    const { store, sync, place } = setup();
    place("chair-1");
    const saving = sync.flush();
    const external = JSON.stringify({ ...emptyLayout(), name: "edited by GHCP" });
    store.getState().loadLayout({ ...emptyLayout(), name: "edited by GHCP" }, external);
    server.puts[0].respond(200);
    await saving;
    expect(store.getState().layout.diskText).toBe(external);
    expect(store.getState().layout.doc.name).toBe("edited by GHCP");
  });

  it("on closing the page during a save, sends the newer changes based on either version", async () => {
    const { sync, place } = setup();
    place("chair-1");
    const saving = sync.flush();
    place("chair-2");
    sync.flushOnExit();
    expect(server.puts).toHaveLength(2);
    expect(server.puts[1].keepalive).toBe(true);
    expect(server.puts[1].base).toEqual([contentTag(undefined), contentTag(server.puts[0].body)]);
    expect(server.puts[1].body).toContain("chair-2");
    server.puts[0].respond(200);
    await saving;
  });

  it("on closing the page sends nothing if everything is saved or already on its way", async () => {
    const { sync, place } = setup();
    sync.flushOnExit();
    expect(server.puts).toHaveLength(0);
    place("chair-1");
    const saving = sync.flush();
    sync.flushOnExit();
    expect(server.puts).toHaveLength(1);
    server.puts[0].respond(200);
    await saving;
    sync.flushOnExit();
    expect(server.puts).toHaveLength(1);
  });

  it("on closing the page sends nothing if the file was reloaded while a save was in flight", async () => {
    const { store, sync, place } = setup();
    place("chair-1");
    const saving = sync.flush();
    store.getState().loadLayout({ ...emptyLayout(), name: "edited by GHCP" }, JSON.stringify({ name: "edited by GHCP" }));
    sync.flushOnExit();
    expect(server.puts).toHaveLength(1);
    server.puts[0].respond(409);
    await saving;
  });
});
