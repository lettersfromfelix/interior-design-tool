import { allowedChoices, isModelItem, ORIGINAL, resolveSlot } from "../../core/catalogue/materials";
import { moveItem, rotateItem, setElevation, setFlag, setRotation, setSlotMaterial } from "../../core/layout/commands";
import type { CatalogueItem, MaterialSlot } from "../../core/schema/catalogue";
import type { LayoutFile } from "../../core/schema/layout";
import type { MaterialPreset } from "../../core/schema/materials";
import { duplicate, remove } from "../actions";
import { NumberField } from "../NumberField";
import { useApp, useAppStore } from "../store";

function swatchStyle(p: MaterialPreset | undefined): React.CSSProperties {
  if (!p) return { background: "#9a9a9a" };
  if (p.pattern) return { background: `linear-gradient(135deg, ${p.color} 0 55%, ${p.pattern.color2} 55% 100%)` };
  if ((p.metalness ?? 0) > 0.5) return { background: `linear-gradient(135deg, ${p.color} 0 40%, #ffffff 60%, ${p.color} 80%)` };
  return { background: p.color };
}

function SlotPicker(props: {
  name: string;
  slot: MaterialSlot;
  item: CatalogueItem;
  chosen: string | undefined;
  presets: ReadonlyMap<string, MaterialPreset>;
  disabled: boolean;
  onPick: (choice: string | undefined) => void;
}) {
  const { name, slot, item, chosen, presets, disabled, onPick } = props;
  const model = isModelItem(item);
  const current = resolveSlot(slot, chosen, presets, model).value;
  const label = (c: string) => (c === ORIGINAL ? "Original (from the 3D model)" : (presets.get(c)?.name ?? c));
  return (
    <div className="slot">
      <div className="slot__head">
        <b>{slot.label ?? name}</b>
        <span className="muted">{current ? label(current) : "unknown preset"}</span>
        {chosen !== undefined && (
          <button className="link" onClick={() => onPick(undefined)} disabled={disabled} title="Use the catalogue default">
            Default
          </button>
        )}
      </div>
      <div className="swatches" role="group" aria-label={slot.label ?? name}>
        {allowedChoices(slot, presets.keys(), model).map((c) => (
          <button
            key={c}
            className={`swatch ${c === current ? "swatch--active" : ""} ${c === ORIGINAL ? "swatch--original" : ""}`}
            style={c === ORIGINAL ? undefined : swatchStyle(presets.get(c))}
            title={label(c)}
            aria-label={label(c)}
            aria-pressed={c === current}
            disabled={disabled}
            onClick={() => onPick(c === slot.default ? undefined : c)}
          />
        ))}
      </div>
    </div>
  );
}

function placementText(item: CatalogueItem, elevation: number): { text: string; note?: string } {
  switch (item.placement.type) {
    case "floor":
      return { text: "On the floor" };
    case "wall":
      return { text: `On a wall, ${elevation} cm above the floor`, note: "Snapping to walls comes in Phase 3. Set the height here." };
    case "onTop":
      return { text: "On another item", note: "Stacking on other items comes in Phase 3; until then it stands on the floor." };
    case "ceiling":
      return { text: "Hangs from the ceiling" };
  }
}

export function ItemPanel({ uid }: { uid: string }) {
  const store = useAppStore();
  const placed = useApp((s) => s.layout.doc.items.find((p) => p.uid === uid));
  const entry = useApp((s) => (placed ? s.catalogue.entries.get(placed.item) : undefined));
  const presets = useApp((s) => s.data.materials);
  const ready = useApp((s) => s.layout.status === "ready");
  const ceiling = useApp((s) => s.data.apartment?.ceilingHeight ?? 250);
  const thumb = useApp((s) => (placed ? s.thumbnails[placed.item] : undefined));
  const select = useApp((s) => s.select);
  if (!placed) {
    return (
      <div className="panel">
        <p className="muted">This item is no longer in the layout.</p>
      </div>
    );
  }
  const edit = (command: (doc: LayoutFile) => LayoutFile) => store.getState().edit(command);
  const item = entry?.item;
  const locked = !!placed.locked;
  const canEdit = ready && !locked;
  const wall = item?.placement.type === "wall" ? item.placement : undefined;
  const elevation = wall ? (placed.elevation ?? wall.defaultElevation) : 0;
  const placement = item && placementText(item, elevation);

  return (
    <div className="panel">
      <section>
        <div className="item-head">
          {thumb && <img className="item-head__thumb" src={thumb.url} alt="" />}
          <div className="item-head__text">
            <h3>{placed.label ?? item?.name ?? "Unknown item"}</h3>
            <div className="muted">
              <code>{placed.uid}</code>
              {item && ` · ${item.category}`}
            </div>
          </div>
          <button className="link" onClick={() => select(null)}>
            Clear
          </button>
        </div>
        {!item && (
          <p className="notice notice--error">
            There is no catalogue item <code>{placed.item}</code>, so it is shown as a red box. Add it to <code>catalogue/</code> or delete
            this entry.
          </p>
        )}
        {!ready && <p className="notice">The layout file has errors, so nothing can be changed until it is fixed (see Issues).</p>}
        <div className="actions">
          <button onClick={() => duplicate(store, uid)} disabled={!ready} title="Duplicate (Ctrl+D)">
            Duplicate
          </button>
          <button onClick={() => remove(store, uid)} disabled={!canEdit} title="Delete (Del)">
            Delete
          </button>
          <button onClick={() => edit((d) => setFlag(d, uid, "locked", !locked))} disabled={!ready} aria-pressed={locked} title="A locked item can't be moved, rotated or deleted">
            {locked ? "Unlock" : "Lock"}
          </button>
          <button onClick={() => edit((d) => setFlag(d, uid, "hidden", !placed.hidden))} disabled={!ready} aria-pressed={!!placed.hidden}>
            {placed.hidden ? "Show" : "Hide"}
          </button>
        </div>
      </section>

      <section>
        <h3>Position</h3>
        <div className="fields">
          <NumberField label="x" unit="cm" value={placed.position[0]} disabled={!canEdit} onCommit={(v) => edit((d) => moveItem(d, uid, [v, placed.position[1]]))} />
          <NumberField label="z" unit="cm" value={placed.position[1]} disabled={!canEdit} onCommit={(v) => edit((d) => moveItem(d, uid, [placed.position[0], v]))} />
          <NumberField label="Rotation" unit="°" value={placed.rotation} disabled={!canEdit} onCommit={(v) => edit((d) => setRotation(d, uid, v))} />
          {item && wall && (
            <NumberField
              label="Height"
              unit="cm"
              title="Floor to the bottom edge"
              value={elevation}
              min={wall.minElevation ?? 0}
              max={wall.maxElevation ?? Math.max(0, ceiling - item.dimensions.height)}
              disabled={!canEdit}
              onCommit={(v) => edit((d) => setElevation(d, uid, v === wall.defaultElevation ? undefined : v))}
            />
          )}
        </div>
        <div className="actions actions--compact">
          {[-90, -15, 15, 90].map((delta) => (
            <button key={delta} onClick={() => edit((d) => rotateItem(d, uid, delta))} disabled={!canEdit} title={delta > 0 ? "Clockwise" : "Counter-clockwise"}>
              {delta > 0 ? "⟳" : "⟲"} {Math.abs(delta)}°
            </button>
          ))}
        </div>
        <p className="muted small">
          Drag the item to move it, drag the blue ring to rotate it (Shift: 15° steps). Keys: R / Shift+R ±90°, Q / E ±15°, arrows 1 cm
          (Shift: 10 cm).
        </p>
      </section>

      {item && Object.keys(item.materialSlots).length > 0 && (
        <section>
          <h3>Materials</h3>
          {Object.entries(item.materialSlots).map(([name, slot]) => (
            <SlotPicker
              key={name}
              name={name}
              slot={slot}
              item={item}
              chosen={placed.materials?.[name]}
              presets={presets}
              disabled={!ready}
              onPick={(choice) => edit((d) => setSlotMaterial(d, uid, name, choice))}
            />
          ))}
        </section>
      )}

      {item && placement && entry && (
        <section>
          <h3>Details</h3>
          <table className="table table--facts">
            <tbody>
              <tr>
                <th>Catalogue item</th>
                <td>
                  {item.name} <code>{item.id}</code>
                </td>
              </tr>
              <tr>
                <th>Size (w × d × h)</th>
                <td>
                  {item.dimensions.width} × {item.dimensions.depth} × {item.dimensions.height} cm
                </td>
              </tr>
              <tr>
                <th>Placement</th>
                <td>
                  {placement.text}
                  {placement.note && <div className="muted">{placement.note}</div>}
                </td>
              </tr>
              {item.price && (
                <tr>
                  <th>Price</th>
                  <td>
                    {item.price.currency} {item.price.amount.toLocaleString("de-CH")}
                  </td>
                </tr>
              )}
              {item.productUrl && (
                <tr>
                  <th>Product</th>
                  <td>
                    <a href={item.productUrl} target="_blank" rel="noreferrer">
                      {new URL(item.productUrl).hostname}
                    </a>
                  </td>
                </tr>
              )}
              {item.notes && (
                <tr>
                  <th>Notes</th>
                  <td>{item.notes}</td>
                </tr>
              )}
              <tr>
                <th>File</th>
                <td>
                  <code>{entry.file}</code>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">The size is fixed by the catalogue; change it there.</p>
        </section>
      )}
    </div>
  );
}
