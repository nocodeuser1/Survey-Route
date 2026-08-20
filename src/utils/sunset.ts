/**
 * Seasonally-aware sunrise/sunset math.
 *
 * Replaces the old three-bucket heuristic (winter = 5 PM, summer = 8 PM,
 * everything else = 6 PM) that lived duplicated in RouteMap and RouteResults.
 * That version was wrong by up to ~90 minutes inside a single "season" — late
 * February in Kansas is a 6:20 PM sunset but the buckets called it 6:00 PM
 * flat, and late June is 9:05 PM but the buckets said 8:00 PM.
 *
 * This is the standard NOAA / SunCalc solar-position solution. It takes the
 * actual date and the actual coordinates, so it is correct on any day of the
 * year at any latitude, and it lands in the browser's local timezone — which
 * means Central Time and its DST switch come along for free.
 */

const RAD = Math.PI / 180;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;

// Standard "sun's upper limb touches the horizon, with refraction" angle.
const SUNSET_ANGLE = -0.833 * RAD;

const toJulian = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (date: Date) => toJulian(date) - J2000;

const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);

const eclipticLongitude = (M: number) => {
  // Equation of the center + longitude of perihelion.
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
};

const declination = (L: number) => Math.asin(Math.sin(RAD * 23.4397) * Math.sin(L));

const julianCycle = (d: number, lw: number) => Math.round(d - 0.0009 - lw / (2 * Math.PI));
const approxTransit = (Ht: number, lw: number, n: number) => 0.0009 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, M: number, L: number) =>
  J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

const hourAngle = (h: number, phi: number, dec: number) =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));

export interface SunTimes {
  /** Local minutes past midnight, e.g. 383 = 6:23 AM. */
  sunriseMinutes: number;
  /** Local minutes past midnight, e.g. 1225 = 8:25 PM. */
  sunsetMinutes: number;
  /** True when the math had to fall back (polar day/night, bad coordinates). */
  isFallback: boolean;
}

const FALLBACK: SunTimes = {
  sunriseMinutes: 6 * 60,
  sunsetMinutes: 18 * 60,
  isFallback: true,
};

const localMinutes = (date: Date) => date.getHours() * 60 + date.getMinutes();

/**
 * Sunrise/sunset for a coordinate on a given date, as local minutes past
 * midnight. Falls back to 6 AM / 6 PM if the sun never crosses the horizon
 * that day or the inputs aren't usable.
 */
export function getSunTimes(
  latitude: number,
  longitude: number,
  date: Date = new Date()
): SunTimes {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return FALLBACK;

  const d = toDays(date);
  const lw = RAD * -lng;
  const phi = RAD * lat;

  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);

  const Jnoon = solarTransitJ(ds, M, L);
  const w = hourAngle(SUNSET_ANGLE, phi, dec);
  if (Number.isNaN(w)) return FALLBACK; // midnight sun / polar night

  const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
  const Jrise = Jnoon - (Jset - Jnoon);

  const sunset = fromJulian(Jset);
  const sunrise = fromJulian(Jrise);
  if (Number.isNaN(sunset.valueOf()) || Number.isNaN(sunrise.valueOf())) return FALLBACK;

  return {
    sunriseMinutes: localMinutes(sunrise),
    sunsetMinutes: localMinutes(sunset),
    isFallback: false,
  };
}

/** Sunset as local minutes past midnight, with the user's offset applied. */
export function getSunsetMinutes(
  latitude: number,
  longitude: number,
  offsetMinutes: number = 0,
  date: Date = new Date()
): number {
  const { sunsetMinutes } = getSunTimes(latitude, longitude, date);
  return clampToDay(sunsetMinutes + (offsetMinutes || 0));
}

/** Sunrise as local minutes past midnight, with the user's offset applied. */
export function getSunriseMinutes(
  latitude: number,
  longitude: number,
  offsetMinutes: number = 0,
  date: Date = new Date()
): number {
  const { sunriseMinutes } = getSunTimes(latitude, longitude, date);
  return clampToDay(sunriseMinutes + (offsetMinutes || 0));
}

function clampToDay(minutes: number): number {
  return Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
}

/** Minutes past midnight → "HH:MM" (24h), the format the settings inputs use. */
export function minutesToTimeString(minutes: number): string {
  const m = clampToDay(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes past midnight → "8:25 PM". */
export function minutesTo12Hour(minutes: number): string {
  const m = clampToDay(minutes);
  const hour24 = Math.floor(m / 60);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(m % 60).padStart(2, '0')} ${period}`;
}

/**
 * The seasonally-aware default for "Return to Home Base By": be back at home
 * base by sunset. Users can still override it in settings; this is only the
 * value we seed when they've never set one.
 */
export function getDefaultReturnByTime(
  latitude: number,
  longitude: number,
  offsetMinutes: number = 0,
  date: Date = new Date()
): string {
  return minutesToTimeString(getSunsetMinutes(latitude, longitude, offsetMinutes, date));
}

/** "Summer" / "Winter" etc. for the settings hint text. Northern hemisphere. */
export function getSeasonLabel(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
}
