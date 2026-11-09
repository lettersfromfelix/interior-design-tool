import type { PerspectiveCamera } from "three";
import type { Vec2 } from "../../core/schema/common";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** cm per second. */
const WALK_SPEED = 140;
const RUN_SPEED = 400;
/** Radians per second (arrow keys) and per pixel (mouse). */
const TURN_SPEED = 1.8;
const LOOK_SPEED = 0.0025;

export interface WalkHost {
  /** Where a step from `from` by `delta` (plan cm) ends, after bumping into things. */
  move(from: Vec2, delta: Vec2): Vec2;
  eyeHeight(): number;
  /** The camera moved. */
  onChange(): void;
  /** Esc while the mouse is free: leave walk mode. */
  onExit(): void;
}

type Action = "forward" | "back" | "left" | "right" | "turnLeft" | "turnRight";

const KEYS: Record<string, Action> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  KeyD: "right",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
};

/** Keys typed into a text field belong to it; a focused slider keeps its arrow keys. */
const ownsKey = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  if (type === "range") return e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End";
  return !["checkbox", "radio", "button", "submit", "reset", "color"].includes(type);
};

/**
 * First-person controls: click to capture the mouse and look around (pointer lock; where that isn't available, drag
 * to look), W A S D or the arrow keys to walk, Shift to run, Esc to free the mouse.
 */
export class WalkControls {
  /** Plan position of your eyes. */
  position: Vec2 = [0, 0];
  /** Turn left (radians, counter-clockwise seen from above; 0 = looking up the plan, −z). */
  yaw = 0;
  /** Look up (radians). */
  pitch = 0;
  private on = false;
  private placed = false;
  private readonly held = new Set<Action>();
  private run = false;
  private drag: { id: number; x: number; y: number } | null = null;
  /** When the mouse was last freed: the Esc that freed it must not also end walking. */
  private unlockedAt = 0;

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly host: WalkHost,
  ) {
    camera.rotation.order = "YXZ";
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointercancel", this.onUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.release);
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    if (!on) {
      this.release();
      if (this.locked) document.exitPointerLock();
    }
  }

  /** Has the walker been put somewhere yet? */
  get started(): boolean {
    return this.placed;
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  /** Stand at `position`, looking along the plan direction `facing`. */
  place(position: Vec2, facing: Vec2): void {
    this.position = [position[0], position[1]];
    this.yaw = Math.atan2(-facing[0], -facing[1]);
    this.pitch = 0;
    this.placed = true;
    this.apply();
  }

  /** Put the camera where the walker is (e.g. after the eye height changed). */
  apply(): void {
    this.camera.position.set(this.position[0], this.host.eyeHeight(), this.position[1]);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.updateMatrixWorld();
    this.host.onChange();
  }

  /** Walk for `dt` seconds with the keys that are held; true if the camera moved. */
  update(dt: number): boolean {
    if (!this.on || this.held.size === 0) return false;
    const has = (a: Action) => (this.held.has(a) ? 1 : 0);
    const turn = has("turnLeft") - has("turnRight");
    if (turn) this.yaw += turn * TURN_SPEED * dt;
    const fwd = has("forward") - has("back");
    const side = has("right") - has("left");
    if (fwd || side) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // the camera looks along (−sin yaw, −cos yaw) on the plan; its right is (cos yaw, −sin yaw)
      const dx = -sin * fwd + cos * side;
      const dz = -cos * fwd - sin * side;
      const step = ((this.run ? RUN_SPEED : WALK_SPEED) * dt) / Math.hypot(dx, dz);
      this.position = this.host.move(this.position, [dx * step, dz * step]);
    }
    this.apply();
    return true;
  }

  private look(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SPEED;
    this.pitch = clamp(this.pitch - dy * LOOK_SPEED, -1.45, 1.45);
    this.apply();
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.on || e.button !== 0) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      // not possible while the mouse is captured (pointer lock); not needed then either
    }
    if (!this.locked) {
      try {
        const req = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
        req?.catch?.(() => {}); // not allowed (e.g. headless): dragging still works
      } catch {
        // ignore: dragging still works
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.on || this.locked || !this.drag || e.pointerId !== this.drag.id) return;
    this.look(e.clientX - this.drag.x, e.clientY - this.drag.y);
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
  };

  private onUp = (e: PointerEvent): void => {
    if (this.drag?.id !== e.pointerId) return;
    this.drag = null;
    try {
      if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    } catch {
      // the mouse is captured (pointer lock)
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.on && this.locked) this.look(e.movementX, e.movementY);
  };

  private onLockChange = (): void => {
    if (!this.locked) this.unlockedAt = performance.now();
    this.host.onChange();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.on || ownsKey(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    this.run = e.shiftKey;
    if (e.key === "Escape") {
      if (!this.locked && performance.now() - this.unlockedAt > 400) this.host.onExit();
      return;
    }
    const action = KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    this.held.add(action);
    this.host.onChange(); // starts the frame loop
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.run = e.shiftKey;
    const action = KEYS[e.code];
    if (action) this.held.delete(action);
  };

  /** Let go of all keys (the window lost focus, walking was switched off). */
  private release = (): void => {
    this.held.clear();
    this.run = false;
  };

  dispose(): void {
    this.enabled = false;
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointermove", this.onPointerMove);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointercancel", this.onUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.release);
  }
}
