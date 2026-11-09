import { Box3, DirectionalLight, Group, HemisphereLight, Vector3 } from "three";
import { configureCameraLayers } from "./layers";

/** Default lighting: soft sky/ground light plus one directional light with shadows (3D view only). */
export class Lights {
  readonly group = new Group();
  private readonly hemi = new HemisphereLight("#ffffff", "#d8d0c2", 1.5);
  private readonly sun = new DirectionalLight("#fff8ef", 1.9);

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
    const c = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    this.sun.target.position.set(c.x, 0, c.z);
    this.sun.position.set(c.x, 0, c.z).add(new Vector3(-0.45, 1, -0.6).normalize().multiplyScalar(4000));
    const r = Math.hypot(size.x, size.z) * 0.6;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 100;
    cam.far = 8000;
    cam.updateProjectionMatrix();
  }

  setView(view: "2d" | "3d"): void {
    this.sun.castShadow = view === "3d";
  }
}
