import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isLocalRequest, listJsonFiles, toDataPath } from "./localFsApi";

describe("local file API", () => {
  const root = mkdtempSync(path.join(tmpdir(), "idt-"));
  mkdirSync(path.join(root, "catalogue", "stool"), { recursive: true });
  mkdirSync(path.join(root, "layouts", ".trash"), { recursive: true });
  writeFileSync(path.join(root, "catalogue", "sofa.json"), '{"id":"sofa"}');
  writeFileSync(path.join(root, "catalogue", "stool", "item.json"), '{"id":"stool"}');
  writeFileSync(path.join(root, "catalogue", "stool", "model.glb"), "glb");
  writeFileSync(path.join(root, "layouts", ".trash", "old.json"), "{}");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("lists JSON files recursively with forward-slash paths", async () => {
    const files = await listJsonFiles(root, "catalogue");
    expect(files.map((f) => f.path)).toEqual(["catalogue/sofa.json", "catalogue/stool/item.json"]);
    expect(files[0].text).toBe('{"id":"sofa"}');
    expect(files[0].mtime).toBeGreaterThan(0);
  });

  it("skips dot-folders and missing folders", async () => {
    expect(await listJsonFiles(root, "layouts")).toEqual([]);
    expect(await listJsonFiles(root, "data")).toEqual([]);
  });

  it("maps absolute paths into data folders only", () => {
    expect(toDataPath(root, path.join(root, "catalogue", "stool", "model.glb"))).toEqual({
      dir: "catalogue",
      path: "catalogue/stool/model.glb",
    });
    expect(toDataPath(root, path.join(root, "src", "main.tsx"))).toBeNull();
    expect(toDataPath(root, path.join(root, "layouts", ".trash", "old.json"))).toBeNull();
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
});
