/**
 * The 3D engine facade. Owns the renderer, the scene and the views (2D plan, 3D orbit, first-person walk).
 * It reads everything from the store and writes back only user intents (selection, layout commands).
 * A read-only engine shows another layout next to the working one (comparing); the two cameras move together.
 */
import {
  Color,
  NeutralToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Mesh,
  type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { DOOR_OPEN, emptyLayout } from "../core/layout/commands";
import { resolvePoses, type WorldPose } from "../core/layout/poses";
import { indexApartment, shownOpening } from "../core/placement/apartment";
import { clearanceZones, type Conflict } from "../core/placement/collisions";
import type { Solid } from "../core/placement/shapes";
import type { Vec2 } from "../core/schema/common";
import type { LayoutFile, LayoutSurfaces } from "../core/schema/layout";
import { apartmentSun } from "../core/sun";
import { standClear, walkSolids, walkStart, walkStep } from "../core/walk";
import type { DataSnapshot } from "../data/snapshot";
import { conflictLevel, conflictsOf, itemLookup } from "../state/derived";
import type { AppState, AppStore, ViewMode } from "../state/store";
import { buildApartment, type ApartmentBuild } from "./builders/apartment";
import { setLeafOpening } from "./builders/openings";
import { Interaction, type Preview } from "./interaction";
import { UNKNOWN_SIZE } from "./items/buildItem";
import { FurnitureLayer } from "./items/FurnitureLayer";
import type { ModelLibrary } from "./items/models";
import { configureCameraLayers } from "./layers";
import { Lights, type SunLight } from "./lighting";
import { isSeeThrough, MaterialLibrary } from "./materials/MaterialLibrary";
import { ClearanceOverlay, type ZoneView } from "./overlays/clearance";
import { DimensionOverlay } from "./overlays/dimension";
import { Highlight } from "./overlays/highlight";
import { formatLength, LineOverlay } from "./overlays/lines";
import { SelectionOverlay } from "./overlays/selection";
import type { TintLevel } from "./overlays/tint";
import { UnderlayOverlay } from "./overlays/underlay";
import { PlanControls } from "./views/PlanControls";
import { WalkControls } from "./views/WalkControls";

const BACKGROUND: Record<ViewMode, string> = { "2d": "#f4f3ef", "3d": "#dde2e7", walk: "#dde2e7" };
const DEG = Math.PI / 180;
const NO_LAYOUT = emptyLayout();

export interface EngineOptions {
  /** The layout to show (default: the working layout); null shows the apartment without furniture. */
  doc?: (s: AppState) => LayoutFile | null;
  /** Only look (the other side of a comparison): no selecting, moving, placing, measuring or walking. */
  readOnly?: boolean;
}

/** Where the cameras are; only views that have been set up are included. */
export interface CameraState {
  plan?: { x: number; z: number; cmPerPx: number };
  orbit?: { target: [number, number, number]; position: [number, number, number] };
  walk?: { position: Vec2; yaw: number; pitch: number };
}

export class Engine {
  /** Called when this engine's camera moves (the other side of a comparison follows). */
  onCameraChange?: (state: CameraState) => void;
  private readonly renderer: WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly planCamera = new OrthographicCamera();
  private readonly orbitCamera = new PerspectiveCamera(50, 1, 5, 60_000);
  private readonly walkCamera = new PerspectiveCamera(70, 1, 5, 60_000);
  private readonly plan: PlanControls;
  private readonly orbit: OrbitControls;
  private readonly walk: WalkControls;
  private readonly lights = new Lights();
  private readonly highlight = new Highlight();
  private readonly dimension = new DimensionOverlay();
  private readonly selection = new SelectionOverlay();
  private readonly clearance = new ClearanceOverlay();
  private readonly distances = new LineOverlay("distances", "#2f6fd0", "dist-label", 1.5);
  private readonly measurements = new LineOverlay("measurements", "#00897b", "measure-label", 2.5);
  private readonly measureLive = new LineOverlay("measure-live", "#00897b", "measure-label measure-label--live", 2, true);
  private readonly underlay: UnderlayOverlay;
  private readonly furniture: FurnitureLayer;
  private readonly interaction?: Interaction;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;
  private readonly readOnly: boolean;
  private mats?: MaterialLibrary;
  private build?: ApartmentBuild;
  /** The layout's surfaces the apartment was built with. */
  private builtSurfaces?: LayoutSurfaces;
  private view: ViewMode;
  private readonly fitted = new Set<ViewMode>();
  /** Views whose camera the user moved; they are no longer re-fitted on resize. */
  private readonly adjusted = new Set<ViewMode>();
  private dirty = true;
  private frame = 0;
  private lastFrame = 0;
  private labelsOn = true;
  /** A gesture shows its own poses, conflicts and zones. */
  private previewing = false;
  /** 2D zoom the tape-measure lines were drawn for. */
  private measurementScale = 0;
  /** Set while copying the other engine's camera, so the change isn't sent back. */
  private syncing = false;
  private walkCache?: { key: readonly unknown[]; solids: Solid[] };

  constructor(
    private readonly container: HTMLElement,
    private readonly store: AppStore,
    models: ModelLibrary,
    private readonly options: EngineOptions = {},
  ) {
    this.readOnly = !!options.readOnly;
    const r = new WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = NeutralToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.domElement.className = "viewport-canvas";
    this.labels.domElement.className = "viewport-labels";
    container.append(r.domElement, this.labels.domElement);
    this.renderer = r;
    models.attachRenderer(r);

    this.underlay = new UnderlayOverlay(() => this.requestRender());
    this.furniture = new FurnitureLayer(models, () => {
      this.applySelection(this.store.getState());
      this.requestRender();
    });
    this.scene.add(
      this.lights.group,
      this.furniture.group,
      this.highlight.group,
      this.dimension.group,
      this.selection.group,
      this.underlay.group,
      this.clearance.group,
      this.distances.group,
      this.measurements.group,
      this.measureLive.group,
    );
    configureCameraLayers(this.planCamera, "2d");
    configureCameraLayers(this.orbitCamera, "3d");
    configureCameraLayers(this.walkCamera, "3d");

    // furniture interaction first: its capture-phase listener keeps presses on items away from the camera controls
    if (!this.readOnly) {
      this.interaction = new Interaction({
        canvas: r.domElement,
        container,
        store,
        scene: this.scene,
        furniture: this.furniture,
        overlay: this.selection,
        models,
        measureLive: this.measureLive,
        view: () => this.view,
        ray: (x, y) => this.ray(x, y),
        planPoint: (x, y, h) => this.planPoint(x, y, h),
        cmPerPx: () => this.plan.cmPerPx,
        apartmentRoot: () => this.build?.root,
        materials: () => this.mats,
        preview: (p) => this.preview(p),
        requestRender: () => this.requestRender(),
      });
    }
    this.plan = new PlanControls(
      this.planCamera,
      r.domElement,
      () => {
        this.requestRender();
        this.cameraMoved();
      },
      () => this.adjusted.add("2d"),
    );
    this.orbit = new OrbitControls(this.orbitCamera, r.domElement);
    this.orbit.screenSpacePanning = true;
    this.orbit.zoomToCursor = true;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 30;
    this.orbit.maxDistance = 8000;
    this.orbit.addEventListener("change", () => {
      this.requestRender();
      this.cameraMoved();
    });
    this.orbit.addEventListener("start", () => this.adjusted.add("3d"));
    this.walk = new WalkControls(this.walkCamera, r.domElement, {
      move: (from, delta) => walkStep(from, delta, this.walkSolids()),
      eyeHeight: () => this.store.getState().walk.eyeHeight,
      onChange: () => {
        this.requestRender();
        this.cameraMoved();
      },
      onExit: () => this.store.getState().setView("3d"),
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const s = store.getState();
    this.view = s.view;
    this.applyView();
    this.applyData(s.data);
    this.syncFurniture(s);
    this.applyDisplay(s);
    this.applySelection(s);
    this.applyAids(s);
    this.drawMeasurements(s);
    this.interaction?.setPlacing(s.placing);
    this.interaction?.setTool();
    this.unsubscribe = store.subscribe((next, prev) => this.onState(next, prev));
    if (import.meta.env.DEV) (window as unknown as Record<string, Engine>)[this.readOnly ? "__compareEngine" : "__engine"] = this; // for the browser console
    this.loop();
  }

  requestRender = (): void => {
    this.dirty = true;
  };

  private get camera(): Camera {
    return this.view === "2d" ? this.planCamera : this.view === "walk" ? this.walkCamera : this.orbitCamera;
  }

  /** The layout this engine shows. */
  private doc(s: AppState): LayoutFile {
    return this.options.doc ? (this.options.doc(s) ?? NO_LAYOUT) : s.layout.doc;
  }

  private onState(s: AppState, prev: AppState): void {
    const doc = this.doc(s);
    const prevDoc = this.doc(prev);
    const docChanged = doc !== prevDoc;
    const dataChanged = s.data !== prev.data;
    if (dataChanged) this.applyData(s.data);
    else if (doc.surfaces !== this.builtSurfaces) this.rebuildApartment(s);
    else if (doc.doors !== prevDoc.doors) this.applyDoors(doc);
    if (docChanged) this.interaction?.layoutChanged();
    if (s.view !== prev.view) {
      this.view = s.view;
      this.applyView();
    }
    if (dataChanged || s.daylight !== prev.daylight || s.view !== prev.view) this.applyLighting(s);
    if (s.walk !== prev.walk && this.view === "walk") this.walk.apply();
    const furnitureChanged = dataChanged || docChanged || s.catalogue !== prev.catalogue;
    if (furnitureChanged) this.syncFurniture(s);
    if (dataChanged || s.placing !== prev.placing || s.catalogue !== prev.catalogue) {
      this.interaction?.setPlacing(s.placing, dataChanged || s.catalogue !== prev.catalogue);
    }
    if (furnitureChanged || s.aids !== prev.aids) this.applyAids(s);
    if (s.tool !== prev.tool || s.view !== prev.view) this.interaction?.setTool();
    if (s.measurements !== prev.measurements || s.view !== prev.view) this.drawMeasurements(s);
    if (s.underlay !== prev.underlay || s.labels !== prev.labels || s.view !== prev.view) this.applyDisplay(s);
    if (
      dataChanged ||
      docChanged ||
      s.selection !== prev.selection ||
      s.activeCheck !== prev.activeCheck ||
      s.layout !== prev.layout ||
      s.catalogue !== prev.catalogue ||
      s.view !== prev.view
    ) {
      this.applySelection(s);
    }
    if (s.fitRequest !== prev.fitRequest) this.fit();
    this.requestRender();
  }

  private applyData(data: DataSnapshot): void {
    this.build?.dispose();
    this.furniture.setMaterials(undefined);
    this.mats?.dispose();
    this.build = undefined;
    this.mats = undefined;
    const ap = data.apartment;
    if (!ap) {
      this.underlay.set(undefined, data.version, 0);
      return;
    }
    this.mats = new MaterialLibrary(data.materials, {
      anisotropy: this.renderer.capabilities.getMaxAnisotropy(),
      onLoad: this.requestRender,
    });
    this.furniture.setMaterials(this.mats);
    this.rebuildApartment(this.store.getState());
    this.underlay.set(ap.underlay, data.version, ap.ceilingHeight + 20);
    if (!this.fitted.has(this.view)) this.fit();
  }

  /** (Re)build the apartment with the layout's wall colours and floors. */
  private rebuildApartment(s: AppState): void {
    const ap = s.data.apartment;
    const doc = this.doc(s);
    this.builtSurfaces = doc.surfaces;
    if (!ap || !this.mats) return;
    this.build?.dispose();
    this.build = buildApartment(ap, this.mats, doc.surfaces);
    this.scene.add(this.build.root);
    this.lights.fit(this.build.bounds);
    this.applyDoors(doc);
    this.applyLighting(s);
  }

  /** Show the doors as far open as the layout says (display only), but never further than a door opens. */
  private applyDoors(doc: LayoutFile): void {
    const ap = this.store.getState().data.apartment;
    const index = ap ? indexApartment(ap) : undefined;
    for (const [id, leaves] of this.build?.doors ?? []) {
      const deg = index ? shownOpening(index, doc.doors, id) : (doc.doors?.[id] ?? DOOR_OPEN);
      for (const leaf of leaves) setLeafOpening(leaf, deg);
    }
    this.requestRender();
  }

  private sunLight(s: AppState): SunLight | null {
    const ap = s.data.apartment;
    if (!s.daylight.on || !ap) return null;
    const { sun, direction } = apartmentSun(ap, s.daylight.date, s.daylight.minutes);
    return { direction, altitude: sun.altitude };
  }

  private applyLighting(s: AppState): void {
    const day = this.sunLight(s);
    this.lights.set(this.view, day);
    for (const c of this.build?.ceilings ?? []) c.castShadow = !!day;
    const sky = this.view !== "2d" ? this.lights.sky() : null;
    this.scene.background = sky ?? new Color(BACKGROUND[this.view]);
    this.requestRender();
  }

  private syncFurniture(s: AppState): void {
    this.furniture.sync({
      doc: this.doc(s),
      catalogue: s.catalogue,
      presets: s.data.materials,
      ceilingHeight: s.data.apartment?.ceilingHeight ?? 250,
    });
  }

  /** Conflict tints and clearance zones of the layout (unless a gesture shows its own). */
  private applyAids(s: AppState): void {
    if (this.previewing) return;
    const doc = this.doc(s);
    const conflicts = conflictsOf(s, doc);
    this.furniture.setTints(this.tintsOf(conflicts));
    this.showZones(doc, this.furniture.layoutPoses(), conflicts);
  }

  private tintsOf(conflicts: ReadonlyMap<string, readonly Conflict[]>): Map<string, TintLevel> {
    const tints = new Map<string, TintLevel>();
    for (const [uid, list] of conflicts) {
      const level = conflictLevel(list);
      if (level) tints.set(uid, level);
    }
    return tints;
  }

  private showZones(doc: LayoutFile, poses: ReadonlyMap<string, WorldPose>, conflicts: ReadonlyMap<string, readonly Conflict[]>): void {
    const s = this.store.getState();
    if (!s.aids.clearance) return this.clearance.clear();
    const lookup = itemLookup(s);
    const zones: ZoneView[] = [];
    for (const p of doc.items) {
      const item = lookup(p.item);
      const pose = poses.get(p.uid);
      if (!item?.clearance || !pose || p.hidden) continue;
      const blocked = new Set((conflicts.get(p.uid) ?? []).filter((c) => c.kind === "clearance").map((c) => c.side));
      for (const z of clearanceZones(item, pose)) zones.push({ poly: z.solid.poly, y: pose.y, blocked: blocked.has(z.side) });
    }
    this.clearance.show(zones);
  }

  /** Show the scene as a gesture would leave it (null: as the layout is). */
  private preview(p: Preview | null): void {
    const s = this.store.getState();
    if (!p) {
      this.previewing = false;
      this.distances.clear();
      this.applyAids(s);
      this.requestRender();
      return;
    }
    this.previewing = true;
    this.furniture.preview(p.poses);
    this.furniture.setTints(this.tintsOf(p.conflicts));
    this.showZones(p.doc, p.poses, p.conflicts);
    this.distances.clear();
    const y = this.view === "2d" ? 300 : p.y;
    for (const d of p.distances) this.distances.segment([d.from[0], y, d.from[1]], [d.to[0], y, d.to[1]], formatLength(d.length), this.dotSize() * 0.6);
    this.requestRender();
  }

  /** Size of line end dots: a few pixels in 2D, cm in 3D. */
  private dotSize(): number {
    return this.view === "2d" ? 4 * this.plan.cmPerPx : 2.5;
  }

  private drawMeasurements(s: AppState): void {
    this.measurements.clear();
    this.measurementScale = this.plan.cmPerPx;
    for (const m of s.measurements) {
      const lift = (p: readonly [number, number, number]): [number, number, number] => (this.view === "2d" ? [p[0], 300, p[2]] : [p[0], p[1], p[2]]);
      const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]);
      this.measurements.segment(lift(m.a), lift(m.b), formatLength(len), this.dotSize() * 0.7);
    }
    this.requestRender();
  }

  private applyView(): void {
    const v = this.view;
    this.plan.enabled = v === "2d";
    this.orbit.enabled = v === "3d";
    this.walk.enabled = v === "walk" && !this.readOnly;
    if (v === "walk") {
      if (!this.walk.started) this.startWalk();
      else {
        // something may have been put where you stood
        this.walk.position = standClear(this.walk.position, this.walkSolids());
        this.walk.apply();
      }
    } else if (!this.fitted.has(v)) this.fit();
  }

  /** Stand just inside the entrance door. */
  private startWalk(): void {
    const ap = this.store.getState().data.apartment;
    if (!ap) return;
    const start = walkStart(ap);
    this.walk.place(standClear(start.position, this.walkSolids()), start.facing);
  }

  /** What stops you while walking (cached until the apartment, the layout or the walk settings change). */
  private walkSolids(): Solid[] {
    const s = this.store.getState();
    const ap = s.data.apartment;
    if (!ap) return [];
    const doc = this.doc(s);
    const key = [ap, doc, s.catalogue, s.walk.furniture, s.walk.eyeHeight];
    if (!this.walkCache || this.walkCache.key.some((k, i) => k !== key[i])) {
      const lookup = itemLookup(s);
      this.walkCache = { key, solids: walkSolids(ap, doc, lookup, resolvePoses(doc, lookup, ap.ceilingHeight), s.walk) };
    }
    return this.walkCache.solids;
  }

  private applyDisplay(s: AppState): void {
    this.underlay.setDisplay(s.underlay.visible, s.underlay.opacity);
    this.labelsOn = s.labels;
  }

  /** Room labels are HTML on top of the canvas; in 3D hide those behind walls, while walking all of them. */
  private updateLabels(): void {
    const labels = this.build?.labels ?? [];
    if (this.view === "walk") {
      for (const l of labels) l.visible = false;
      return;
    }
    if (!this.build || !this.labelsOn || this.view === "2d") {
      for (const l of labels) l.visible = this.labelsOn;
      return;
    }
    const eye = this.orbitCamera.position;
    const rc = new Raycaster();
    rc.layers.mask = this.orbitCamera.layers.mask;
    for (const l of labels) {
      const dir = l.position.clone().sub(eye);
      const dist = dir.length();
      rc.set(eye, dir.normalize());
      rc.far = Math.max(0, dist - 10);
      l.visible = !rc.intersectObject(this.build.root, true).some((h) => {
        const m = (h.object as Mesh).material;
        return !!m && !isSeeThrough(m);
      });
    }
  }

  /** Highlight the selection and the active check's elements; show the selected item's outline and rotate ring. */
  private applySelection(s: AppState): void {
    const element = (id: string | null | undefined): Object3D[] => {
      const o = id ? this.build?.elements.get(id) : undefined;
      return o ? [o] : [];
    };
    const sel = s.selection;
    const selected = sel?.kind === "element" ? element(sel.id) : [];
    // furniture isn't tinted (that would hide the material you just picked); the selection box marks it instead
    const item = sel?.kind === "item" && !this.readOnly && this.view !== "walk" ? this.furniture.object(sel.uid) : undefined;
    const check = s.data.apartment?.checks?.find((c) => c.id === s.activeCheck);
    this.highlight.set(selected, (check?.refs ?? []).flatMap(element));
    this.dimension.show(check);

    const placed = sel?.kind === "item" ? s.layout.doc.items.find((p) => p.uid === sel.uid) : undefined;
    // room labels sit on top of the canvas: fade them so they don't hide the selected item and its handles
    this.labels.domElement.classList.toggle("viewport-labels--faded", !!(item && placed));
    if (!item || !placed) {
      this.selection.hide();
      return;
    }
    const size = s.catalogue.entries.get(placed.item)?.item.dimensions ?? { width: UNKNOWN_SIZE, depth: UNKNOWN_SIZE, height: UNKNOWN_SIZE };
    // the object's current transform: follows previews while dragging or rotating
    const pose = { x: item.position.x, y: item.position.y, z: item.position.z, rotation: -item.rotation.y / DEG };
    // wall items always face away from their wall
    const wallItem = s.catalogue.entries.get(placed.item)?.item.placement.type === "wall";
    const rotatable = !placed.locked && s.layout.status === "ready" && !wallItem;
    this.selection.show(pose, size, rotatable, this.view === "2d" ? this.plan.cmPerPx : 0);
  }

  /** Frame the whole apartment in the active view (walking: back to the entrance). */
  fit(): void {
    if (!this.build) return;
    if (this.view === "walk") {
      this.startWalk();
      return;
    }
    this.fitted.add(this.view);
    this.adjusted.delete(this.view);
    const b = this.build.bounds;
    if (this.view === "2d") {
      this.plan.fit(b);
    } else {
      const c = b.getCenter(new Vector3());
      const size = b.getSize(new Vector3());
      const radius = Math.hypot(size.x, size.z) / 2;
      const fov = (this.orbitCamera.fov * Math.PI) / 180;
      const fitH = radius / Math.tan(fov / 2);
      const fitW = fitH / Math.max(0.5, Math.min(1, this.orbitCamera.aspect));
      const dist = Math.max(fitH, fitW) * 0.95;
      this.orbit.target.set(c.x, 0, c.z);
      this.orbitCamera.position.set(c.x, 0, c.z).add(new Vector3(0.25, 1.7, 0.75).normalize().multiplyScalar(dist));
      this.orbit.update();
    }
    this.requestRender();
  }

  // ---- linked cameras (comparing two layouts) ---------------------------------------------------------------

  cameraState(): CameraState {
    const out: CameraState = {};
    if (this.fitted.has("2d")) out.plan = { x: this.plan.center.x, z: this.plan.center.y, cmPerPx: this.plan.cmPerPx };
    if (this.fitted.has("3d")) out.orbit = { target: this.orbit.target.toArray(), position: this.orbitCamera.position.toArray() };
    if (this.walk.started) out.walk = { position: [this.walk.position[0], this.walk.position[1]], yaw: this.walk.yaw, pitch: this.walk.pitch };
    return out;
  }

  /** Move the cameras to `state` (another engine's) without reporting it back. */
  setCameraState(state: CameraState): void {
    this.syncing = true;
    try {
      if (state.plan) {
        this.plan.center.set(state.plan.x, state.plan.z);
        this.plan.cmPerPx = state.plan.cmPerPx;
        this.plan.update();
        this.fitted.add("2d");
        this.adjusted.add("2d");
      }
      if (state.orbit) {
        this.orbit.target.fromArray(state.orbit.target);
        this.orbitCamera.position.fromArray(state.orbit.position);
        this.orbit.update();
        this.fitted.add("3d");
        this.adjusted.add("3d");
      }
      if (state.walk) {
        this.walk.place(state.walk.position, [0, -1]);
        this.walk.yaw = state.walk.yaw;
        this.walk.pitch = state.walk.pitch;
        this.walk.apply();
      }
    } finally {
      this.syncing = false;
    }
    this.requestRender();
  }

  private cameraMoved(): void {
    if (!this.syncing && this.onCameraChange) this.onCameraChange(this.cameraState());
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.plan.setSize(w, h);
    for (const cam of [this.orbitCamera, this.walkCamera]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.dimension.setResolution(w, h);
    for (const o of [this.distances, this.measurements, this.measureLive]) o.setResolution(w, h);
    if (this.fitted.has(this.view) && !this.adjusted.has(this.view)) this.fit();
    this.requestRender();
  }

  /** Ray from the active camera through a point on the screen. */
  private ray(clientX: number, clientY: number): Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new Raycaster();
    rc.setFromCamera(ndc, this.camera);
    rc.layers.mask = this.camera.layers.mask;
    rc.params.Line.threshold = this.view === "2d" ? 3 * this.plan.cmPerPx : 3;
    return rc;
  }

  /** Plan point under the pointer on the horizontal plane at height `y`. */
  private planPoint(clientX: number, clientY: number, y: number): Vec2 | null {
    if (this.view === "2d") {
      const p = this.plan.toPlan(clientX, clientY);
      return [p.x, p.y];
    }
    const hit = this.ray(clientX, clientY).ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
    if (!hit || hit.distanceTo(this.camera.position) > 20_000) return null; // towards the horizon
    return [hit.x, hit.z];
  }

  private loop = (now = performance.now()): void => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (this.view === "walk") this.walk.update(dt);
    if (this.view === "2d" && this.measurementScale !== this.plan.cmPerPx && this.store.getState().measurements.length) {
      this.drawMeasurements(this.store.getState()); // keep the end dots the same size on screen
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (this.view === "2d") this.selection.setScale(this.plan.cmPerPx);
      this.updateLabels();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    } catch (err) {
      console.error("Rendering failed", err); // retried on the next change
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    const w = window as unknown as Record<string, Engine | undefined>;
    for (const k of ["__engine", "__compareEngine"]) if (w[k] === this) delete w[k];
    this.onCameraChange = undefined;
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.interaction?.dispose();
    this.plan.dispose();
    this.orbit.dispose();
    this.walk.dispose();
    this.furniture.dispose();
    this.build?.dispose();
    this.mats?.dispose();
    this.underlay.dispose();
    this.highlight.dispose();
    this.dimension.dispose();
    this.selection.dispose();
    this.clearance.dispose();
    for (const o of [this.distances, this.measurements, this.measureLive]) o.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
