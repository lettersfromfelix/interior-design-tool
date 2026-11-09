/**
 * The 3D engine facade. Owns the renderer, the scene and both views (2D plan, 3D orbit).
 * It reads everything from the store and writes back only user intents (selection, layout commands).
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
import type { Vec2 } from "../core/schema/common";
import type { DataSnapshot } from "../data/snapshot";
import type { AppState, AppStore, ViewMode } from "../state/store";
import { buildApartment, type ApartmentBuild } from "./builders/apartment";
import { Interaction } from "./interaction";
import { UNKNOWN_SIZE } from "./items/buildItem";
import { FurnitureLayer } from "./items/FurnitureLayer";
import type { ModelLibrary } from "./items/models";
import { configureCameraLayers } from "./layers";
import { Lights } from "./lighting";
import { isSeeThrough, MaterialLibrary } from "./materials/MaterialLibrary";
import { DimensionOverlay } from "./overlays/dimension";
import { Highlight } from "./overlays/highlight";
import { SelectionOverlay } from "./overlays/selection";
import { UnderlayOverlay } from "./overlays/underlay";
import { PlanControls } from "./views/PlanControls";

const BACKGROUND: Record<ViewMode, string> = { "2d": "#f4f3ef", "3d": "#dde2e7" };
const DEG = Math.PI / 180;

export class Engine {
  private readonly renderer: WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly planCamera = new OrthographicCamera();
  private readonly orbitCamera = new PerspectiveCamera(50, 1, 5, 60_000);
  private readonly plan: PlanControls;
  private readonly orbit: OrbitControls;
  private readonly lights = new Lights();
  private readonly highlight = new Highlight();
  private readonly dimension = new DimensionOverlay();
  private readonly selection = new SelectionOverlay();
  private readonly underlay: UnderlayOverlay;
  private readonly furniture: FurnitureLayer;
  private readonly interaction: Interaction;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;
  private mats?: MaterialLibrary;
  private build?: ApartmentBuild;
  private view: ViewMode;
  private readonly fitted = new Set<ViewMode>();
  /** Views whose camera the user moved; they are no longer re-fitted on resize. */
  private readonly adjusted = new Set<ViewMode>();
  private dirty = true;
  private frame = 0;
  private labelsOn = true;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: AppStore,
    models: ModelLibrary,
  ) {
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
    );
    configureCameraLayers(this.planCamera, "2d");
    configureCameraLayers(this.orbitCamera, "3d");

    // furniture interaction first: its capture-phase listener keeps presses on items away from the camera controls
    this.interaction = new Interaction({
      canvas: r.domElement,
      container,
      store,
      scene: this.scene,
      furniture: this.furniture,
      overlay: this.selection,
      models,
      view: () => this.view,
      ray: (x, y) => this.ray(x, y),
      planPoint: (x, y, h) => this.planPoint(x, y, h),
      apartmentRoot: () => this.build?.root,
      materials: () => this.mats,
      requestRender: () => this.requestRender(),
    });
    this.plan = new PlanControls(
      this.planCamera,
      r.domElement,
      () => this.requestRender(),
      () => this.adjusted.add("2d"),
    );
    this.orbit = new OrbitControls(this.orbitCamera, r.domElement);
    this.orbit.screenSpacePanning = true;
    this.orbit.zoomToCursor = true;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 30;
    this.orbit.maxDistance = 8000;
    this.orbit.addEventListener("change", () => this.requestRender());
    this.orbit.addEventListener("start", () => this.adjusted.add("3d"));

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
    this.interaction.setPlacing(s.placing);
    this.unsubscribe = store.subscribe((next, prev) => this.onState(next, prev));
    if (import.meta.env.DEV) (window as unknown as { __engine?: Engine }).__engine = this; // for debugging in the browser console
    this.loop();
  }

  requestRender = (): void => {
    this.dirty = true;
  };

  private get camera(): Camera {
    return this.view === "2d" ? this.planCamera : this.orbitCamera;
  }

  private onState(s: AppState, prev: AppState): void {
    const dataChanged = s.data !== prev.data;
    if (dataChanged) this.applyData(s.data);
    if (s.view !== prev.view) {
      this.view = s.view;
      this.applyView();
    }
    if (dataChanged || s.layout.doc !== prev.layout.doc || s.catalogue !== prev.catalogue) this.syncFurniture(s);
    if (dataChanged || s.placing !== prev.placing || s.catalogue !== prev.catalogue) {
      this.interaction.setPlacing(s.placing, dataChanged || s.catalogue !== prev.catalogue);
    }
    if (s.underlay !== prev.underlay || s.labels !== prev.labels || s.view !== prev.view) this.applyDisplay(s);
    if (
      dataChanged ||
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
    this.build = buildApartment(ap, this.mats);
    this.scene.add(this.build.root);
    this.lights.fit(this.build.bounds);
    this.underlay.set(ap.underlay, data.version, ap.ceilingHeight + 20);
    if (!this.fitted.has(this.view)) this.fit();
  }

  private syncFurniture(s: AppState): void {
    this.furniture.sync({
      doc: s.layout.doc,
      catalogue: s.catalogue,
      presets: s.data.materials,
      ceilingHeight: s.data.apartment?.ceilingHeight ?? 250,
    });
  }

  private applyView(): void {
    const is2d = this.view === "2d";
    this.plan.enabled = is2d;
    this.orbit.enabled = !is2d;
    this.scene.background = new Color(BACKGROUND[this.view]);
    this.lights.setView(this.view);
    if (!this.fitted.has(this.view)) this.fit();
  }

  private applyDisplay(s: AppState): void {
    this.underlay.setDisplay(s.underlay.visible, s.underlay.opacity);
    this.labelsOn = s.labels;
  }

  /** Room labels are HTML on top of the canvas; in 3D hide those behind walls. */
  private updateLabels(): void {
    const labels = this.build?.labels ?? [];
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
    const item = sel?.kind === "item" ? this.furniture.object(sel.uid) : undefined;
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
    const rotatable = !placed.locked && s.layout.status === "ready";
    this.selection.show(pose, size, rotatable, this.view === "2d" ? this.plan.cmPerPx : 0);
  }

  /** Frame the whole apartment in the active view. */
  fit(): void {
    if (!this.build) return;
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

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.plan.setSize(w, h);
    this.orbitCamera.aspect = w / h;
    this.orbitCamera.updateProjectionMatrix();
    this.dimension.setResolution(w, h);
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
    if (!hit || hit.distanceTo(this.orbitCamera.position) > 20_000) return null; // towards the horizon
    return [hit.x, hit.z];
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
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
    const w = window as unknown as { __engine?: Engine };
    if (w.__engine === this) delete w.__engine;
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.interaction.dispose();
    this.plan.dispose();
    this.orbit.dispose();
    this.furniture.dispose();
    this.build?.dispose();
    this.mats?.dispose();
    this.underlay.dispose();
    this.highlight.dispose();
    this.dimension.dispose();
    this.selection.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
