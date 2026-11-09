import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { contentTag } from "../src/core/files";
import { baseTags, isLocalRequest, isSameOrigin, listDir, MAX_LAYOUT_BYTES, toDataPath, vendorFile, writeLayout } from "./localFsApi";

describe("local file API", () => {
  const root = mkdtempSync(path.join(tmpdir(), "idt-"));
  mkdirSync(path.join(root, "catalogue", "stool"), { recursive: true });
  mkdirSync(path.join(root, "layouts", ".trash"), { recursive: true });
  writeFileSync(path.join(root, "catalogue", "sofa.json"), '{"id":"sofa"}');
  writeFileSync(path.join(root, "catalogue", "stool", "item.json"), '{"id":"stool"}');
  writeFileSync(path.join(root, "catalogue", "stool", "model.glb"), "glb");
  writeFileSync(path.join(root, "catalogue", "stool", "notes.txt"), "not an asset");
  writeFileSync(path.join(root, "layouts", ".trash", "old.json"), "{}");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("lists JSON files recursively with forward-slash paths, and model/image files separately", async () => {
    const { files, assets } = await listDir(root, "catalogue");
    expect(files.map((f) => f.path)).toEqual(["catalogue/sofa.json", "catalogue/stool/item.json"]);
    expect(files[0].text).toBe('{"id":"sofa"}');
    expect(files[0].mtime).toBeGreaterThan(0);
    expect(assets).toEqual([{ path: "catalogue/stool/model.glb", size: 3, mtime: expect.any(Number) }]);
  });

  it("skips dot-folders and missing folders", async () => {
    expect(await listDir(root, "layouts")).toEqual({ files: [], assets: [] });
    expect(await listDir(root, "data")).toEqual({ files: [], assets: [] });
  });

  it("maps absolute paths into data folders only", () => {
    expect(toDataPath(root, path.join(root, "catalogue", "stool", "model.glb"))).toEqual({
      dir: "catalogue",
      path: "catalogue/stool/model.glb",
    });
    expect(toDataPath(root, path.join(root, "src", "main.tsx"))).toBeNull();
    expect(toDataPath(root, path.join(root, "layouts", ".trash", "old.json"))).toBeNull();
    expect(toDataPath(root, path.join(root, "layouts", ".default.json.123.tmp"))).toBeNull();
    expect(toDataPath(root, path.join(root, "..", "catalogue", "x.json"))).toBeNull();
  });

  it("accepts only loopback requests addressed to localhost", () => {
    const req = (remoteAddress: string, host: string) =>
      ({ socket: { remoteAddress }, headers: { host } }) as unknown as Parameters<typeof isLocalRequest>[0];
    expect(isLocalRequest(req("127.0.0.1", "127.0.0.1:5173"))).toBe(true);
    expect(isLocalRequest(req("::1", "localhost:5173"))).toBe(true);
    expect(isLocalRequest(req("192.168.1.5", "127.0.0.1:5173"))).toBe(false);
    expect(isLocalRequest(req("127.0.0.1", "evil.example.com"))).toBe(false);
  });

  it("accepts writes only from the app's own origin", () => {
    const req = (origin: string | undefined) => ({ headers: { host: "127.0.0.1:5180", origin } });
    expect(isSameOrigin(req("http://127.0.0.1:5180"))).toBe(true);
    expect(isSameOrigin(req(undefined))).toBe(true);
    expect(isSameOrigin(req("http://127.0.0.1:3000"))).toBe(false);
    expect(isSameOrigin(req("https://evil.example.com"))).toBe(false);
    expect(isSameOrigin(req("null"))).toBe(false);
  });

  it("writes layouts atomically and leaves no temp files", async () => {
    const res = await writeLayout(root, "default.json", '{"name":"a"}');
    expect(res.path).toBe("layouts/default.json");
    await writeLayout(root, "default.json", '{"name":"b"}');
    expect(readFileSync(path.join(root, "layouts", "default.json"), "utf8")).toBe('{"name":"b"}');
    expect(readdirSync(path.join(root, "layouts")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects bad names, oversized bodies and invalid JSON", async () => {
    for (const name of ["../x.json", "a/b.json", "x.txt", ".hidden.json", "..json", ""]) {
      await expect(writeLayout(root, name, "{}")).rejects.toMatchObject({ status: 400 });
    }
    await expect(writeLayout(root, "big.json", `"${"x".repeat(MAX_LAYOUT_BYTES)}"`)).rejects.toMatchObject({ status: 413 });
    await expect(writeLayout(root, "bad.json", "{")).rejects.toMatchObject({ status: 400 });
    expect(existsSync(path.join(root, "x.json"))).toBe(false);
  });

  it("writes only over the version a change is based on, and answers 409 otherwise", async () => {
    const file = path.join(root, "layouts", "cond.json");
    await writeLayout(root, "cond.json", '{"v":1}', [contentTag(undefined)]); // create: must not exist yet
    await expect(writeLayout(root, "cond.json", '{"v":9}', [contentTag(undefined)])).rejects.toMatchObject({ status: 409 });
    await writeLayout(root, "cond.json", '{"v":2}', [contentTag('{"v":1}')]);
    writeFileSync(file, '{"v":"edited outside the app"}');
    await expect(writeLayout(root, "cond.json", '{"v":3}', [contentTag('{"v":2}')])).rejects.toMatchObject({ status: 409 });
    expect(readFileSync(file, "utf8")).toBe('{"v":"edited outside the app"}');
    await writeLayout(root, "cond.json", '{"v":4}', [contentTag('{"v":2}'), contentTag('{"v":"edited outside the app"}')]);
    expect(readFileSync(file, "utf8")).toBe('{"v":4}');
    await writeLayout(root, "cond.json", '{"v":5}'); // no base: unconditional
    expect(readFileSync(file, "utf8")).toBe('{"v":5}');
  });

  it("applies concurrent writes to one file in the order they arrive", async () => {
    const first = writeLayout(root, "queue.json", '{"v":1}', [contentTag(undefined)]);
    const second = writeLayout(root, "queue.json", '{"v":2}', [contentTag('{"v":1}')]);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(readFileSync(path.join(root, "layouts", "queue.json"), "utf8")).toBe('{"v":2}');
  });

  it("reads the base versions from the request header", () => {
    expect(baseTags({ headers: {} })).toBeUndefined();
    expect(baseTags({ headers: { "x-layout-base": "none, 5-0a1b2c3d" } })).toEqual(["none", "5-0a1b2c3d"]);
  });

  it("serves only the three.js decoder files", () => {
    expect(vendorFile(root, "/vendor/draco/draco_decoder.wasm")).toBe(
      path.join(root, "node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm"),
    );
    expect(vendorFile(root, "/vendor/basis/basis_transcoder.js")).not.toBeNull();
    expect(vendorFile(root, "/vendor/draco/../../package.json")).toBeNull();
    expect(vendorFile(root, "/vendor/other/x.js")).toBeNull();
    expect(vendorFile(root, "/vendor/draco/README.md")).toBeNull();
  });
});
