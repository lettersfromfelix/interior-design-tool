import { describe, expect, it } from "vitest";
import { clockTime, compassName, sunDirection, sunPosition, sunTimes, todayIn, zonedTime } from "./sun";

const ZURICH = { lat: 47.38, lon: 8.54, tz: "Europe/Zurich" };

/** The highest the sun gets on `date` (scanned per minute), with its azimuth then. */
function noon(date: string) {
  let best = { altitude: -90, azimuth: 0, minutes: 0 };
  for (let m = 9 * 60; m <= 16 * 60; m++) {
    const p = sunPosition(zonedTime(date, m, ZURICH.tz), ZURICH.lat, ZURICH.lon);
    if (p.altitude > best.altitude) best = { ...p, minutes: m };
  }
  return best;
}

describe("sun position", () => {
  it("reaches 90° − latitude ± tilt at solar noon in Zürich", () => {
    const summer = noon("2024-06-21");
    expect(summer.altitude).toBeCloseTo(66.06, 0);
    expect(summer.azimuth).toBeGreaterThan(178);
    expect(summer.azimuth).toBeLessThan(182);
    // summer time: solar noon is around 13:27 on the clock
    expect(clockTime(summer.minutes)).toMatch(/^13:(2|3)\d$/);
    expect(noon("2024-12-21").altitude).toBeCloseTo(19.18, 0);
    expect(Math.abs(noon("2024-03-20").altitude - 42.6)).toBeLessThan(0.6);
  });

  it("rises in the east and sets in the west", () => {
    const morning = sunPosition(zonedTime("2024-03-20", 7 * 60 + 30, ZURICH.tz), ZURICH.lat, ZURICH.lon);
    const evening = sunPosition(zonedTime("2024-03-20", 18 * 60 + 30, ZURICH.tz), ZURICH.lat, ZURICH.lon);
    expect(morning.azimuth).toBeGreaterThan(80);
    expect(morning.azimuth).toBeLessThan(110);
    expect(evening.azimuth).toBeGreaterThan(250);
    expect(evening.azimuth).toBeLessThan(280);
    expect(sunPosition(zonedTime("2024-06-21", 0, ZURICH.tz), ZURICH.lat, ZURICH.lon).altitude).toBeLessThan(0);
  });

  it("finds sunrise and sunset", () => {
    const t = sunTimes("2024-06-21", ZURICH.lat, ZURICH.lon, ZURICH.tz);
    // published: 05:31 and 21:26
    expect(Math.abs(t.sunrise! - (5 * 60 + 31))).toBeLessThanOrEqual(2);
    expect(Math.abs(t.sunset! - (21 * 60 + 26))).toBeLessThanOrEqual(2);
    const winter = sunTimes("2024-12-21", ZURICH.lat, ZURICH.lon, ZURICH.tz);
    // published: 08:13 and 16:39
    expect(Math.abs(winter.sunrise! - (8 * 60 + 13))).toBeLessThanOrEqual(3);
    expect(Math.abs(winter.sunset! - (16 * 60 + 39))).toBeLessThanOrEqual(3);
  });
});

describe("apartment time", () => {
  it("converts clock time to UTC with summer time", () => {
    expect(zonedTime("2024-06-21", 13 * 60 + 30, ZURICH.tz).toISOString()).toBe("2024-06-21T11:30:00.000Z");
    expect(zonedTime("2024-12-21", 12 * 60, ZURICH.tz).toISOString()).toBe("2024-12-21T11:00:00.000Z");
    // the night clocks go forward (02:00 -> 03:00)
    expect(zonedTime("2024-03-31", 3 * 60 + 30, ZURICH.tz).toISOString()).toBe("2024-03-31T01:30:00.000Z");
    expect(zonedTime("2024-06-21", 12 * 60, "Not/AZone").toISOString()).toBe("2024-06-21T12:00:00.000Z");
  });

  it("knows the date in the apartment's time zone", () => {
    expect(todayIn(ZURICH.tz, new Date("2024-06-21T22:30:00Z"))).toBe("2024-06-22");
    expect(todayIn(ZURICH.tz, new Date("2024-06-21T21:30:00Z"))).toBe("2024-06-21");
  });

  it("formats times and compass directions", () => {
    expect(clockTime(425)).toBe("07:05");
    expect(clockTime(1440)).toBe("00:00");
    expect(compassName(225)).toBe("SW");
    expect(compassName(359)).toBe("N");
    expect(compassName(100)).toBe("E");
  });
});

describe("sun direction in the scene", () => {
  it("turns with the plan's north", () => {
    const high = { altitude: 30, azimuth: 180 };
    // plan up = north: south is down the plan (+z)
    const [x, y, z] = sunDirection(high, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0.5, 6);
    expect(z).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    // plan up = NE (49°): south lies between plan right (139°) and plan down (229°)
    const [x2, , z2] = sunDirection(high, 49);
    expect(x2).toBeGreaterThan(0);
    expect(z2).toBeGreaterThan(0);
    // a sun due east with plan up = east is straight up the plan
    const [x3, , z3] = sunDirection({ altitude: 0, azimuth: 90 }, 90);
    expect(x3).toBeCloseTo(0, 6);
    expect(z3).toBeCloseTo(-1, 6);
  });
});
