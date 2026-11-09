import { useMemo } from "react";
import { apartmentSun, clockTime, compassName, sunTimes } from "../core/sun";
import { useApp } from "./store";

/** Earliest and latest time on the slider (local minutes). */
const FROM = 5 * 60;
const TO = 22 * 60;

/** Daylight through the windows: date, time of day and where the sun is. */
export function DaylightBar() {
  const ap = useApp((s) => s.data.apartment);
  const daylight = useApp((s) => s.daylight);
  const setDaylight = useApp((s) => s.setDaylight);
  const site = ap ? { location: ap.location, north: ap.north } : undefined;
  const now = site ? apartmentSun(site, daylight.date, daylight.minutes) : undefined;
  const date = now?.date ?? "";
  const lat = ap?.location.latitude;
  const lon = ap?.location.longitude;
  const tz = ap?.location.timeZone;
  const times = useMemo(() => (date && lat !== undefined && lon !== undefined && tz ? sunTimes(date, lat, lon, tz) : {}), [date, lat, lon, tz]);
  if (!ap || !daylight.on || !now) return null;
  const year = date.slice(0, 4);
  const presets: [string, string][] = [
    ["Mar 20", `${year}-03-20`],
    ["Jun 21", `${year}-06-21`],
    ["Sep 22", `${year}-09-22`],
    ["Dec 21", `${year}-12-21`],
  ];
  const { altitude, azimuth } = now.sun;
  return (
    <div className="daylight" role="group" aria-label="Daylight">
      <div className="daylight__row">
        <b>☀ Daylight</b>
        <input type="date" value={date} onChange={(e) => setDaylight({ date: e.target.value })} aria-label="Date" />
        <button className="link" onClick={() => setDaylight({ date: "" })} disabled={daylight.date === ""} title="Follow today's date">
          Today
        </button>
        <span className="spacer" />
        <button className="link" onClick={() => setDaylight({ on: false })} aria-label="Turn daylight off" title="Back to the default light">
          ✕
        </button>
      </div>
      <div className="daylight__row">
        {presets.map(([label, d]) => (
          <button key={d} className={`aid ${date === d ? "aid--on" : ""}`} onClick={() => setDaylight({ date: d })} title={d === `${year}-06-21` ? "Longest day" : d === `${year}-12-21` ? "Shortest day" : "Equinox"}>
            {label}
          </button>
        ))}
      </div>
      <div className="daylight__row">
        <input
          type="range"
          min={FROM}
          max={TO}
          step={5}
          value={Math.min(TO, Math.max(FROM, daylight.minutes))}
          onChange={(e) => setDaylight({ minutes: Number(e.target.value) })}
          aria-label="Time of day"
        />
        <b className="daylight__time">{clockTime(daylight.minutes)}</b>
      </div>
      <div className="small">
        {altitude > 0 ? (
          <>
            Sun {Math.round(altitude)}° high in the {compassName(azimuth)} ({Math.round(azimuth)}°)
          </>
        ) : (
          <>The sun is below the horizon</>
        )}
        {times.sunrise !== undefined && times.sunset !== undefined && (
          <span className="muted">
            {" "}
            · up {clockTime(times.sunrise)}–{clockTime(times.sunset)}
          </span>
        )}
      </div>
      <div className="muted small" title="north.planUpBearing and location in data/apartment.json">
        Plan up = {ap.north.planUpBearing}° ({compassName(ap.north.planUpBearing)}) · {ap.location.timeZone}
      </div>
    </div>
  );
}

/** Walking settings, where the placement aids are in the other views. */
export function WalkBar() {
  const walk = useApp((s) => s.walk);
  const setWalk = useApp((s) => s.setWalk);
  const setView = useApp((s) => s.setView);
  const requestFit = useApp((s) => s.requestFit);
  return (
    <div className="aidbar" role="toolbar" aria-label="Walking">
      <label className="aid-group" title="Eye height above the floor">
        <span className="aid-label">Eye height</span>
        <input type="range" min={80} max={220} step={1} value={walk.eyeHeight} onChange={(e) => setWalk({ eyeHeight: Number(e.target.value) })} aria-label="Eye height" />
        <b>{walk.eyeHeight} cm</b>
      </label>
      <button className={`aid ${walk.furniture ? "aid--on" : ""}`} aria-pressed={walk.furniture} onClick={() => setWalk({ furniture: !walk.furniture })} title="Furniture stops you (walls, closed doors and fixtures always do)">
        Bump into furniture
      </button>
      <span className="aid-sep" />
      <button className="aid" onClick={requestFit} title="Back to the entrance (F)">
        ⌂ Entrance
      </button>
      <button className="aid" onClick={() => setView("3d")} title="Back to the 3D view (Esc)">
        Leave
      </button>
    </div>
  );
}
