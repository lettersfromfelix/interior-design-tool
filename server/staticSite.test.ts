import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { contentVersion, siteListing, vendorFiles } from "./staticSite";

const root = mkdtempSync(path.join(tmpdir(), "idt-site-"));
const put = (rel: string, content: string | Uint8Array) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};
put("data/apartment.json", '{"name":"x"}');
put("data/underlay/floorplan.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
put("data/underlay/notes.json", "{}");
put("catalogue/stool/item.json", '{"id":"stool"}');
put("catalogue/stool/model.glb", new Uint8Array([1, 2, 3]));
put("layouts/a.json", '{"name":"A"}');
put("layouts/.trash/old.json", '{"name":"old"}');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the website build", () => {
  it("never publishes the floor-plan underlay", async () => {
    const data = await siteListing(root, "data");
    expect(data.files.map((f) => f.path)).toEqual(["data/apartment.json"]);
    expect(data.assets).toEqual([]);
  });

  it("lists the folders like the file API, with assets versioned by their content", async () => {
    const catalogue = await siteListing(root, "catalogue");
    expect(catalogue.files).toEqual([{ path: "catalogue/stool/item.json", text: '{"id":"stool"}' }]);
    expect(catalogue.assets).toEqual([{ path: "catalogue/stool/model.glb", size: 3, mtime: contentVersion(new Uint8Array([1, 2, 3])) }]);
    expect((await siteListing(root, "layouts")).files.map((f) => f.path)).toEqual(["layouts/a.json"]);
  });

  it("ships the decoders for compressed GLB models", async () => {
    const urls = (await vendorFiles(path.resolve(import.meta.dirname, ".."))).map(([url]) => url);
    expect(urls).toEqual(expect.arrayContaining(["vendor/draco/draco_wasm_wrapper.js", "vendor/draco/draco_decoder.wasm", "vendor/basis/basis_transcoder.js", "vendor/basis/basis_transcoder.wasm"]));
  });
});
