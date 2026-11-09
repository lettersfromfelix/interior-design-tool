/**
 * Pointer interaction, the same in 2D and 3D:
 * - press on an item: select it; drag: move it through the placement solver (wall snap, grid, stacking, wall
 *   mounting, collisions); committed on release as one undo step
 * - drag the blue ring of the selected item: rotate it in steps from where it was (15°, Shift: 90°, Alt: free)
 * - click on anything else: select it (room, wall, opening, fixture) or clear the selection
 * - placing a catalogue item: a translucent preview follows the pointer through the same solver; click (or drop)
 * - measure tool: click two points; the line stays until it is cleared
 * Dragging that starts on empty space still moves the camera. Nothing here is active in walk mode.
 */
import { type Material, type Object3D, type Raycaster, type Scene, type Vector3 } from "three";
import { resolveMaterials } from "../core/catalogue/materials";
import { addItem, moveItem, nextUid, setPlacement, setRotation, type PlacementChange } from "../core/layout/commands";
import { descendants, resolvePoses, rotatePlan, type WorldPose } from "../core/layout/poses";
import { rotationStep } from "../core/placement/aids";
import { indexApartment } from "../core/placement/apartment";
import { bodiesOf, layoutConflicts, type Conflict } from "../core/placement/collisions";
import { sideDistances, type SideDistance } from "../core/placement/distances";
import { constrainToAxis, snapMeasurePoint, type MeasureSnap, type MeasureTargets } from "../core/placement/measure";
import { worldRect, type Solid } from "../core/placement/shapes";
import { snapTo } from "../core/placement/snap";
import { currentAttempt, moveTo, placeExactly, refused, type Attempt, type Mover, type PlacementContext, type Target } from "../core/placement/solve";
import type { CatalogueItem } from "../core/schema/catalogue";
import type { Vec2 } from "../core/schema/common";
import type { LayoutFile } from "../core/schema/layout";
import { conflictLevel, conflictsOf, itemLookup } from "../state/derived";
import type { AppStore, Placing, ViewMode } from "../state/store";
import { buildItem, type BuiltItem } from "./items/buildItem";
import { applyPose, type FurnitureLayer } from "./items/FurnitureLayer";
import type { ModelLibrary } from "./items/models";
import type { MaterialLibrary } from "./materials/MaterialLibrary";
import { formatLength, type LineOverlay } from "./overlays/lines";
import type { SelectionOverlay } from "./overlays/selection";
import { applyTint } from "./overlays/tint";

const DEG = Math.PI / 180;
/** Pointer travel (px) below which a press counts as a click. */
const CLICK_PX = 4;
/** Tape-measure snapping distance: pixels in 2D, cm in 3D. */
const SNAP_PX = 10;
const SNAP_CM_3D = 8;

/** What a gesture shows instead of the layout: the scene as it would be after it. */
export interface Preview {
  doc: LayoutFile;
  poses: ReadonlyMap<string, WorldPose>;
  /** Conflicts to show: the moving items' and those of what they run into. */
  conflicts: ReadonlyMap<string, readonly Conflict[]>;
  distances: SideDistance[];
  /** Height to draw the distance lines at. */
  y: number;
}

export interface InteractionHost {
  readonly canvas: HTMLElement;
  /** Element that receives drag-and-drop from the catalogue panel. */
  readonly container: HTMLElement;
  readonly store: AppStore;
  readonly scene: Scene;
  readonly furniture: FurnitureLayer;
  readonly overlay: SelectionOverlay;
  readonly models: ModelLibrary;
  /** The tape-measure line that follows the pointer. */
  readonly measureLive: LineOverlay;
  view(): ViewMode;
  /** Ray through a client point, using the active camera and its layers. */
  ray(clientX: number, clientY: number): Raycaster;
  /** Plan point under the pointer on the horizontal plane at height `y` (null if the ray misses it). */
  planPoint(clientX: number, clientY: number, y: number): Vec2 | null;
  /** 2D zoom: cm per screen pixel. */
  cmPerPx(): number;
  apartmentRoot(): Object3D | undefined;
  materials(): MaterialLibrary | undefined;
  /** Show the scene as a gesture would leave it, or (null) as the layout is. */
  preview(p: Preview | null): void;
  requestRender(): void;
}

type Hit = { kind: "item"; uid: string; point: Vector3 } | { kind: "element"; id: string; point: Vector3 };

/** The placement solver set up for one gesture. */
interface Session {
  mover: Mover;
  ctx: PlacementContext;
  /** Solids of everything that stays put (walls, fixtures, other items), for the distance lines. */
  still: Solid[];
  last?: Attempt;
}

type Gesture =
  | { kind: "press"; id: number; x: number; y: number; target: Hit | null }
  | {
      kind: "move";
      id: number;
      x: number;
      y: number;
      uid: string;
      moved: boolean;
      /** Height of the plane the pointer moves on (3D: where the item was grabbed). */
      planeY: number;
      /** Item origin minus the pointer's point when it was grabbed. */
      grab: Vec2;
      /** World rotation the item keeps. */
      rotation: number;
      session?: Session;
      /** Items without a catalogue entry (red boxes) move without the solver. */
      raw?: { startPos: Vec2; parentRotation: number | null; pos: Vec2 };
    }
  | {
      kind: "rotate";
      id: number;
      x: number;
      y: number;
      /** The pointer moved far enough to count as a rotation (not a click on the ring). */
      moved: boolean;
      uid: string;
      planeY: number;
      center: Vec2;
      startAngle: number;
      /** World rotation at the start and of the base item (0 without one). */
      startWorld: number;
      parentWorld: number;
      base: PlacementChange;
      session?: Session;
      /** Relative rotation (items without a catalogue entry). */
      rotation: number;
    };

interface Ghost {
  itemId: string;
  built: BuiltItem;
  clones: Map<Material, Material>;
  attempt?: Attempt;
  /** Last pointer position, to re-solve after rotating with the keyboard. */
  pointer?: { x: number; y: number };
}

export class Interaction {
  private gesture: Gesture | null = null;
  private ghost?: Ghost;
  private measureStart?: [number, number, number];
  private targets?: { key: readonly unknown[]; targets: MeasureTargets };

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

  /** First placed item under the pointer that is not in `skip` (3D: what an onTop item would go on). */
  private pickItem(clientX: number, clientY: number, skip: ReadonlySet<string>): { uid: string; point: Vector3 } | null {
    for (const hit of this.h.ray(clientX, clientY).intersectObject(this.h.furniture.group, true)) {
      for (let o: Object3D | null = hit.object; o; o = o.parent) {
        const uid = o.userData.itemUid as string | undefined;
        if (uid) {
          if (!skip.has(uid)) return { uid, point: hit.point };
          break;
        }
      }
    }
    return null;
  }

  /** Point on the apartment (walls, floors, fixtures) under the pointer. */
  private pickApartment(clientX: number, clientY: number): Vector3 | null {
    const root = this.h.apartmentRoot();
    return (root && this.h.ray(clientX, clientY).intersectObject(root, true)[0]?.point) || null;
  }

  /**
   * Where the pointer puts an item of this placement type, plus a surface hint. 2D: the plan point. 3D: wall items
   * follow the wall under the pointer, onTop items the furniture under it, the rest the plane at `planeY`.
   */
  private pointerTarget(clientX: number, clientY: number, item: CatalogueItem, planeY: number, skip: ReadonlySet<string>): { point: Vec2; hint?: Target["hint"] } | null {
    if (this.h.view() === "3d") {
      if (item.placement.type === "onTop") {
        const hit = this.pickItem(clientX, clientY, skip);
        if (hit) return { point: [hit.point.x, hit.point.z], hint: { uid: hit.uid, y: hit.point.y } };
      } else if (item.placement.type === "wall") {
        const hit = this.pickApartment(clientX, clientY);
        if (hit) return { point: [hit.x, hit.z] };
      }
    }
    const p = this.h.planPoint(clientX, clientY, planeY);
    return p ? { point: p } : null;
  }

  private capture(e: PointerEvent): void {
    e.stopImmediatePropagation();
    this.h.canvas.setPointerCapture(e.pointerId);
  }

  // ---- placement sessions ---------------------------------------------------------------------------------

  /** Set up the solver for moving `uid` (an existing item) or placing a new one with that uid. */
  private session(uid: string, item: CatalogueItem, isNew: boolean): Session | undefined {
    const s = this.state;
    const ap = s.data.apartment;
    if (!ap) return undefined;
    const index = indexApartment(ap);
    const lookup = itemLookup(s);
    const doc = s.layout.doc;
    const poses = resolvePoses(doc, lookup, ap.ceilingHeight);
    const moving = new Set(isNew ? [uid] : [uid, ...descendants(doc, uid)]);
    const before = isNew ? new Map<string, Conflict[]>() : layoutConflicts(doc, lookup, index, poses, { only: moving, clearance: false });
    const others = bodiesOf(doc, lookup, poses).filter((b) => !moving.has(b.uid));
    const still: Solid[] = [...index.obstacles, ...others.flatMap((b) => b.solids)];
    const mover: Mover = { item, uid, moving, isNew, before };
    const ctx: PlacementContext = { doc, lookup, ap: index, aids: s.aids, poses };
    return { mover, ctx, still, last: currentAttempt(mover, ctx) };
  }

  /** Conflicts to show during a gesture: the attempt's for the moving items, the layout's for the rest. */
  private conflictView(a: Attempt, moving: ReadonlySet<string>): Map<string, Conflict[]> {
    const out = new Map<string, Conflict[]>();
    for (const [uid, list] of conflictsOf(this.state)) {
      if (moving.has(uid)) continue;
      const kept = list.filter((c) => !(c.other && moving.has(c.other)));
      if (kept.length) out.set(uid, kept);
    }
    for (const [uid, list] of a.conflicts) {
      out.set(uid, [...(out.get(uid) ?? []), ...list]);
      for (const c of list) {
        if (c.kind !== "item" || !c.other || moving.has(c.other)) continue;
        out.set(c.other, [...(out.get(c.other) ?? []), { kind: "item", other: uid, hard: true }]);
      }
    }
    return out;
  }

  /** Show an attempt: the moved poses, conflicts and (if on) the distances of the item. */
  private show(session: Session, a: Attempt): void {
    const uid = session.mover.uid;
    const pose = a.poses.get(uid);
    const placed = a.doc.items.find((p) => p.uid === uid);
    let distances: SideDistance[] = [];
    if (pose && this.state.aids.distances && !placed?.parent) {
      distances = sideDistances(session.mover.item.dimensions, pose, session.still);
    }
    this.h.preview({ doc: a.doc, poses: a.poses, conflicts: this.conflictView(a, session.mover.moving), distances, y: (pose?.y ?? 0) + 1 });
  }

  // ---- pointer --------------------------------------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.gesture || this.h.view() === "walk") return;
    const s = this.state;
    const press: Gesture = { kind: "press", id: e.pointerId, x: e.clientX, y: e.clientY, target: null };
    if (s.placing?.via === "click" || s.tool === "measure") {
      this.gesture = press; // a click places the item or sets a measuring point; a drag still moves the camera
      return;
    }

    const sel = s.selection?.kind === "item" ? s.selection.uid : null;
    if (sel && this.h.overlay.visible && this.h.overlay.hitsHandle(this.h.ray(e.clientX, e.clientY))) {
      if (this.startRotate(e, sel)) return;
    }

    const hit = this.pick(e.clientX, e.clientY);
    if (hit?.kind === "item") {
      s.selectItem(hit.uid);
      if (this.startMove(e, hit.uid, hit.point)) return;
    }
    this.gesture = { ...press, target: hit };
  };

  private startMove(e: PointerEvent, uid: string, point: Vector3): boolean {
    const s = this.state;
    const placed = s.layout.doc.items.find((p) => p.uid === uid);
    const pose = this.h.furniture.pose(uid);
    if (!placed || placed.locked || s.layout.status !== "ready" || !pose) return false;
    const planeY = this.h.view() === "2d" ? 0 : point.y;
    const item = s.catalogue.entries.get(placed.item)?.item;
    const session = item && this.session(uid, item, false);
    const start = item && session ? this.pointerTarget(e.clientX, e.clientY, item, planeY, session.mover.moving) : null;
    const plane = this.h.planPoint(e.clientX, e.clientY, planeY);
    const from = start?.point ?? plane;
    if (!from) return false;
    const base = {
      kind: "move" as const,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      uid,
      moved: false,
      planeY,
      grab: [pose.x - from[0], pose.z - from[1]] as Vec2,
      rotation: pose.rotation,
    };
    if (session) this.gesture = { ...base, session };
    else {
      const parentRotation = placed.parent ? (this.h.furniture.pose(placed.parent.uid)?.rotation ?? null) : null;
      this.gesture = { ...base, raw: { startPos: placed.position, parentRotation, pos: placed.position } };
    }
    this.capture(e);
    return true;
  }

  private startRotate(e: PointerEvent, uid: string): boolean {
    const s = this.state;
    const obj = this.h.furniture.object(uid);
    const placed = s.layout.doc.items.find((p) => p.uid === uid);
    const pose = this.h.furniture.pose(uid);
    const p = obj && this.h.planPoint(e.clientX, e.clientY, obj.position.y);
    if (!obj || !placed || !pose || !p) return false;
    const center: Vec2 = [obj.position.x, obj.position.z];
    const item = s.catalogue.entries.get(placed.item)?.item;
    const parentWorld = placed.parent ? (this.h.furniture.pose(placed.parent.uid)?.rotation ?? 0) : 0;
    this.gesture = {
      kind: "rotate",
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      uid,
      planeY: obj.position.y,
      center,
      startAngle: Math.atan2(p[1] - center[1], p[0] - center[0]) / DEG,
      startWorld: pose.rotation,
      parentWorld,
      base: { position: placed.position, rotation: placed.rotation, parent: placed.parent },
      session: item && this.session(uid, item, false),
      rotation: placed.rotation,
    };
    this.capture(e);
    return true;
  }

  private onMove = (e: PointerEvent): void => {
    const g = this.gesture;
    const s = this.state;
    if (!g || g.kind === "press") {
      if (s.placing?.via === "click") this.updateGhost(e.clientX, e.clientY);
      else if (s.tool === "measure") this.updateMeasure(e.clientX, e.clientY, e.shiftKey, e.altKey);
    }
    if (!g || e.pointerId !== g.id) return;
    if (g.kind === "move") {
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < CLICK_PX) return;
      g.moved = true;
      if (g.session) {
        const t = this.pointerTarget(e.clientX, e.clientY, g.session.mover.item, g.planeY, g.session.mover.moving);
        if (!t) return;
        const target: Target = { point: [t.point[0] + g.grab[0], t.point[1] + g.grab[1]], rotation: g.rotation, hint: t.hint };
        const a = moveTo(g.session.mover, target, g.session.ctx, g.session.last);
        g.session.last = a;
        this.show(g.session, a);
      } else if (g.raw) {
        const p = this.h.planPoint(e.clientX, e.clientY, g.planeY);
        if (!p) return;
        const r = g.raw;
        let pos: Vec2 = [p[0] + g.grab[0], p[1] + g.grab[1]];
        if (r.parentRotation !== null) {
          // relative to the base item
          const base = this.h.furniture.pose(this.state.layout.doc.items.find((x) => x.uid === g.uid)!.parent!.uid)!;
          pos = rotatePlan([pos[0] - base.x, pos[1] - base.z], -r.parentRotation);
        }
        r.pos = pos;
        this.h.furniture.preview(this.h.furniture.previewPoses(new Map([[g.uid, { position: pos }]])));
      }
    } else if (g.kind === "rotate") {
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < CLICK_PX) return;
      g.moved = true;
      const p = this.h.planPoint(e.clientX, e.clientY, g.planeY);
      if (!p) return;
      const angle = Math.atan2(p[1] - g.center[1], p[0] - g.center[0]) / DEG;
      // steps relative to where it started, so an item along a skewed wall stays parallel to it
      const world = g.startWorld + snapTo(angle - g.startAngle, rotationStep(s.aids, e));
      const rotation = world - g.parentWorld;
      g.rotation = rotation;
      if (g.session) {
        const placement = { ...g.base, rotation };
        const a = placeExactly(g.session.mover, placement, { point: g.center, rotation: world }, g.session.ctx, g.session.last);
        g.session.last = a;
        this.show(g.session, a);
      } else {
        this.h.furniture.preview(this.h.furniture.previewPoses(new Map([[g.uid, { rotation }]])));
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    if (this.h.canvas.hasPointerCapture(e.pointerId)) this.h.canvas.releasePointerCapture(e.pointerId);
    const s = this.state;
    if (g.kind === "move" || g.kind === "rotate") {
      const last = g.session?.last;
      // block mode never commits a place where the item runs into something new
      const ok = !!last && !refused(last, g.session!.mover, g.session!.ctx);
      if (g.kind === "move" && g.moved) {
        if (last) {
          if (ok) s.edit((doc) => setPlacement(doc, g.uid, last.solution.placement));
        } else if (g.raw) s.edit((doc) => moveItem(doc, g.uid, g.raw!.pos));
      }
      if (g.kind === "rotate" && g.moved) {
        if (last) {
          if (ok) s.edit((doc) => setPlacement(doc, g.uid, last.solution.placement));
        } else if (!g.session) s.edit((doc) => setRotation(doc, g.uid, g.rotation));
      }
      this.endPreview();
      return;
    }
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > CLICK_PX) return; // the camera was dragged
    if (s.placing?.via === "click") {
      this.place();
      return;
    }
    if (s.tool === "measure") {
      this.measureClick(e.clientX, e.clientY, e.shiftKey, e.altKey);
      return;
    }
    if (!g.target) s.select(null);
    else if (g.target.kind === "element") s.selectElement(g.target.id);
    else s.selectItem(g.target.uid);
  };

  /** Back to the layout's poses (the commit, if any, has already been synced). */
  private endPreview(): void {
    this.h.furniture.reset();
    this.h.preview(null);
  }

  private cancel(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (this.h.canvas.hasPointerCapture(g.id)) this.h.canvas.releasePointerCapture(g.id);
    if (g.kind !== "press") this.endPreview();
  }

  /**
   * The layout changed while the pointer was down (undo, a keyboard edit, a reload from disk): drop the gesture
   * rather than commit it on top of a document it wasn't started on. A preview being placed is re-solved.
   */
  layoutChanged(): void {
    if (this.gesture && this.gesture.kind !== "press") this.cancel();
    const ghost = this.ghost;
    if (ghost?.built.root.visible && ghost.pointer) this.updateGhost(ghost.pointer.x, ghost.pointer.y);
  }

  private onCancel = (): void => this.cancel();

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this.gesture && this.gesture.kind !== "press") {
      e.stopImmediatePropagation();
      this.cancel();
    } else if (this.state.tool === "measure") {
      e.stopImmediatePropagation();
      if (this.measureStart) this.resetMeasure();
      else this.state.setTool("select");
    }
  };

  private onLeave = (): void => {
    if (this.state.placing?.via === "click") this.hideGhost();
    if (this.state.tool === "measure") this.drawMeasure(undefined);
  };

  // ---- tape measure ---------------------------------------------------------------------------------------

  /** The tool changed (or the view): forget a half-finished measurement. */
  setTool(): void {
    this.resetMeasure();
    this.h.canvas.style.cursor = this.state.tool === "measure" ? "crosshair" : "";
  }

  private resetMeasure(): void {
    this.measureStart = undefined;
    this.drawMeasure(undefined);
  }

  private measureTargets(): MeasureTargets {
    const s = this.state;
    const key = [s.layout.doc, s.data.apartment, s.catalogue] as const;
    if (this.targets && this.targets.key.every((k, i) => k === key[i])) return this.targets.targets;
    const ap = s.data.apartment;
    const index = ap ? indexApartment(ap) : undefined;
    const corners: Vec2[] = [...(index?.corners ?? [])];
    const edges: [Vec2, Vec2][] = [...(index?.edges ?? [])];
    const lookup = itemLookup(s);
    for (const p of s.layout.doc.items) {
      const item = lookup(p.item);
      const pose = this.h.furniture.pose(p.uid);
      if (!item || !pose || p.hidden) continue;
      const rect = worldRect(item, pose);
      corners.push(...rect);
      rect.forEach((c, i) => edges.push([c, rect[(i + 1) % 4]]));
    }
    const targets = { corners, edges };
    this.targets = { key, targets };
    return targets;
  }

  /** The measuring point under the pointer: snapped (unless Alt), on an axis from the first point with Shift. */
  private measurePoint(clientX: number, clientY: number, shift: boolean, alt: boolean): { p: [number, number, number]; snap: MeasureSnap["kind"] } | null {
    const is2d = this.h.view() === "2d";
    let y = 0;
    let raw: Vec2 | null;
    if (is2d) raw = this.h.planPoint(clientX, clientY, 0);
    else {
      const hit = this.pick(clientX, clientY);
      if (hit) {
        raw = [hit.point.x, hit.point.z];
        y = hit.point.y;
      } else raw = this.h.planPoint(clientX, clientY, 0);
    }
    if (!raw) return null;
    let snap: MeasureSnap = { point: raw, kind: "free" };
    if (!alt) snap = snapMeasurePoint(raw, this.measureTargets(), is2d ? SNAP_PX * this.h.cmPerPx() : SNAP_CM_3D);
    let point = snap.point;
    if (shift && this.measureStart) {
      point = constrainToAxis([this.measureStart[0], this.measureStart[2]], point);
      snap = { point, kind: "free" };
    }
    return { p: [point[0], is2d ? 0 : y, point[1]], snap: snap.kind };
  }

  private updateMeasure(clientX: number, clientY: number, shift: boolean, alt: boolean): void {
    const m = this.measurePoint(clientX, clientY, shift, alt);
    this.drawMeasure(m ?? undefined);
  }

  private measureClick(clientX: number, clientY: number, shift: boolean, alt: boolean): void {
    const m = this.measurePoint(clientX, clientY, shift, alt);
    if (!m) return;
    if (!this.measureStart) {
      this.measureStart = m.p;
    } else {
      this.state.addMeasurement({ a: this.measureStart, b: m.p });
      this.measureStart = undefined;
    }
    this.drawMeasure(m);
  }

  private drawMeasure(m: { p: [number, number, number]; snap: MeasureSnap["kind"] } | undefined): void {
    const o = this.h.measureLive;
    o.clear();
    const size = this.h.view() === "2d" ? 4 * this.h.cmPerPx() : 2.5;
    if (m) o.marker(lift(m.p, this.h.view()), size * (m.snap === "free" ? 0.7 : 1.6), m.snap !== "free");
    const a = this.measureStart;
    if (a && m) {
      const len = Math.hypot(m.p[0] - a[0], m.p[1] - a[1], m.p[2] - a[2]);
      o.segment(lift(a, this.h.view()), lift(m.p, this.h.view()), formatLength(len), size * 0.7);
    } else if (a) {
      o.marker(lift(a, this.h.view()), size * 0.7, false);
    }
    this.h.requestRender();
  }

  // ---- placing new items ----------------------------------------------------------------------------------

  /** Follow the store's `placing`: create, rotate or remove the preview. `rebuild` after catalogue/material changes. */
  setPlacing(placing: Placing | null, rebuild = false): void {
    if (!placing || rebuild || this.ghost?.itemId !== placing.itemId) this.removeGhost();
    if (!placing) return;
    this.ghost ??= this.buildGhost(placing.itemId);
    const pointer = this.ghost?.pointer;
    if (pointer && this.ghost?.built.root.visible) this.updateGhost(pointer.x, pointer.y);
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
    const item = s.placing && s.catalogue.entries.get(s.placing.itemId)?.item;
    if (!s.placing || !ghost || !item) return;
    ghost.pointer = { x: clientX, y: clientY };
    const uid = nextUid(s.layout.doc, item.id);
    const session = this.session(uid, item, true);
    const t = session && this.pointerTarget(clientX, clientY, item, 0, session.mover.moving);
    if (!session || !t) return this.hideGhost();
    const a = moveTo(session.mover, { point: t.point, rotation: s.placing.rotation, hint: t.hint }, session.ctx);
    ghost.attempt = a;
    const pose = a.poses.get(uid);
    if (!pose) return this.hideGhost();
    applyPose(ghost.built.root, pose);
    applyTint(ghost.built.root, a.blocked ? "hard" : conflictLevel(a.conflicts.get(uid)));
    ghost.built.root.visible = true;
    this.show(session, a);
    this.h.requestRender();
  }

  private hideGhost(): void {
    if (this.ghost?.built.root.visible) {
      this.ghost.built.root.visible = false;
      this.ghost.attempt = undefined;
      this.h.preview(null);
      this.h.requestRender();
    }
  }

  private removeGhost(): void {
    const g = this.ghost;
    if (!g) return;
    const shown = g.built.root.visible;
    g.built.root.removeFromParent();
    g.built.dispose();
    for (const c of g.clones.values()) c.dispose();
    this.ghost = undefined;
    if (shown) this.h.preview(null);
    this.h.requestRender();
  }

  /** Add the item that is being placed where its preview is, select it and stop placing. */
  private place(): void {
    const s = this.state;
    const a = this.ghost?.attempt;
    const placing = s.placing;
    if (!placing || !a || !this.ghost?.built.root.visible) return;
    if (a.blocked) return; // block mode: it doesn't fit there
    const uid = nextUid(s.layout.doc, placing.itemId);
    const p = a.solution.placement;
    if (s.edit((doc) => addItem(doc, { uid, item: placing.itemId, position: p.position, rotation: p.rotation, ...(p.parent ? { parent: p.parent } : {}) }))) {
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
    this.updateGhost(e.clientX, e.clientY);
    this.place();
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

/** In 2D, draw measuring lines above everything else (the plan camera looks down from the ceiling). */
const lift = (p: readonly [number, number, number], view: ViewMode): [number, number, number] => (view === "2d" ? [p[0], 300, p[2]] : [p[0], p[1], p[2]]);
