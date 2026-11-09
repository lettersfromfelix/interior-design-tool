/**
 * Shows the selected placed item: an orange box around it and, unless it is locked, the rotate ring with a knob that
 * marks the item's front. In 2D the ring keeps a constant size on screen.
 */
import {
  BoxGeometry,
  CircleGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Raycaster,
} from "three";
import type { WorldPose } from "../../core/layout/poses";

const DEG = Math.PI / 180;

export interface Footprint {
  width: number;
  depth: number;
  height: number;
}

export class SelectionOverlay {
  readonly group = new Group();
  private readonly ringMat = new MeshBasicMaterial({ color: "#2f6fd0", transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
  private readonly knobMat = new MeshBasicMaterial({ color: "#2f6fd0", depthTest: false, depthWrite: false });
  private readonly pickMat = new MeshBasicMaterial({ visible: false });
  private readonly lineMat = new LineBasicMaterial({ color: "#ff8a00", depthTest: false, depthWrite: false });
  private ring?: Mesh;
  private knob?: Mesh;
  private pick?: Mesh;
  private outline?: LineSegments;
  private holder?: Group;
  private state?: { pose: WorldPose; size: Footprint; rotatable: boolean };
  private pxScale = 0;

  constructor() {
    this.group.name = "selection";
    this.group.renderOrder = 20;
  }

  /** Show the overlay for an item at `pose`. `cmPerPx` is the 2D zoom (0 in 3D). */
  show(pose: WorldPose, size: Footprint, rotatable: boolean, cmPerPx: number): void {
    this.state = { pose, size, rotatable };
    this.pxScale = cmPerPx;
    this.rebuild();
  }

  /** The 2D zoom changed: keep handles at the same size on screen. */
  setScale(cmPerPx: number): void {
    if (!this.state || Math.abs(cmPerPx - this.pxScale) < 1e-6 * Math.max(1, cmPerPx)) return;
    this.pxScale = cmPerPx;
    this.rebuild();
  }

  hide(): void {
    this.state = undefined;
    this.clear();
  }

  get visible(): boolean {
    return !!this.state;
  }

  /** Is the rotate handle under the ray? */
  hitsHandle(rc: Raycaster): boolean {
    return !!this.pick && rc.intersectObject(this.pick, false).length > 0;
  }

  private clear(): void {
    for (const o of [this.ring, this.knob, this.pick, this.outline]) o?.geometry.dispose();
    this.holder?.removeFromParent();
    this.ring = this.knob = this.pick = this.outline = this.holder = undefined;
  }

  private rebuild(): void {
    this.clear();
    const s = this.state;
    if (!s) return;
    const { pose, size, rotatable } = s;
    // sizes in cm: fixed in 3D, a constant number of pixels in 2D
    const px = (n: number, min: number) => (this.pxScale > 0 ? Math.max(min, n * this.pxScale) : min * 1.5);

    // the item's box; in 2D only its outline from above shows
    const box = new BoxGeometry(size.width, size.height, size.depth).translate(0, pose.y + size.height / 2, 0);
    this.outline = new LineSegments(new EdgesGeometry(box), this.lineMat);
    box.dispose();

    const holder = new Group();
    holder.position.set(pose.x, 0, pose.z);
    holder.rotation.y = -pose.rotation * DEG;
    holder.add(this.outline);

    if (rotatable) {
      const radius = Math.hypot(size.width, size.depth) / 2 + px(14, 8);
      const band = px(3, 2);
      const y = pose.y + 0.5;
      this.ring = new Mesh(new RingGeometry(radius - band / 2, radius + band / 2, 96).rotateX(-Math.PI / 2).translate(0, y, 0), this.ringMat);
      this.pick = new Mesh(new RingGeometry(radius - band * 3, radius + band * 3, 96).rotateX(-Math.PI / 2).translate(0, y, 0), this.pickMat);
      // the knob marks the front (+z)
      this.knob = new Mesh(new CircleGeometry(px(7, 5), 32).rotateX(-Math.PI / 2).translate(0, y, radius), this.knobMat);
      holder.add(this.ring, this.pick, this.knob);
    }
    for (const o of holder.children) o.renderOrder = 20;
    this.group.add(holder);
    this.holder = holder;
    holder.updateMatrixWorld(true);
  }

  dispose(): void {
    this.clear();
    this.group.clear();
    this.ringMat.dispose();
    this.knobMat.dispose();
    this.pickMat.dispose();
    this.lineMat.dispose();
  }
}
