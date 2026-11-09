/**
 * Lines with a length label, drawn on top of everything: live distances while moving an item, and the tape measure.
 */
import { Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector3 } from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

type P3 = readonly [number, number, number];

export const formatLength = (cm: number): string => (cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(1)} cm`);

/** Lines with labels in one colour. `show` replaces everything. */
export class LineOverlay {
  readonly group = new Group();
  private readonly line: LineMaterial;
  private readonly dot: MeshBasicMaterial;
  private readonly dotGeometry = new SphereGeometry(1, 16, 8);
  private readonly ringGeometry = new RingGeometry(0.75, 1, 32).rotateX(-Math.PI / 2);

  constructor(
    name: string,
    color: string,
    private readonly labelClass: string,
    width = 2,
    dashed = false,
  ) {
    this.group.name = name;
    this.line = new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true, dashed, dashSize: 6, gapSize: 4 });
    this.dot = new MeshBasicMaterial({ color, depthTest: false, transparent: true });
  }

  setResolution(width: number, height: number): void {
    this.line.resolution.set(width, height);
  }

  clear(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof Line2) c.geometry.dispose();
    }
  }

  /** A line from a to b with end dots (`dot` cm) and a label in the middle. */
  segment(a: P3, b: P3, label: string | undefined, dot: number): void {
    const g = new LineGeometry();
    g.setPositions([...a, ...b]);
    const l = new Line2(g, this.line);
    l.computeLineDistances();
    l.renderOrder = 1000;
    l.raycast = () => {};
    this.group.add(l);
    for (const p of [a, b]) this.marker(p, dot, false);
    if (label) {
      const el = document.createElement("div");
      el.className = this.labelClass;
      el.textContent = label;
      const obj = new CSS2DObject(el);
      obj.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      this.group.add(obj);
    }
  }

  /** A dot, or a ring (a snapped point). */
  marker(p: P3, size: number, ring: boolean): void {
    const m = new Mesh(ring ? this.ringGeometry : this.dotGeometry, this.dot);
    m.position.copy(new Vector3(...p));
    m.scale.setScalar(size);
    m.renderOrder = 1001;
    m.raycast = () => {};
    this.group.add(m);
  }

  dispose(): void {
    this.clear();
    this.line.dispose();
    this.dot.dispose();
    this.dotGeometry.dispose();
    this.ringGeometry.dispose();
  }
}
