import { Box3, Color, DirectionalLight, Group, HemisphereLight, Vector3 } from "three";
import type { ViewMode } from "../state/store";
import { configureCameraLayers } from "./layers";

/** The sun of the daylight simulation, in scene terms. */
export interface SunLight {
  /** Unit vector towards the sun (y up). */
  direction: readonly [number, number, number];
  /** Degrees above the horizon. */
  altitude: number;
}

const DEFAULT_DIRECTION = new Vector3(-0.45, 1, -0.6).normalize();
const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const mix = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t);

/**
 * Default lighting: soft sky/ground light plus one directional light with shadows (3D views). Daylight: the
 * directional light becomes the sun at its real position; it shines through the windows, and the ceilings cast
 * shadows too, so only the windows let it in (in 2D as well: sun patches on the plan).
 */
export class Lights {
  readonly group = new Group();
  private readonly hemi = new HemisphereLight("#ffffff", "#d8d0c2", 1.5);
  private readonly sun = new DirectionalLight("#fff8ef", 1.9);
  private readonly center = new Vector3();
  private view: ViewMode = "2d";
  private daylight: SunLight | null = null;

  constructor() {
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    s.bias = -0.0004;
    s.normalBias = 0.8;
    s.radius = 3;
    // lintels and ceilings live on the 3D-only layer and must cast shadows too
    configureCameraLayers(s.camera, "3d");
    this.group.add(this.hemi, this.sun, this.sun.target);
  }

  /** Aim the light and its shadow camera at the apartment. */
  fit(bounds: Box3): void {
    bounds.getCenter(this.center).setY(0);
    const size = bounds.getSize(new Vector3());
    const r = Math.hypot(size.x, size.z) * 0.6;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 100;
    cam.far = 8000;
    cam.updateProjectionMatrix();
    this.aim();
  }

  /** `daylight`: the sun to show (null: the default lighting). */
  set(view: ViewMode, daylight: SunLight | null): void {
    this.view = view;
    this.daylight = daylight;
    this.aim();
  }

  /** Sky colour for the daylight simulation (null: no daylight). */
  sky(): Color | null {
    const d = this.daylight;
    if (!d) return null;
    const night = "#151b2b";
    const dusk = "#e2a478";
    const day = "#bcd6ee";
    return d.altitude < 0 ? mix(night, dusk, smoothstep(-10, 0, d.altitude)) : mix(dusk, day, smoothstep(0, 15, d.altitude));
  }

  private aim(): void {
    const d = this.daylight;
    const dir = d ? new Vector3(...d.direction).normalize() : DEFAULT_DIRECTION;
    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(dir, 4000);
    this.sun.target.updateMatrixWorld();
    if (!d) {
      this.hemi.intensity = 1.5;
      this.hemi.color.set("#ffffff");
      this.hemi.groundColor.set("#d8d0c2");
      this.sun.intensity = 1.9;
      this.sun.color.set("#fff8ef");
      // the default light isn't a real sun: its shadows help in the overview, but not inside the rooms while walking
      this.sun.castShadow = this.view === "3d";
      return;
    }
    const up = smoothstep(-1, 6, d.altitude); // the sun itself
    const day = smoothstep(-8, 12, d.altitude); // light from the sky
    this.sun.intensity = 3 * up;
    this.sun.color.copy(mix("#ffad66", "#fff3df", smoothstep(2, 30, d.altitude)));
    this.sun.castShadow = up > 0;
    this.hemi.intensity = 0.45 + 1.2 * day;
    this.hemi.color.copy(mix("#4a5878", "#eef3ff", day));
    this.hemi.groundColor.copy(mix("#2e2a24", "#d6cfc2", day));
  }
}
