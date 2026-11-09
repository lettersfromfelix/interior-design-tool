/** Builds the 3D object of one placed catalogue item (origin at the bottom centre, front +z). */
import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from "three";
import { ORIGINAL } from "../../core/catalogue/materials";
import type { CatalogueEntry } from "../../data/catalogue";
import { buildParts } from "../builders/parts";
import type { MaterialLibrary } from "../materials/MaterialLibrary";
import { cmGeometry, type ModelLibrary, type PreparedModel } from "./models";

export interface BuiltItem {
  root: Group;
  /** Free what this build created (shared materials and model data stay). */
  dispose(): void;
}

export interface ItemContext {
  mats: MaterialLibrary;
  models: ModelLibrary;
  /** Called when a model finished loading and was added (to re-render). */
  onLoaded: () => void;
  /** Optional replacement for every material (e.g. the translucent preview while placing). */
  transformMaterial?: (m: Material) => Material;
}

/** Size of the placeholder box for items whose catalogue id is unknown. */
export const UNKNOWN_SIZE = 40;

const hasTexture = (m: Material) => !!(m as MeshStandardMaterial).map;

function disposeOwned(root: Object3D, keep: ReadonlySet<unknown>): void {
  root.traverse((o) => {
    const g = (o as Mesh).geometry;
    if (g && !keep.has(g)) g.dispose();
  });
}

/** A box outline (+ a translucent fill) of the given size, standing on the origin. */
function placeholder(w: number, h: number, d: number, color: string, fill: number): { obj: Group; dispose(): void } {
  const geo = new BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const edges = new EdgesGeometry(geo);
  const fillMat = new MeshStandardMaterial({ color, transparent: true, opacity: fill, depthWrite: false });
  const lineMat = new LineBasicMaterial({ color });
  const obj = new Group();
  obj.add(new Mesh(geo, fillMat), new LineSegments(edges, lineMat));
  return {
    obj,
    dispose() {
      geo.dispose();
      edges.dispose();
      fillMat.dispose();
      lineMat.dispose();
    },
  };
}

function addModel(group: Group, model: PreparedModel, entry: CatalogueEntry, resolved: Record<string, string>, ctx: ItemContext): void {
  const map = entry.item.geometry.type === "model" ? (entry.item.geometry.materialMap ?? {}) : {};
  const tx = ctx.transformMaterial ?? ((m: Material) => m);
  for (const pm of model.meshes) {
    const list = Array.isArray(pm.material) ? pm.material : [pm.material];
    let cm = false;
    const mats = list.map((m) => {
      const slot = map[m.name];
      const choice = slot === undefined ? ORIGINAL : resolved[slot];
      if (choice === ORIGINAL) return tx(m);
      const preset = ctx.mats.get(choice);
      cm ||= hasTexture(preset);
      return tx(preset);
    });
    const mesh = new Mesh(cm ? cmGeometry(pm) : pm.geometry, Array.isArray(pm.material) ? mats : mats[0]);
    mesh.name = pm.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/**
 * Build an item. `resolved` maps every material slot to the preset (or "@original") to use, see resolveMaterials().
 * Unknown items become a red placeholder box; models show a grey box until they are loaded.
 */
export function buildItem(entry: CatalogueEntry | undefined, resolved: Record<string, string>, ctx: ItemContext): BuiltItem {
  const root = new Group();
  const tx = ctx.transformMaterial ?? ((m: Material) => m);

  if (!entry) {
    const p = placeholder(UNKNOWN_SIZE, UNKNOWN_SIZE, UNKNOWN_SIZE, "#d32f2f", 0.35);
    root.add(p.obj);
    return { root, dispose: p.dispose };
  }

  const { item } = entry;
  if (item.geometry.type === "parametric") {
    const parts = buildParts(item.geometry.parts, (slot) => tx(ctx.mats.get(resolved[slot])));
    root.add(parts);
    return { root, dispose: () => disposeOwned(parts, new Set()) };
  }

  // model: show its outline until the file is loaded
  const { width, height, depth } = item.dimensions;
  let disposed = false;
  let box: ReturnType<typeof placeholder> | undefined;
  const content = new Group();
  root.add(content);
  const show = (model: PreparedModel) => {
    box?.obj.removeFromParent();
    box?.dispose();
    box = undefined;
    addModel(content, model, entry, resolved, ctx);
  };
  const ready = ctx.models.peek(entry);
  if (ready) show(ready);
  else {
    box = placeholder(width, height, depth, "#8a8f98", 0.12);
    root.add(box.obj);
    ctx.models.prepare(entry).then(
      (model) => {
        if (disposed) return;
        show(model);
        ctx.onLoaded();
      },
      () => {
        if (disposed || !box) return;
        box.obj.removeFromParent();
        box.dispose();
        box = placeholder(width, height, depth, "#d32f2f", 0.3);
        root.add(box.obj);
        ctx.onLoaded();
      },
    );
  }
  return {
    root,
    dispose() {
      disposed = true;
      box?.dispose();
      // model geometries are shared through the ModelLibrary; only meshes are dropped
    },
  };
}
