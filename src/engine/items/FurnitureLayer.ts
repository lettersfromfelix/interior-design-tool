/** The placed furniture of the working layout, kept in sync with the store. */
import { Group, type Object3D } from "three";
import { resolveMaterials } from "../../core/catalogue/materials";
import { resolvePoses, type PoseOverride, type WorldPose } from "../../core/layout/poses";
import type { LayoutFile } from "../../core/schema/layout";
import type { MaterialPreset } from "../../core/schema/materials";
import type { CatalogueSnapshot } from "../../data/catalogue";
import type { MaterialLibrary } from "../materials/MaterialLibrary";
import { buildItem, type BuiltItem } from "./buildItem";
import type { ModelLibrary } from "./models";

const DEG = Math.PI / 180;

export function applyPose(obj: Object3D, pose: WorldPose): void {
  obj.position.set(pose.x, pose.y, pose.z);
  obj.rotation.set(0, -pose.rotation * DEG, 0);
  obj.updateMatrixWorld(true);
}

export interface FurnitureInput {
  doc: LayoutFile;
  catalogue: CatalogueSnapshot;
  presets: ReadonlyMap<string, MaterialPreset>;
  ceilingHeight: number;
}

export class FurnitureLayer {
  readonly group = new Group();
  private readonly built = new Map<string, { item: BuiltItem; key: string }>();
  private mats?: MaterialLibrary;
  private matsVersion = 0;
  private input?: FurnitureInput;
  private poses = new Map<string, WorldPose>();

  constructor(
    private readonly models: ModelLibrary,
    private readonly onChange: () => void,
  ) {
    this.group.name = "furniture";
  }

  /** New material library (materials.json changed): everything is rebuilt on the next sync. */
  setMaterials(mats: MaterialLibrary | undefined): void {
    this.clear();
    this.mats = mats;
    this.matsVersion++;
  }

  sync(input: FurnitureInput): void {
    this.input = input;
    const mats = this.mats;
    if (!mats) return this.clear();
    const { doc, catalogue, presets, ceilingHeight } = input;
    this.poses = resolvePoses(doc, (id) => catalogue.entries.get(id)?.item, ceilingHeight);
    const keep = new Set<string>();
    for (const p of doc.items) {
      if (p.hidden) continue;
      keep.add(p.uid);
      const entry = catalogue.entries.get(p.item);
      const resolved = entry ? resolveMaterials(entry.item, p.materials, presets) : {};
      const key = `${this.matsVersion}|${entry ? entry.rev : `missing:${p.item}`}|${JSON.stringify(resolved)}`;
      let b = this.built.get(p.uid);
      if (!b || b.key !== key) {
        this.remove(p.uid);
        const item = buildItem(entry, resolved, { mats, models: this.models, onLoaded: this.onChange });
        item.root.name = p.uid;
        item.root.userData.itemUid = p.uid;
        this.group.add(item.root);
        b = { item, key };
        this.built.set(p.uid, b);
      }
      applyPose(b.item.root, this.poses.get(p.uid)!);
    }
    for (const uid of [...this.built.keys()]) if (!keep.has(uid)) this.remove(uid);
  }

  /** Poses with temporary overrides (dragging, rotating), without changing the layout. */
  previewPoses(overrides: ReadonlyMap<string, PoseOverride>): Map<string, WorldPose> {
    if (!this.input) return new Map();
    const { doc, catalogue, ceilingHeight } = this.input;
    return resolvePoses(doc, (id) => catalogue.entries.get(id)?.item, ceilingHeight, overrides);
  }

  /** Show items at the given poses until the next sync. */
  preview(poses: ReadonlyMap<string, WorldPose>): void {
    for (const [uid, pose] of poses) {
      const b = this.built.get(uid);
      if (b) applyPose(b.item.root, pose);
    }
    this.onChange();
  }

  /** Back to the poses of the layout (e.g. a drag was cancelled). */
  reset(): void {
    this.preview(this.poses);
  }

  object(uid: string): Object3D | undefined {
    return this.built.get(uid)?.item.root;
  }

  pose(uid: string): WorldPose | undefined {
    return this.poses.get(uid);
  }

  private remove(uid: string): void {
    const b = this.built.get(uid);
    if (!b) return;
    b.item.dispose();
    b.item.root.removeFromParent();
    this.built.delete(uid);
  }

  clear(): void {
    for (const uid of [...this.built.keys()]) this.remove(uid);
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}
