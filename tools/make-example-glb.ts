/**
 * npm run make-example-glb — builds catalogue/example-stool-glb/model.glb from primitives (no third-party assets).
 *
 * Like many downloaded models it uses metres and has its origin in the middle of the seat, not on the floor: the app
 * scales and moves it to the item's declared dimensions. The materials are called "Seat" and "Legs" so that
 * item.json can map them to material slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, TorusGeometry, Vector3 } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// GLTFExporter reads its output through FileReader, which Node does not have
class FileReaderShim {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader?: unknown }).FileReader ??= FileReaderShim;

const seatMat = new MeshStandardMaterial({ name: "Seat", color: "#c8a27a", roughness: 0.6 });
const legMat = new MeshStandardMaterial({ name: "Legs", color: "#1e1e1e", roughness: 0.5, metalness: 0.6 });

const stool = new Group();
stool.name = "stool";

const seatThickness = 0.035;
const seat = new Mesh(new CylinderGeometry(0.175, 0.17, seatThickness, 48), seatMat);
seat.name = "seat";
stool.add(seat);

const floor = -0.45 + seatThickness / 2; // the stool is 45 cm high
const under = -seatThickness / 2;
for (const [i, deg] of [90, 210, 330].entries()) {
  const a = (deg * Math.PI) / 180;
  const top = new Vector3(0.12 * Math.cos(a), under, 0.12 * Math.sin(a));
  const bottom = new Vector3(0.16 * Math.cos(a), floor, 0.16 * Math.sin(a));
  const dir = top.clone().sub(bottom);
  const leg = new Mesh(new CylinderGeometry(0.012, 0.012, dir.length(), 16), legMat);
  leg.name = `leg-${i + 1}`;
  leg.position.copy(top).add(bottom).multiplyScalar(0.5);
  leg.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  stool.add(leg);
}

const ringHeight = -0.25;
const t = (ringHeight - under) / (floor - under);
const footrest = new Mesh(new TorusGeometry(0.12 + 0.04 * t, 0.008, 12, 64), legMat);
footrest.name = "footrest";
footrest.rotation.x = Math.PI / 2;
footrest.position.y = ringHeight;
stool.add(footrest);

const out = resolve(import.meta.dirname, "..", "catalogue", "example-stool-glb", "model.glb");
mkdirSync(resolve(out, ".."), { recursive: true });
const glb = (await new GLTFExporter().parseAsync(stool, { binary: true })) as ArrayBuffer;
writeFileSync(out, Buffer.from(glb));
console.log(`wrote ${out} (${glb.byteLength} bytes)`);
