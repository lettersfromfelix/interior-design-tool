import { BufferAttribute, type BufferGeometry } from "three";

/**
 * Replace the UVs by box-projected UVs in centimetres (1 UV unit = 1 cm), based on the geometry's own coordinates.
 * Textures are then scaled by their real-world size (texture.repeat = 1 / sizeCm), so a 60 cm tile is 60 cm everywhere.
 * Horizontal faces use (x, -z), like the floor shapes.
 */
export function applyCmUVs(g: BufferGeometry): BufferGeometry {
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) [u, v] = [x, -z];
    else if (ax >= az) [u, v] = [z, y];
    else [u, v] = [x, y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  return g;
}
