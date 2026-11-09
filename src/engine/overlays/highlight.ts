import { Group, Mesh, MeshBasicMaterial, type Material, type Object3D } from "three";

/** Tints the meshes of selected elements (orange) and of the active check's elements (magenta). */
export class Highlight {
  readonly group = new Group();
  private readonly selected = new MeshBasicMaterial({
    color: "#ff8a00",
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly related = this.selected.clone();

  constructor() {
    this.group.name = "highlight";
    this.related.color.set("#d6008f");
    this.related.opacity = 0.35;
  }

  set(selected: readonly Object3D[], related: readonly Object3D[]): void {
    this.group.clear();
    const add = (target: Object3D, material: Material) => {
      target.updateWorldMatrix(true, true);
      target.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const copy = new Mesh(mesh.geometry, material);
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(mesh.matrixWorld);
        copy.layers.mask = mesh.layers.mask;
        copy.renderOrder = 5;
        this.group.add(copy);
      });
    };
    for (const o of related) if (!selected.includes(o)) add(o, this.related);
    for (const o of selected) add(o, this.selected);
  }

  dispose(): void {
    this.group.clear();
    this.selected.dispose();
    this.related.dispose();
  }
}
