import { Box3, OrthographicCamera, Vector2 } from "three";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Top-down plan camera: drag to pan, wheel to zoom at the cursor.
 * Screen right = plan +x, screen up = plan up (-z), so the view matches the floor plan.
 */
export class PlanControls {
  enabled = true;
  /** Plan point [x, z] in the middle of the screen. */
  readonly center = new Vector2();
  cmPerPx = 1;
  private width = 1;
  private height = 1;
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(
    readonly camera: OrthographicCamera,
    private readonly dom: HTMLElement,
    private readonly onChange: () => void,
    /** Called when the user pans or zooms (not for programmatic changes). */
    private readonly onUserChange: () => void = () => {},
  ) {
    camera.up.set(0, 0, -1);
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointercancel", this.onUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.update();
  }

  fit(b: Box3, marginPx = 48): void {
    const w = Math.max(1, this.width - 2 * marginPx);
    const h = Math.max(1, this.height - 2 * marginPx);
    this.cmPerPx = Math.max((b.max.x - b.min.x) / w, (b.max.z - b.min.z) / h, 0.05);
    this.center.set((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
    this.update();
  }

  update(): void {
    const c = this.camera;
    const hw = (this.width / 2) * this.cmPerPx;
    const hh = (this.height / 2) * this.cmPerPx;
    c.left = -hw;
    c.right = hw;
    c.top = hh;
    c.bottom = -hh;
    c.near = 1;
    c.far = 100_000;
    c.position.set(this.center.x, 20_000, this.center.y);
    c.lookAt(this.center.x, 0, this.center.y);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.onChange();
  }

  /** Plan coordinates under a pointer position. */
  toPlan(clientX: number, clientY: number): Vector2 {
    const r = this.dom.getBoundingClientRect();
    return new Vector2(
      this.center.x + (clientX - r.left - this.width / 2) * this.cmPerPx,
      this.center.y + (clientY - r.top - this.height / 2) * this.cmPerPx,
    );
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.dom.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.enabled || !this.drag || e.pointerId !== this.drag.id) return;
    this.center.x -= (e.clientX - this.drag.x) * this.cmPerPx;
    this.center.y -= (e.clientY - this.drag.y) * this.cmPerPx;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.onUserChange();
    this.update();
  };

  private onUp = (e: PointerEvent): void => {
    if (this.drag?.id !== e.pointerId) return;
    this.drag = null;
    if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const before = this.toPlan(e.clientX, e.clientY);
    const speed = e.deltaMode === 1 ? 0.05 : 0.0015;
    this.cmPerPx = clamp(this.cmPerPx * Math.exp(e.deltaY * speed), 0.05, 50);
    const after = this.toPlan(e.clientX, e.clientY);
    this.center.x += before.x - after.x;
    this.center.y += before.y - after.y;
    this.onUserChange();
    this.update();
  };

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointercancel", this.onUp);
    this.dom.removeEventListener("wheel", this.onWheel);
  }
}
