import type { Camera, Object3D } from "three";

/**
 * Render layers. One scene serves both views:
 * - BOTH: rendered in 2D and 3D
 * - ONLY_3D: e.g. lintels above openings, ceilings, window frames (would hide the openings in the plan)
 * - ONLY_2D: plan symbols (door swings, window symbols) and the floor-plan underlay
 */
export const Layer = { BOTH: 0, ONLY_3D: 1, ONLY_2D: 2 } as const;

export function setLayer(obj: Object3D, layer: number): Object3D {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

export function configureCameraLayers(camera: Camera, view: "2d" | "3d"): void {
  camera.layers.set(Layer.BOTH);
  camera.layers.enable(view === "2d" ? Layer.ONLY_2D : Layer.ONLY_3D);
}
