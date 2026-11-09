import { elementTitle, findElement } from "../../core/apartment/elements";
import { allowedChoices, isModelItem, ORIGINAL, resolveSlot } from "../../core/catalogue/materials";
import { moveItem, rotateItem, setElevation, setFlag, setRotation, setSlotMaterial } from "../../core/layout/commands";
import type { Conflict } from "../../core/placement/collisions";
import type { ApartmentFile } from "../../core/schema/apartment";
import type { CatalogueItem, MaterialSlot } from "../../core/schema/catalogue";
import type { LayoutFile, PlacedItem } from "../../core/schema/layout";
import type { MaterialPreset } from "../../core/schema/materials";
import { conflictsOf } from "../../state/derived";
import { duplicate, guardedEdit, remove } from "../actions";
import { swatchStyle } from "../components";
import { NumberField } from "../NumberField";
import { useApp, useAppStore } from "../store";

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

function placementText(item: CatalogueItem, elevation: number, base: string | undefined): { text: string; note?: string } {
  switch (item.placement.type) {
    case "floor":
      return { text: "On the floor" };
    case "wall":
      return { text: `On a wall, ${elevation} cm above the floor`, note: "Drag it along the wall or onto another wall; set its height here." };
    case "onTop":
      return base
        ? { text: `On ${base}`, note: "It moves, turns, duplicates and is deleted together with what it stands on." }
        : { text: "On the floor", note: "Drag it onto a table, sideboard or shelf." };
    case "ceiling":
      return { text: "Hangs from the ceiling" };
  }
}

/** A short name for an apartment element in a sentence ("the wall between Living and Entrée", "Kitchen"). */
function elementName(ap: ApartmentFile | undefined, id: string): string {
  const ref = ap && findElement(ap, id);
  if (!ref) return id;
  const room = (r?: string) => (r ? (ap.rooms.find((x) => x.id === r)?.name ?? r) : undefined);
  switch (ref.kind) {
    case "wall": {
      const [l, r] = [room(ref.element.sides?.left), room(ref.element.sides?.right)];
      return l && r ? `the wall between ${l} and ${r}` : l || r ? `a wall of ${l ?? r}` : "a wall";
    }
    case "fixture":
      return ref.element.name;
    case "opening":
      return `a ${elementTitle(ref).toLowerCase()}`;
    case "room":
      return ref.element.name;
  }
}

function conflictText(c: Conflict, itemName: (uid: string) => string, ap: ApartmentFile | undefined): string {
  const other = c.other ?? "";
  switch (c.kind) {
    case "item":
      return `Overlaps ${itemName(other)}`;
    case "wall":
      return `Overlaps ${elementName(ap, other)}`;
    case "fixture":
      return `Overlaps the fixture “${elementName(ap, other)}”`;
    case "door":
      return "Stands where a door swings open";
    case "opening":
      return `Hangs over ${elementName(ap, other)}`;
    case "off-wall":
      return "Doesn't hang on a wall: drag it to one";
    case "no-surface":
      return "Stands on the floor: drag it onto a table, sideboard or shelf";
    case "clearance": {
      const blocker = ap && findElement(ap, other) ? elementName(ap, other) : itemName(other);
      return `${c.side ? `${c.side[0].toUpperCase()}${c.side.slice(1)} clearance` : "Clearance"} blocked by ${blocker}`;
    }
  }
}

function Conflicts({ uid }: { uid: string }) {
  const list = useApp((s) => conflictsOf(s).get(uid));
  const ap = useApp((s) => s.data.apartment);
  const items = useApp((s) => s.layout.doc.items);
  const catalogue = useApp((s) => s.catalogue);
  const selectItem = useApp((s) => s.selectItem);
  if (!list?.length) return null;
  const byUid = new Map(items.map((p) => [p.uid, p]));
  const itemName = (u: string) => {
    const p = byUid.get(u);
    return p ? (p.label ?? catalogue.entries.get(p.item)?.item.name ?? u) : u;
  };
  return (
    <ul className="conflicts">
      {list.map((c, i) => (
        <li key={i} className={c.hard ? "conflict conflict--hard" : "conflict"}>
          <span>{conflictText(c, itemName, ap)}</span>
          {c.other && byUid.has(c.other) && (
            <button className="link" onClick={() => selectItem(c.other!)}>
              Select
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Name of the item (and surface) `placed` stands on, if it stands on one. */
function baseName(placed: PlacedItem, items: readonly PlacedItem[], lookup: (id: string) => CatalogueItem | undefined): string | undefined {
  if (!placed.parent) return undefined;
  const base = items.find((p) => p.uid === placed.parent!.uid);
  const item = base && lookup(base.item);
  const surface = item?.surfaces?.[placed.parent.surface];
  if (!base || !item || !surface) return undefined;
  return `${base.label ?? item.name}${surface.name ? ` (${surface.name})` : ""}`;
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
  const items = useApp((s) => s.layout.doc.items);
  const catalogue = useApp((s) => s.catalogue);
  if (!placed) {
    return (
      <div className="panel">
        <p className="muted">This item is no longer in the layout.</p>
      </div>
    );
  }
  const edit = (command: (doc: LayoutFile) => LayoutFile) => store.getState().edit(command);
  /** Moves and turns: refused in block mode if they run into something. */
  const move = (command: (doc: LayoutFile) => LayoutFile) => guardedEdit(store, uid, command);
  const item = entry?.item;
  const locked = !!placed.locked;
  const canEdit = ready && !locked;
  const wall = item?.placement.type === "wall" ? item.placement : undefined;
  const elevation = wall ? (placed.elevation ?? wall.defaultElevation) : 0;
  const base = baseName(placed, items, (id) => catalogue.entries.get(id)?.item);
  const placement = item && placementText(item, elevation, base);

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
        <Conflicts uid={uid} />
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
        {base && <p className="muted small">x, z and rotation are relative to {base}.</p>}
        <div className="fields">
          <NumberField label="x" unit="cm" value={placed.position[0]} disabled={!canEdit} onCommit={(v) => move((d) => moveItem(d, uid, [v, placed.position[1]]))} />
          <NumberField label="z" unit="cm" value={placed.position[1]} disabled={!canEdit} onCommit={(v) => move((d) => moveItem(d, uid, [placed.position[0], v]))} />
          <NumberField
            label="Rotation"
            unit="°"
            value={placed.rotation}
            disabled={!canEdit || !!wall}
            title={wall ? "Wall items face away from their wall" : undefined}
            onCommit={(v) => move((d) => setRotation(d, uid, v))}
          />
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
        {!wall && (
          <div className="actions actions--compact">
            {[-90, -15, 15, 90].map((delta) => (
              <button key={delta} onClick={() => move((d) => rotateItem(d, uid, delta))} disabled={!canEdit} title={delta > 0 ? "Clockwise" : "Counter-clockwise"}>
                {delta > 0 ? "⟳" : "⟲"} {Math.abs(delta)}°
              </button>
            ))}
          </div>
        )}
        <p className="muted small">
          {wall
            ? "Drag it along the wall or onto another wall. Arrows: 1 cm along the wall (Shift: 10 cm)."
            : "Drag the item to move it, drag the blue ring to rotate it (15° steps; Shift: 90°, Alt: free). Keys: R / Shift+R ±90°, Q / E ±15°, arrows 1 cm (Shift: 10 cm)."}
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
