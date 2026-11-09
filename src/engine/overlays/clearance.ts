/** Clearance zones: translucent floor areas in front of (or around) items; amber where something is in the way. */
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, Vector2 } from "three";
import type { Vec2 } from "../../core/schema/common";

export interface ZoneView {
  poly: Vec2[];
  /** Height of the floor the item stands on. */
  y: number;
  blocked: boolean;
}

export class ClearanceOverlay {
  readonly group = new Group();
  private readonly free = new MeshBasicMaterial({ color: "#2f86c9", transparent: true, opacity: 0.14, depthWrite: false, side: DoubleSide });
  private readonly blocked = new MeshBasicMaterial({ color: "#f2a516", transparent: true, opacity: 0.4, depthWrite: false, side: DoubleSide });

  constructor() {
    this.group.name = "clearance";
  }

  show(zones: readonly ZoneView[]): void {
    this.clear();
    for (const z of zones) {
      const g = new ShapeGeometry(new Shape(z.poly.map(([x, zz]) => new Vector2(x, -zz)))).rotateX(-Math.PI / 2);
      const mesh = new Mesh(g, z.blocked ? this.blocked : this.free);
      mesh.position.y = z.y + 0.6;
      mesh.renderOrder = 3;
      mesh.raycast = () => {};
      this.group.add(mesh);
    }
  }

  clear(): void {
    for (const c of [...this.group.children]) {
      (c as Mesh).geometry.dispose();
      this.group.remove(c);
    }
  }

  dispose(): void {
    this.clear();
    this.free.dispose();
    this.blocked.dispose();
  }
}
