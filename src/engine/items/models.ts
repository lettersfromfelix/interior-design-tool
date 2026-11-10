/**
 * 3D models (GLB/GLTF) of catalogue items: loading with the decoders shipped with three.js (served locally, no
 * network), orientation fix, scaling to the item's declared dimensions, and caching per item revision.
 * Problems are reported as issues of the item's catalogue file.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import type { CatalogueItem } from "../../core/schema/catalogue";
import { issue, type Issue } from "../../core/validate/issues";
import type { CatalogueEntry } from "../../data/catalogue";
import { partEuler } from "../builders/parts";
import { applyCmUVs } from "../builders/uv";

/** Stretching one axis more than this (relative to the others) suggests a wrong orientation. */
export const PROPORTION_TOLERANCE = 0.05;

export interface PreparedMesh {
  name: string;
  /** Geometry in item-local cm (origin at the bottom centre, front +z), with the model's own UVs. */
  geometry: BufferGeometry;
  material: Material | Material[];
  /** The same geometry with cm-based UVs, for preset materials with patterns or textures (created on demand). */
  cmGeometry?: BufferGeometry;
}

export interface PreparedModel {
  meshes: PreparedMesh[];
}

export function cmGeometry(mesh: PreparedMesh): BufferGeometry {
  mesh.cmGeometry ??= applyCmUVs(mesh.geometry.clone());
  return mesh.cmGeometry;
}

/**
 * Copy of `g` with every attribute as plain float values. Models may store vertex data quantized in integer arrays
 * (KHR_mesh_quantization, e.g. files from gltfpack or with Meshopt compression) or interleaved; baking the fitting
 * transform into those arrays would destroy the shape.
 */
export function floatGeometry(g: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const { count, itemSize } = attr;
    const values = new Float32Array(count * itemSize);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < itemSize; k++) values[i * itemSize + k] = attr.getComponent(i, k); // undoes normalization
    }
    out.setAttribute(name, new BufferAttribute(values, itemSize));
  }
  if (g.index) out.setIndex(g.index.clone());
  for (const { start, count, materialIndex } of g.groups) out.addGroup(start, count, materialIndex);
  return out;
}

/** Reverse the triangle winding (after baking a mirroring transform). */
function flipWinding(g: BufferGeometry): void {
  const index = g.getIndex();
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(g.attributes) as BufferAttribute[]) {
    const n = attr.itemSize;
    const a = attr.array;
    for (let v = 0; v + 2 < attr.count; v += 3) {
      for (let k = 0; k < n; k++) {
        const t = a[(v + 1) * n + k];
        a[(v + 1) * n + k] = a[(v + 2) * n + k];
        a[(v + 2) * n + k] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toPrecision(2));

/**
 * Orient a loaded model (`geometry.rotation`) and scale it to the item's dimensions ("stretch": per axis,
 * "uniform": keep proportions, fit inside, centred). The result is baked into item-local cm.
 */
export function prepareModel(scene: Object3D, item: CatalogueItem, file: string): { model: PreparedModel; issues: Issue[] } {
  if (item.geometry.type !== "model") throw new Error("not a model item");
  const g = item.geometry;
  const orient = new Group();
  orient.rotation.copy(partEuler(g.rotation));
  orient.add(scene);
  orient.updateMatrixWorld(true);
  const box = new Box3().setFromObject(orient, true);
  if (box.isEmpty()) throw new Error("the model contains no visible geometry");
  const size = box.getSize(new Vector3());
  const { width, height, depth } = item.dimensions;
  const factors = [width / size.x, height / size.y, depth / size.z];
  // flat models (a picture, a rug): scale the flat axis like the others
  const finite = factors.filter((f) => Number.isFinite(f) && f > 0);
  const flat = finite.length ? Math.min(...finite) : 1;
  let [sx, sy, sz] = factors.map((f) => (Number.isFinite(f) && f > 0 ? f : flat));
  const issues: Issue[] = [];
  if ((g.fit ?? "stretch") === "uniform") {
    sx = sy = sz = Math.min(sx, sy, sz);
  } else {
    const ratio = Math.max(sx, sy, sz) / Math.min(sx, sy, sz);
    if (ratio > 1 + PROPORTION_TOLERANCE) {
      issues.push(
        issue(
          "warning",
          file,
          "dimensions",
          `the model is stretched unevenly to fit the dimensions (×${fmt(sx)} wide, ×${fmt(sy)} high, ×${fmt(sz)} deep; ${Math.round((ratio - 1) * 100)} % difference)`,
          'Check geometry.rotation (the front must face +z, up is +y) and the dimensions, or use "fit": "uniform".',
        ),
      );
    }
  }
  const center = box.getCenter(new Vector3());
  const fit = new Matrix4().makeScale(sx, sy, sz).multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const meshes: PreparedMesh[] = [];
  const materialNames = new Set<string>();
  orient.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const m = new Matrix4().multiplyMatrices(fit, mesh.matrixWorld);
    const geometry = floatGeometry(mesh.geometry).applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(geometry);
    meshes.push({ name: mesh.name, geometry, material: mesh.material });
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (mat.name) materialNames.add(mat.name);
  });
  // a materialMap entry that matches no material in the model would silently do nothing
  const available = [...materialNames].sort();
  for (const name of Object.keys(g.materialMap ?? {})) {
    if (materialNames.has(name)) continue;
    issues.push(
      issue(
        "warning",
        file,
        `geometry.materialMap.${name}`,
        `the model has no material named "${name}", so this mapping does nothing`,
        available.length ? `The model's materials: ${available.map((n) => `"${n}"`).join(", ")}.` : "The model's materials have no names.",
      ),
    );
  }
  return { model: { meshes }, issues };
}

/** Free a model's GPU data. three.js doesn't free textures together with their materials, so do it here. */
function disposeModel(model: PreparedModel): void {
  const textures = new Set<Texture>();
  for (const m of model.meshes) {
    m.geometry.dispose();
    m.cmGeometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const value of Object.values(mat) as unknown[]) {
        if ((value as Texture | null)?.isTexture) textures.add(value as Texture);
      }
      mat.dispose();
    }
  }
  for (const t of textures) {
    const image: unknown = t.source.data;
    t.dispose();
    // GLTFLoader decodes images into ImageBitmaps, one set per load; free the decoded pixels too
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
  }
}

/** Loads and caches the models of catalogue items. One instance is shared by the 3D view and the thumbnails. */
export class ModelLibrary {
  private loader?: GLTFLoader;
  private renderer?: WebGLRenderer;
  private readonly pending = new Map<string, Promise<PreparedModel>>();
  private readonly ready = new Map<string, PreparedModel>();
  /** Item id -> cache key of its latest revision, and the number of the load that fetches it. */
  private readonly latest = new Map<string, { key: string; load: number }>();
  private loads = 0;

  constructor(private readonly report: (file: string, issues: Issue[]) => void) {}

  /** KTX2 textures need to know what the GPU supports; the first renderer is enough. */
  attachRenderer(renderer: WebGLRenderer): void {
    this.renderer ??= renderer;
  }

  private gltfLoader(): GLTFLoader {
    if (!this.loader) {
      const vendor = `${import.meta.env.BASE_URL}vendor`;
      const loader = new GLTFLoader();
      loader.setDRACOLoader(new DRACOLoader().setDecoderPath(`${vendor}/draco/`));
      loader.setMeshoptDecoder(MeshoptDecoder);
      if (this.renderer) loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(`${vendor}/basis/`).detectSupport(this.renderer));
      this.loader = loader;
    }
    return this.loader;
  }

  private static key = (entry: CatalogueEntry) => `${entry.item.id}|${entry.rev}`;

  /** The prepared model if it has already been loaded. */
  peek(entry: CatalogueEntry): PreparedModel | undefined {
    return this.ready.get(ModelLibrary.key(entry));
  }

  /** The item's model, oriented and scaled to its dimensions. Loaded once per item revision. */
  prepare(entry: CatalogueEntry): Promise<PreparedModel> {
    const key = ModelLibrary.key(entry);
    let p = this.pending.get(key);
    if (p) return p;
    const old = this.latest.get(entry.item.id);
    if (old && old.key !== key) {
      const stale = this.ready.get(old.key);
      this.pending.delete(old.key);
      this.ready.delete(old.key);
      if (stale) disposeModel(stale);
    }
    const load = ++this.loads;
    this.latest.set(entry.item.id, { key, load });
    p = this.load(entry, key, load);
    this.pending.set(key, p);
    return p;
  }

  private async load(entry: CatalogueEntry, key: string, load: number): Promise<PreparedModel> {
    if (!entry.modelUrl) throw new Error(`${entry.file} has no model file`);
    const current = () => this.latest.get(entry.item.id)?.load === load;
    let prepared: ReturnType<typeof prepareModel>;
    try {
      const gltf = await this.gltfLoader().loadAsync(entry.modelUrl);
      prepared = prepareModel(gltf.scene, entry.item, entry.file);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (current()) {
        this.report(entry.file, [
          issue("error", entry.file, "geometry.src", `could not load the 3D model: ${message}`, "Check that the file is a valid .glb or .gltf file (e.g. open it in Windows 3D Viewer)."),
        ]);
      }
      throw err;
    }
    if (!current()) {
      // the file changed while it was loading: nothing shows this version any more
      disposeModel(prepared.model);
      throw new Error(`${entry.file} changed while its model was loading`);
    }
    this.ready.set(key, prepared.model);
    this.report(entry.file, prepared.issues);
    return prepared.model;
  }

  dispose(): void {
    for (const m of this.ready.values()) disposeModel(m);
    this.ready.clear();
    this.pending.clear();
  }
}
