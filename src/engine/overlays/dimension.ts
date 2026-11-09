import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { formatCheckValue } from "../../core/format";
import type { Check } from "../../core/schema/apartment";

/** Magenta dimension line for the active checklist item: exactly what to measure on site. Drawn on top of everything. */
export class DimensionOverlay {
  readonly group = new Group();
  private readonly line = new LineMaterial({ color: 0xd6008f, linewidth: 3, depthTest: false, transparent: true });
  private readonly dot = new MeshBasicMaterial({ color: 0xd6008f, depthTest: false, transparent: true });
  private readonly dotGeometry = new SphereGeometry(3, 16, 8);

  constructor() {
    this.group.name = "dimension";
  }

  show(check: Check | undefined): void {
    this.clear();
    if (!check?.from || !check.to) return;
    const a = new Vector3(...check.from);
    const b = new Vector3(...check.to);
    this.segment(a, b);
    const d = new Vector3().subVectors(b, a);
    const n = new Vector3(-d.z, 0, d.x);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    n.normalize().multiplyScalar(10);
    this.segment(a.clone().add(n), a.clone().sub(n));
    this.segment(b.clone().add(n), b.clone().sub(n));
    for (const p of [a, b]) {
      const dot = new Mesh(this.dotGeometry, this.dot);
      dot.position.copy(p);
      dot.renderOrder = 1001;
      this.group.add(dot);
    }
    const el = document.createElement("div");
    el.className = "dim-label";
    el.textContent = `${check.id} · ${formatCheckValue(check.planValue, check.unit)}`;
    const label = new CSS2DObject(el);
    label.position.copy(a).lerp(b, 0.5);
    this.group.add(label);
  }

  private segment(a: Vector3, b: Vector3): void {
    const g = new LineGeometry();
    g.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
    const l = new Line2(g, this.line);
    l.computeLineDistances();
    l.renderOrder = 1000;
    this.group.add(l);
  }

  setResolution(width: number, height: number): void {
    this.line.resolution.set(width, height);
  }

  private clear(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof Line2) c.geometry.dispose();
    }
  }

  dispose(): void {
    this.clear();
    this.line.dispose();
    this.dot.dispose();
    this.dotGeometry.dispose();
  }
}
