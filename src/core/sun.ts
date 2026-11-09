/**
 * Where the sun is, for the daylight simulation. Solar position after NOAA's solar calculator (good to a fraction
 * of a degree for 1900–2100, without atmospheric refraction); apartment time -> UTC via the browser's time-zone
 * database (Intl), so summer time is handled. No dependencies.
 */

const DEG = Math.PI / 180;
const mod = (v: number, m: number) => ((v % m) + m) % m;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SunPosition {
  /** Degrees above the horizon (negative: below it). */
  altitude: number;
  /** Compass bearing, degrees clockwise from north. */
  azimuth: number;
}

export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525; // Julian centuries since J2000.0
  const l0 = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360); // mean longitude
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t); // mean anomaly
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // orbit eccentricity
  const centre =
    Math.sin(m * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * DEG) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * DEG) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + centre - 0.00569 - 0.00478 * Math.sin(omega * DEG); // apparent longitude
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG); // obliquity
  const decl = Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG));
  const y = Math.tan((eps / 2) * DEG) ** 2;
  const eqTime =
    (4 / DEG) *
    (y * Math.sin(2 * l0 * DEG) -
      2 * e * Math.sin(m * DEG) +
      4 * e * y * Math.sin(m * DEG) * Math.cos(2 * l0 * DEG) -
      0.5 * y * y * Math.sin(4 * l0 * DEG) -
      1.25 * e * e * Math.sin(2 * m * DEG)); // minutes

  const trueSolar = mod(date.getTime() / 60_000 + eqTime + 4 * longitude, 1440); // minutes
  const hourAngle = trueSolar / 4 - 180;
  const lat = latitude * DEG;
  const zenith = Math.acos(clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle * DEG), -1, 1));
  const den = Math.cos(lat) * Math.sin(zenith);
  let azimuth = 180;
  if (Math.abs(den) > 1e-9) {
    const a = Math.acos(clamp((Math.sin(lat) * Math.cos(zenith) - Math.sin(decl)) / den, -1, 1)) / DEG;
    azimuth = hourAngle > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }
  return { altitude: 90 - zenith / DEG, azimuth };
}

/** Offset of `timeZone` from UTC at the instant `utcMs` (ms; local = UTC + offset). Unknown zones count as UTC. */
export function zoneOffset(utcMs: number, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(new Date(utcMs));
  } catch {
    return 0;
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return local - Math.floor(utcMs / 1000) * 1000;
}

/** The instant when clocks in `timeZone` show `minutes` after midnight on `date` ("YYYY-MM-DD"). */
export function zonedTime(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const first = wall - zoneOffset(wall, timeZone);
  return new Date(wall - zoneOffset(first, timeZone)); // second pass: the offset at the result (summer time changes)
}

/** Today's date ("YYYY-MM-DD") in `timeZone`. */
export function todayIn(timeZone: string, now = new Date()): string {
  const off = zoneOffset(now.getTime(), timeZone);
  return new Date(now.getTime() + off).toISOString().slice(0, 10);
}

/** Unit vector towards the sun in scene coordinates [x, y, z] (y up; the plan's up, −z, has compass bearing `planUpBearing`). */
export function sunDirection(sun: SunPosition, planUpBearing: number): [number, number, number] {
  const phi = (sun.azimuth - planUpBearing) * DEG;
  const alt = sun.altitude * DEG;
  return [Math.cos(alt) * Math.sin(phi), Math.sin(alt), -Math.cos(alt) * Math.cos(phi)];
}

const WINDS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** "SW" for 225°. */
export const compassName = (bearing: number): string => WINDS[Math.round(mod(bearing, 360) / 45) % 8];

export interface SunTimes {
  /** Minutes after local midnight; undefined if the sun doesn't rise or set that day. */
  sunrise?: number;
  sunset?: number;
}

/** The sun's upper edge on the horizon, refraction included (the usual definition of sunrise and sunset). */
const HORIZON = -0.833;

/** Sunrise and sunset in local minutes, to the minute. */
export function sunTimes(date: string, latitude: number, longitude: number, timeZone: string): SunTimes {
  const up = (min: number) => sunPosition(zonedTime(date, min, timeZone), latitude, longitude).altitude > HORIZON;
  const out: SunTimes = {};
  let prev = up(0);
  for (let min = 10; min <= 1440; min += 10) {
    const cur = up(min);
    if (cur !== prev) {
      let lo = min - 10;
      let hi = min;
      while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        if (up(mid) === prev) lo = mid;
        else hi = mid;
      }
      if (cur) out.sunrise ??= hi;
      else out.sunset = hi;
    }
    prev = cur;
  }
  return out;
}

/** "07:05" for 425 minutes. */
export const clockTime = (minutes: number): string => {
  const m = mod(Math.round(minutes), 1440);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export interface Site {
  location: { latitude: number; longitude: number; timeZone: string };
  north: { planUpBearing: number };
}

/** The sun over the apartment at `minutes` local time on `date` ("" = today there). */
export function apartmentSun(site: Site, date: string, minutes: number): { date: string; sun: SunPosition; direction: [number, number, number] } {
  const { latitude, longitude, timeZone } = site.location;
  const day = date || todayIn(timeZone);
  const sun = sunPosition(zonedTime(day, minutes, timeZone), latitude, longitude);
  return { date: day, sun, direction: sunDirection(sun, site.north.planUpBearing) };
}
