/**
 * Pointer interaction with placed furniture, the same in 2D and 3D:
 * - press on an item: select it; drag: move it (committed on release as one change)
 * - drag the blue ring of the selected item: rotate it (Shift: 15° steps)
 * - click on anything else: select it (room, wall, opening, fixture) or clear the selection
 * - placing a catalogue item: a translucent preview follows the pointer; click (or drop) to place it
 * Dragging that starts on empty space still moves the camera.
 */
import { type Material, type Object3D, type Raycaster, type Scene, type Vector3 } from "three";
import { resolveMaterials } from "../core/catalogue/materials";
import { addItem, moveItem, nextUid, setRotation } from "../core/layout/commands";
import { baseElevation, rotatePlan, type PoseOverride } from "../core/layout/poses";
import type { Vec2 } from "../core/schema/common";
import type { AppStore, Placing, ViewMode } from "../state/store";
import { buildItem, type BuiltItem } from "./items/buildItem";
import { applyPose, type FurnitureLayer } from "./items/FurnitureLayer";
import type { ModelLibrary } from "./items/models";
import type { MaterialLibrary } from "./materials/MaterialLibrary";
import type { SelectionOverlay } from "./overlays/selection";

const DEG = Math.PI / 180;
/** Pointer travel (px) below which a press counts as a click. */
const CLICK_PX = 4;

export interface InteractionHost {
  readonly canvas: HTMLElement;
  /** Element that receives drag-and-drop from the catalogue panel. */
  readonly container: HTMLElement;
  readonly store: AppStore;
  readonly scene: Scene;
  readonly furniture: FurnitureLayer;
  readonly overlay: SelectionOverlay;
  readonly models: ModelLibrary;
  view(): ViewMode;
  /** Ray through a client point, using the active camera and its layers. */
  ray(clientX: number, clientY: number): Raycaster;
  /** Plan point under the pointer on the horizontal plane at height `y` (null if the ray misses it). */
  planPoint(clientX: number, clientY: number, y: number): Vec2 | null;
  apartmentRoot(): Object3D | undefined;
  materials(): MaterialLibrary | undefined;
  requestRender(): void;
}

type Hit = { kind: "item"; uid: string; point: Vector3 } | { kind: "element"; id: string; point: Vector3 };

type Gesture =
  | { kind: "press"; id: number; x: number; y: number; target: Hit | null }
  | {
      kind: "move";
      id: number;
      x: number;
      y: number;
      uid: string;
      planeY: number;
      startPlan: Vec2;
      startPos: Vec2;
      /** World rotation of the base item, for items standing on another one. */
      parentRotation: number | null;
      moved: boolean;
      pos: Vec2;
    }
  | { kind: "rotate"; id: number; uid: string; planeY: number; center: Vec2; startAngle: number; startRotation: number; rotation: number };

interface Ghost {
  itemId: string;
  built: BuiltItem;
  clones: Map<Material, Material>;
}

export class Interaction {
  private gesture: Gesture | null = null;
  private ghost?: Ghost;

  constructor(private readonly h: InteractionHost) {
    // capture phase: runs before the camera controls, which then never see presses on furniture
    h.canvas.addEventListener("pointerdown", this.onDown, { capture: true });
    h.canvas.addEventListener("pointermove", this.onMove);
    h.canvas.addEventListener("pointerup", this.onUp);
    h.canvas.addEventListener("pointercancel", this.onCancel);
    h.canvas.addEventListener("pointerleave", this.onLeave);
    h.container.addEventListener("dragover", this.onDragOver);
    h.container.addEventListener("dragleave", this.onDragLeave);
    h.container.addEventListener("drop", this.onDrop);
    window.addEventListener("keydown", this.onKey);
  }

  private get state() {
    return this.h.store.getState();
  }

  private pick(clientX: number, clientY: number): Hit | null {
    const rc = this.h.ray(clientX, clientY);
    const roots = [this.h.furniture.group, this.h.apartmentRoot()].filter((r): r is Object3D => !!r);
    for (const hit of rc.intersectObjects(roots, true)) {
      for (let o: Object3D | null = hit.object; o; o = o.parent) {
        if (o.userData.itemUid) return { kind: "item", uid: o.userData.itemUid as string, point: hit.point };
        if (o.userData.elementId) return { kind: "element", id: o.userData.elementId as string, point: hit.point };
      }
    }
    return null;
  }

  private capture(e: PointerEvent): void {
    e.stopImmediatePropagation();
    this.h.canvas.setPointerCapture(e.pointerId);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.gesture) return;
    const s = this.state;
    const press: Gesture = { kind: "press", id: e.pointerId, x: e.clientX, y: e.clientY, target: null };
    if (s.placing?.via === "click") {
      this.gesture = press; // a click places the item; a drag still moves the camera
      return;
    }

    const sel = s.selection?.kind === "item" ? s.selection.uid : null;
    if (sel && this.h.overlay.visible && this.h.overlay.hitsHandle(this.h.ray(e.clientX, e.clientY))) {
      const obj = this.h.furniture.object(sel);
      const placed = s.layout.doc.items.find((p) => p.uid === sel);
      const p = obj && this.h.planPoint(e.clientX, e.clientY, obj.position.y);
      if (obj && placed && p) {
        const center: Vec2 = [obj.position.x, obj.position.z];
        const startAngle = Math.atan2(p[1] - center[1], p[0] - center[0]) / DEG;
        this.gesture = { kind: "rotate", id: e.pointerId, uid: sel, planeY: obj.position.y, center, startAngle, startRotation: placed.rotation, rotation: placed.rotation };
        this.capture(e);
        return;
      }
    }

    const hit = this.pick(e.clientX, e.clientY);
    if (hit?.kind === "item") {
      s.selectItem(hit.uid);
      const placed = s.layout.doc.items.find((p) => p.uid === hit.uid);
      const planeY = this.h.view() === "2d" ? 0 : hit.point.y;
      const startPlan = this.h.planPoint(e.clientX, e.clientY, planeY);
      if (placed && !placed.locked && s.layout.status === "ready" && startPlan) {
        const parentRotation = placed.parent ? (this.h.furniture.pose(placed.parent.uid)?.rotation ?? null) : null;
        this.gesture = {
          kind: "move",
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          uid: hit.uid,
          planeY,
          startPlan,
          startPos: placed.position,
          parentRotation,
          moved: false,
          pos: placed.position,
        };
        this.capture(e);
        return;
      }
    }
    this.gesture = { ...press, target: hit };
  };

  private preview(uid: string, o: PoseOverride): void {
    this.h.furniture.preview(this.h.furniture.previewPoses(new Map([[uid, o]])));
  }

  private onMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (this.state.placing?.via === "click" && (!g || g.kind === "press")) this.updateGhost(e.clientX, e.clientY);
    if (!g || e.pointerId !== g.id) return;
    if (g.kind === "move") {
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < CLICK_PX) return;
      g.moved = true;
      const p = this.h.planPoint(e.clientX, e.clientY, g.planeY);
      if (!p) return;
      let delta: Vec2 = [p[0] - g.startPlan[0], p[1] - g.startPlan[1]];
      if (g.parentRotation !== null) delta = rotatePlan(delta, -g.parentRotation);
      g.pos = [g.startPos[0] + delta[0], g.startPos[1] + delta[1]];
      this.preview(g.uid, { position: g.pos });
    } else if (g.kind === "rotate") {
      const p = this.h.planPoint(e.clientX, e.clientY, g.planeY);
      if (!p) return;
      const angle = Math.atan2(p[1] - g.center[1], p[0] - g.center[0]) / DEG;
      let rotation = g.startRotation + angle - g.startAngle;
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
      g.rotation = rotation;
      this.preview(g.uid, { rotation });
    }
  };

  private onUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    if (this.h.canvas.hasPointerCapture(e.pointerId)) this.h.canvas.releasePointerCapture(e.pointerId);
    const s = this.state;
    if (g.kind === "move" || g.kind === "rotate") {
      if (g.kind === "move" && g.moved) s.edit((doc) => moveItem(doc, g.uid, g.pos));
      if (g.kind === "rotate") s.edit((doc) => setRotation(doc, g.uid, g.rotation));
      this.h.furniture.reset(); // shows the committed poses (or the old ones if nothing was saved)
      return;
    }
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > CLICK_PX) return; // the camera was dragged
    if (s.placing?.via === "click") {
      this.place(e.clientX, e.clientY);
      return;
    }
    if (!g.target) s.select(null);
    else if (g.target.kind === "element") s.selectElement(g.target.id);
    else s.selectItem(g.target.uid);
  };

  private cancel(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (this.h.canvas.hasPointerCapture(g.id)) this.h.canvas.releasePointerCapture(g.id);
    if (g.kind !== "press") this.h.furniture.reset();
  }

  private onCancel = (): void => this.cancel();

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.gesture && this.gesture.kind !== "press") {
      e.stopImmediatePropagation();
      this.cancel();
    }
  };

  private onLeave = (): void => {
    if (this.state.placing?.via === "click") this.hideGhost();
  };

  // ---- placing new items ----------------------------------------------------------------------------------

  /** Follow the store's `placing`: create, rotate or remove the preview. `rebuild` after catalogue/material changes. */
  setPlacing(placing: Placing | null, rebuild = false): void {
    if (!placing || rebuild || this.ghost?.itemId !== placing.itemId) this.removeGhost();
    if (!placing) return;
    this.ghost ??= this.buildGhost(placing.itemId);
    const root = this.ghost?.built.root;
    if (root?.visible) {
      root.rotation.y = -placing.rotation * DEG;
      root.updateMatrixWorld(true);
      this.h.requestRender();
    }
  }

  private buildGhost(itemId: string): Ghost | undefined {
    const s = this.state;
    const entry = s.catalogue.entries.get(itemId);
    const mats = this.h.materials();
    if (!entry || !mats) return undefined;
    const clones = new Map<Material, Material>();
    const transformMaterial = (m: Material) => {
      let c = clones.get(m);
      if (!c) {
        c = m.clone();
        c.transparent = true;
        c.opacity = Math.min(m.opacity, 0.55);
        c.depthWrite = false;
        clones.set(m, c);
      }
      return c;
    };
    const built = buildItem(entry, resolveMaterials(entry.item, undefined, s.data.materials), {
      mats,
      models: this.h.models,
      onLoaded: () => this.h.requestRender(),
      transformMaterial,
    });
    built.root.visible = false;
    built.root.name = "placing-preview";
    this.h.scene.add(built.root);
    return { itemId, built, clones };
  }

  private updateGhost(clientX: number, clientY: number): void {
    const s = this.state;
    const ghost = this.ghost;
    if (!s.placing || !ghost) return;
    const p = this.h.planPoint(clientX, clientY, 0);
    if (!p) return this.hideGhost();
    const item = s.catalogue.entries.get(s.placing.itemId)?.item;
    const y = baseElevation(item, {}, s.data.apartment?.ceilingHeight ?? 250);
    applyPose(ghost.built.root, { x: p[0], z: p[1], y, rotation: s.placing.rotation });
    ghost.built.root.visible = true;
    this.h.requestRender();
  }

  private hideGhost(): void {
    if (this.ghost?.built.root.visible) {
      this.ghost.built.root.visible = false;
      this.h.requestRender();
    }
  }

  private removeGhost(): void {
    const g = this.ghost;
    if (!g) return;
    g.built.root.removeFromParent();
    g.built.dispose();
    for (const c of g.clones.values()) c.dispose();
    this.ghost = undefined;
    this.h.requestRender();
  }

  /** Add the item that is being placed at the pointer, select it and stop placing. */
  private place(clientX: number, clientY: number): void {
    const s = this.state;
    const placing = s.placing;
    const p = this.h.planPoint(clientX, clientY, 0);
    const entry = placing && s.catalogue.entries.get(placing.itemId);
    if (!placing || !p || !entry) return;
    const uid = nextUid(s.layout.doc, entry.item.id);
    if (s.edit((doc) => addItem(doc, { uid, item: entry.item.id, position: p, rotation: placing.rotation }))) {
      s.stopPlacing();
      s.selectItem(uid);
    }
  }

  private onDragOver = (e: DragEvent): void => {
    if (this.state.placing?.via !== "drag") return;
    e.preventDefault(); // allows dropping
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    this.updateGhost(e.clientX, e.clientY);
  };

  private onDragLeave = (e: DragEvent): void => {
    if (!this.h.container.contains(e.relatedTarget as Node | null)) this.hideGhost();
  };

  private onDrop = (e: DragEvent): void => {
    if (this.state.placing?.via !== "drag") return;
    e.preventDefault();
    this.place(e.clientX, e.clientY);
  };

  dispose(): void {
    this.cancel();
    this.removeGhost();
    const c = this.h.canvas;
    c.removeEventListener("pointerdown", this.onDown, { capture: true });
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
    c.removeEventListener("pointerleave", this.onLeave);
    this.h.container.removeEventListener("dragover", this.onDragOver);
    this.h.container.removeEventListener("dragleave", this.onDragLeave);
    this.h.container.removeEventListener("drop", this.onDrop);
    window.removeEventListener("keydown", this.onKey);
  }
}
