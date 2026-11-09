import {
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type Texture,
} from "three";
import type { MaterialPreset } from "../../core/schema/materials";
import { assetUrl } from "../../data/api";
import { patternTexture } from "./patterns";

export interface MaterialLibraryOptions {
  anisotropy: number;
  /** Called when an image texture finished loading (to trigger a re-render). */
  onLoad?: () => void;
}

/** Turns material presets (data/materials.json) into Three.js materials. Unknown ids fall back to neutral grey. */
export class MaterialLibrary {
  private readonly cache = new Map<string, Material>();
  private readonly textures: Texture[] = [];
  /** Preset id -> its image textures have loaded (or failed). */
  private readonly loading = new Map<string, Promise<void>>();
  /** Dark fill for cut walls in the plan ("poche"), unlit. */
  readonly poche = new MeshBasicMaterial({ color: "#3a3c40" });
  readonly fallback = new MeshStandardMaterial({ color: "#9a9a9a", roughness: 0.85 });

  constructor(
    private readonly presets: ReadonlyMap<string, MaterialPreset>,
    private readonly options: MaterialLibraryOptions,
  ) {}

  preset(id: string | undefined): MaterialPreset | undefined {
    return id ? this.presets.get(id) : undefined;
  }

  get(id: string | undefined): Material {
    const p = this.preset(id);
    if (!p) return this.fallback;
    let m = this.cache.get(p.id);
    if (!m) {
      m = this.create(p);
      this.cache.set(p.id, m);
    }
    return m;
  }

  /** Resolves when the image textures of these presets have loaded (or failed), e.g. before rendering a thumbnail. */
  async whenLoaded(ids: Iterable<string>): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const id of ids) {
      this.get(id); // starts loading
      const p = this.loading.get(id);
      if (p) waits.push(p);
    }
    await Promise.all(waits);
  }

  private create(p: MaterialPreset): Material {
    const opacity = p.opacity ?? 1;
    const m = new MeshStandardMaterial({
      name: p.id,
      color: p.color,
      roughness: p.roughness ?? 0.8,
      metalness: p.metalness ?? 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 0.6,
    });
    if (p.emissive) {
      m.emissive.set(p.emissive);
      m.emissiveIntensity = p.emissiveIntensity ?? 1;
    }
    if (p.texture) {
      const repeat = p.texture.repeat;
      const map = this.load(p.texture.map, repeat, true);
      const loads = [map.loaded];
      m.map = map.texture;
      if (p.texture.normalMap) {
        const normal = this.load(p.texture.normalMap, repeat, false);
        m.normalMap = normal.texture;
        loads.push(normal.loaded);
      }
      this.loading.set(p.id, Promise.all(loads).then(() => undefined));
      m.color.set("#ffffff");
    } else if (p.pattern) {
      const { texture } = patternTexture(p.id, p.color, p.pattern, this.options.anisotropy);
      this.textures.push(texture);
      m.map = texture;
      m.color.set("#ffffff");
    }
    return m;
  }

  /** `loaded` resolves when the image has loaded or failed (a failed texture renders without its image). */
  private load(path: string, repeatCm: number, color: boolean): { texture: Texture; loaded: Promise<void> } {
    let done = () => {};
    const loaded = new Promise<void>((resolve) => (done = resolve));
    const t = new TextureLoader().load(
      assetUrl(path),
      () => {
        done();
        this.options.onLoad?.();
      },
      undefined,
      () => done(),
    );
    if (color) t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.anisotropy = this.options.anisotropy;
    t.repeat.set(1 / repeatCm, 1 / repeatCm);
    this.textures.push(t);
    return { texture: t, loaded };
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    for (const t of this.textures) t.dispose();
    this.poche.dispose();
    this.fallback.dispose();
    this.cache.clear();
  }
}

export const isSeeThrough = (m: Material | Material[]): boolean =>
  (Array.isArray(m) ? m : [m]).every((x) => x.transparent && x.opacity < 0.6);
