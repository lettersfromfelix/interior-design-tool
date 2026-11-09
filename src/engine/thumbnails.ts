/**
 * Automatic catalogue thumbnails: each item is rendered once in its default materials (front-right view, transparent
 * background) with a small separate renderer, and stored in the app state as an image URL. Items are rendered
 * again when their file, their model or the materials change.
 */
import { DirectionalLight, HemisphereLight, NeutralToneMapping, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { resolveMaterials } from "../core/catalogue/materials";
import type { CatalogueEntry } from "../data/catalogue";
import type { AppState, AppStore } from "../state/store";
import { buildItem } from "./items/buildItem";
import type { ModelLibrary } from "./items/models";
import { MaterialLibrary } from "./materials/MaterialLibrary";

export const THUMBNAIL_PX = 192;
const VIEW_DIR = new Vector3(0.9, 0.7, 1.35).normalize();
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class ThumbnailService {
  private renderer?: WebGLRenderer | null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(26, 1, 1, 10_000);
  private mats?: { version: number; lib: MaterialLibrary };
  private readonly queue: string[] = [];
  private busy = false;
  private unsubscribe?: () => void;

  constructor(
    private readonly store: AppStore,
    private readonly models: ModelLibrary,
  ) {
    const sun = new DirectionalLight("#ffffff", 1.7);
    sun.position.set(0.6, 1.4, 1.1);
    this.scene.add(new HemisphereLight("#ffffff", "#cfc7b9", 2.3), sun);
  }

  start(): void {
    this.unsubscribe = this.store.subscribe((s, prev) => {
      if (s.catalogue !== prev.catalogue || s.data !== prev.data) this.refresh();
    });
    this.refresh();
  }

  private static key = (entry: CatalogueEntry, s: AppState) => `${entry.rev}|${s.data.version}`;

  private refresh(): void {
    const s = this.store.getState();
    if (s.data.status !== "ready" || s.catalogue.status !== "ready") return;
    for (const [id, entry] of s.catalogue.entries) {
      if (s.thumbnails[id]?.key !== ThumbnailService.key(entry, s) && !this.queue.includes(id)) this.queue.push(id);
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        await this.render(this.queue.shift()!);
        await nextFrame(); // keep the page responsive
      }
    } finally {
      this.busy = false;
    }
  }

  private ensureRenderer(): WebGLRenderer | null {
    if (this.renderer === undefined) {
      try {
        const r = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        r.setPixelRatio(1);
        r.setSize(THUMBNAIL_PX, THUMBNAIL_PX, false);
        r.setClearColor(0x000000, 0);
        r.toneMapping = NeutralToneMapping;
        this.models.attachRenderer(r);
        this.renderer = r;
      } catch (err) {
        console.warn("No thumbnails: WebGL is not available", err);
        this.renderer = null;
      }
    }
    return this.renderer;
  }

  private materials(s: AppState, r: WebGLRenderer): MaterialLibrary {
    if (this.mats?.version !== s.data.version) {
      this.mats?.lib.dispose();
      this.mats = { version: s.data.version, lib: new MaterialLibrary(s.data.materials, { anisotropy: r.capabilities.getMaxAnisotropy() }) };
    }
    return this.mats.lib;
  }

  /** Put the camera so that the item's bounding box fills the image. */
  private frame(width: number, height: number, depth: number): void {
    const center = new Vector3(0, height / 2, 0);
    const z = VIEW_DIR;
    const x = new Vector3(0, 1, 0).cross(z).normalize();
    const y = z.clone().cross(x);
    const t = Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * 0.9;
    let dist = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const c = new Vector3((sx * width) / 2, (sy * height) / 2, (sz * depth) / 2);
          dist = Math.max(dist, c.dot(z) + Math.max(Math.abs(c.dot(x)), Math.abs(c.dot(y))) / t);
        }
      }
    }
    this.camera.position.copy(center).addScaledVector(z, dist);
    this.camera.near = Math.max(0.5, dist / 50);
    this.camera.far = dist * 4;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
  }

  private async render(id: string): Promise<void> {
    let s = this.store.getState();
    let entry = s.catalogue.entries.get(id);
    if (!entry || s.thumbnails[id]?.key === ThumbnailService.key(entry, s)) return;
    const r = this.ensureRenderer();
    if (!r) return;
    // wait for the model and the image textures; if the item or the materials change meanwhile, wait for those
    for (;;) {
      const key = ThumbnailService.key(entry, s);
      const waits: Promise<unknown>[] = [this.materials(s, r).whenLoaded(Object.values(resolveMaterials(entry.item, undefined, s.data.materials)))];
      if (entry.item.geometry.type === "model") waits.push(this.models.prepare(entry));
      try {
        await Promise.all(waits);
      } catch {
        return; // the model can't be loaded (the Issues panel says why), or it changed while loading (queued again)
      }
      s = this.store.getState();
      const now = s.catalogue.entries.get(id);
      if (!now) return;
      entry = now;
      if (ThumbnailService.key(entry, s) === key) break;
    }
    const built = buildItem(entry, resolveMaterials(entry.item, undefined, s.data.materials), {
      mats: this.materials(s, r),
      models: this.models,
      onLoaded: () => {},
    });
    const { width, height, depth } = entry.item.dimensions;
    this.frame(width, height, depth);
    this.scene.add(built.root);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL("image/png");
    built.root.removeFromParent();
    built.dispose();
    this.store.getState().setThumbnail(id, { key: ThumbnailService.key(entry, s), url });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.mats?.lib.dispose();
    this.renderer?.dispose();
  }
}
