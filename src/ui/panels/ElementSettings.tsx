/**
 * What the working layout can change about the fixed apartment (saved in the layout, never in apartment.json):
 * how far doors are shown open, wall colours (per room or per side of a wall) and floors.
 */
import { useRef } from "react";
import { DOOR_OPEN, setDoorOpening, setSurface, type SurfaceTarget } from "../../core/layout/commands";
import type { Opening, Room, Wall } from "../../core/schema/apartment";
import { materialGroup } from "../../core/schema/materials";
import { swatchStyle } from "../components";
import { useApp, useAppStore } from "../store";

export function DoorSettings({ door }: { door: Opening }) {
  const store = useAppStore();
  const value = useApp((s) => s.layout.doc.doors?.[door.id] ?? DOOR_OPEN);
  const ready = useApp((s) => s.layout.status === "ready");
  /** Each drag of the slider is one undo step. */
  const gesture = useRef(0);
  const set = (deg: number | undefined, merge?: string) => store.getState().edit((d) => setDoorOpening(d, door.id, deg), merge === undefined ? undefined : { merge });
  return (
    <section>
      <h3>Door</h3>
      <div className="door-slider">
        <span className="muted">Closed</span>
        <input
          type="range"
          min={0}
          max={DOOR_OPEN}
          step={1}
          value={value}
          disabled={!ready}
          aria-label="How far the door is open"
          onPointerDown={() => gesture.current++}
          onKeyDown={(e) => {
            if (!e.repeat) gesture.current++;
          }}
          onChange={(e) => set(Number(e.target.value), `door:${door.id}:${gesture.current}`)}
        />
        <span className="muted">Open</span>
        <b className="door-slider__value">{value}°</b>
      </div>
      <div className="actions actions--compact">
        <button onClick={() => set(0)} disabled={!ready || value === 0}>
          Close
        </button>
        <button onClick={() => set(45)} disabled={!ready || value === 45}>
          Half open
        </button>
        <button onClick={() => set(undefined)} disabled={!ready || value === DOOR_OPEN}>
          Open
        </button>
      </div>
      <p className="muted small">
        Only how the door is shown, saved with this layout (the door itself is defined in <code>data/apartment.json</code>). Furniture in the door's
        full 90° swing is still flagged, so the door can always open all the way. While walking, a closed door is in the way.
      </p>
    </section>
  );
}

function SurfacePicker(props: { label: string; group: "paint" | "floor"; chosen: string | undefined; fallback: string; onPick: (id: string | undefined) => void }) {
  const presets = useApp((s) => s.data.materials);
  const ready = useApp((s) => s.layout.status === "ready");
  const { label, group, chosen, fallback, onPick } = props;
  const current = chosen ?? fallback;
  const ids = [...presets.keys()].filter((id) => materialGroup(id) === group);
  if (!ids.includes(fallback) && presets.has(fallback)) ids.unshift(fallback);
  return (
    <div className="slot">
      <div className="slot__head">
        <b>{label}</b>
        <span className="muted">{presets.get(current)?.name ?? current}</span>
        {chosen !== undefined && (
          <button className="link" onClick={() => onPick(undefined)} disabled={!ready} title="Back to the finish in data/apartment.json">
            Default
          </button>
        )}
      </div>
      <div className="swatches" role="group" aria-label={label}>
        {ids.map((id) => (
          <button
            key={id}
            className={`swatch ${id === current ? "swatch--active" : ""}`}
            style={swatchStyle(presets.get(id))}
            title={presets.get(id)?.name ?? id}
            aria-label={presets.get(id)?.name ?? id}
            aria-pressed={id === current}
            disabled={!ready}
            onClick={() => onPick(id === fallback ? undefined : id)}
          />
        ))}
      </div>
    </div>
  );
}

function useSurfaceEdit() {
  const store = useAppStore();
  return (target: SurfaceTarget, id: string | undefined) => store.getState().edit((d) => setSurface(d, target, id));
}

export function RoomFinishes({ room }: { room: Room }) {
  const defaults = useApp((s) => s.data.apartment!.defaults);
  const walls = useApp((s) => s.layout.doc.surfaces?.walls?.rooms?.[room.id]);
  const floor = useApp((s) => s.layout.doc.surfaces?.floors?.[room.id]);
  const edit = useSurfaceEdit();
  return (
    <section>
      <h3>Colours in this layout</h3>
      {room.kind === "indoor" && (
        <SurfacePicker
          label="Walls"
          group="paint"
          chosen={walls}
          fallback={room.wallMaterial ?? defaults.wallMaterial}
          onPick={(id) => edit({ kind: "room-walls", room: room.id }, id)}
        />
      )}
      <SurfacePicker
        label="Floor"
        group="floor"
        chosen={floor}
        fallback={room.floorMaterial ?? defaults.floorMaterial}
        onPick={(id) => edit({ kind: "floor", room: room.id }, id)}
      />
      <p className="muted small">Saved with the layout. Single walls can have their own colour: click a wall.</p>
    </section>
  );
}

export function WallColours({ wall }: { wall: Wall }) {
  const ap = useApp((s) => s.data.apartment!);
  const surfaces = useApp((s) => s.layout.doc.surfaces);
  const edit = useSurfaceEdit();
  if (wall.kind === "glazing") return null;
  const sides = (["left", "right"] as const)
    .map((side) => ({ side, room: ap.rooms.find((r) => r.id === wall.sides?.[side]) }))
    .filter((x): x is { side: "left" | "right"; room: Room } => x.room?.kind === "indoor");
  if (!sides.length) return null;
  return (
    <section>
      <h3>Colour in this layout</h3>
      {sides.map(({ side, room }) => {
        const face = `${wall.id}:${side}`;
        return (
          <SurfacePicker
            key={side}
            label={`Side facing ${room.name}`}
            group="paint"
            chosen={surfaces?.walls?.faces?.[face]}
            fallback={surfaces?.walls?.rooms?.[room.id] ?? room.wallMaterial ?? ap.defaults.wallMaterial}
            onPick={(id) => edit({ kind: "wall-face", face }, id)}
          />
        );
      })}
      <p className="muted small">Overrides the room's wall colour for this wall only. Saved with the layout.</p>
    </section>
  );
}
