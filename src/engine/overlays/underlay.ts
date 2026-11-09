import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from "three";
import type { Underlay } from "../../core/schema/apartment";
import { assetUrl } from "../../data/api";
import { Layer, setLayer } from "../layers";

const DEG = Math.PI / 180;
const plane = (w: number, h: number) => new PlaneGeometry(w, h).rotateX(-Math.PI / 2);

/**
 * The original floor plan as a semi-transparent image on top of the 2D view (multiply blending, so its lines
 * darken the model below). Its placement in model coordinates comes from apartment.json → underlay.
 */
export class UnderlayOverlay {
  readonly group = new Group();
  private mesh?: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private texture?: Texture;
  private key = "";
  private visible = false;
  private opacity = 0.5;

  constructor(private readonly onChange: () => void) {
    this.group.name = "underlay";
  }

  set(u: Underlay | undefined, version: number, y: number): void {
    const key = u ? `${JSON.stringify(u)}@${version}` : "";
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!u) return;
    const height = u.heightCm ?? u.widthCm * 0.75;
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: this.opacity,
      blending: MultiplyBlending,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(plane(u.widthCm, height), material);
    mesh.position.set(u.widthCm / 2, 0, height / 2);
    mesh.renderOrder = 900;
    this.texture = new TextureLoader().load(assetUrl(u.image, version), (tex) => {
      if (!u.heightCm) {
        const img = tex.image as { width: number; height: number };
        const h = (u.widthCm * img.height) / img.width;
        mesh.geometry.dispose();
        mesh.geometry = plane(u.widthCm, h);
        mesh.position.z = h / 2;
      }
      this.onChange();
    });
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    material.map = this.texture;
    const pivot = new Group(); // rotates around the image's top-left corner
    pivot.position.set(u.x, y, u.z);
    pivot.rotation.y = -(u.rotation ?? 0) * DEG;
    pivot.add(mesh);
    this.group.add(setLayer(pivot, Layer.ONLY_2D));
    this.mesh = mesh;
    this.apply();
  }

  setDisplay(visible: boolean, opacity: number): void {
    this.visible = visible;
    this.opacity = opacity;
    this.apply();
  }

  private apply(): void {
    this.group.visible = this.visible;
    if (this.mesh) this.mesh.material.opacity = this.opacity;
  }

  private clear(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    this.texture?.dispose();
    this.group.clear();
    this.mesh = undefined;
    this.texture = undefined;
  }

  dispose(): void {
    this.clear();
  }
}
