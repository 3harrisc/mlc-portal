import {
  HGV_TIME_MULTIPLIER,
  MAX_DRIVE_BEFORE_BREAK_MINS,
  BREAK_MINS,
} from "@/lib/constants";
import { haversineKm, type LngLat } from "@/lib/geo-utils";
import { normalizePostcode } from "@/lib/postcode-utils";
import { timeToMinutes, minutesToTime } from "@/lib/time-utils";

export interface Stop {
  id: string;
  input: string;
  postcode: string;
  time?: string; // "HH:MM" booking time
  open?: string; // "HH:MM"
  close?: string; // "HH:MM"
}

export type ScheduleRow =
  | { kind: "drive"; label: string; minutes: number; at: string }
  | { kind: "break"; label: string; minutes: number; at: string }
  | { kind: "service"; label: string; minutes: number; at: string };

export interface LegRow {
  label: string;
  mins: number;
  km: number;
}

export interface DirectionsResult {
  legMins: number[];
  legKm: number[];
  /** Mapbox Directions geometry (geojson LineString) */
  geometry: GeoJSON.Geometry | null;
}

/** Random short id for client-only stop identity. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

/** Add `days` (can be negative) to a YYYY-MM-DD string. */
export function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(yyyyMmDd + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** True for Mon–Fri local. */
export function isWeekday(yyyyMmDd: string): boolean {
  const dow = new Date(yyyyMmDd + "T00:00:00").getDay();
  return dow >= 1 && dow <= 5;
}

/** Pull a UK postcode + optional HH:MM time from a single line. */
export function extractPostcodeAndTime(line: string): {
  postcode: string | null;
  time?: string;
} {
  const cleaned = line.trim();
  if (!cleaned) return { postcode: null };
  const m = cleaned.match(
    /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*(\d{1,2}:\d{2})?\s*$/i,
  );
  if (!m) return { postcode: null };
  const pc = normalizePostcode(m[1]);
  const time = m[2];
  if (time) {
    const [hh, mm] = time.split(":").map(Number);
    if (
      Number.isFinite(hh) &&
      Number.isFinite(mm) &&
      hh >= 0 &&
      hh <= 23 &&
      mm >= 0 &&
      mm <= 59
    ) {
      return {
        postcode: pc,
        time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      };
    }
  }
  return { postcode: pc };
}

/** Parse a multi-line raw textarea into Stops. Defaults `open`/`close` from the customer. */
export function parseStopsFromRawText(
  rawText: string,
  defaults: { open: string; close: string },
): Stop[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Stop[] = [];
  for (const line of lines) {
    const { postcode, time } = extractPostcodeAndTime(line);
    if (!postcode) continue;
    out.push({
      id: uid(),
      input: line,
      postcode,
      time,
      open: defaults.open,
      close: defaults.close,
    });
  }
  return out;
}

/** Mapbox Geocoding API: postcode → lat/lng. Throws on failure. */
export async function geocodePostcode(
  postcode: string,
  token: string,
): Promise<LngLat> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(postcode)}.json` +
    `?access_token=${encodeURIComponent(token)}&country=gb&types=postcode&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocode failed (${res.status}) for ${postcode}`);
  const data = await res.json();
  const c = data?.features?.[0]?.center;
  if (!Array.isArray(c) || c.length < 2)
    throw new Error(`No geocode match for ${postcode}`);
  return { lng: c[0], lat: c[1] };
}

/** Mapbox Directions API: ordered points → leg minutes/km + geometry. HGV multiplier applied. */
export async function getDirections(
  points: LngLat[],
  token: string,
): Promise<DirectionsResult> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
    `?access_token=${encodeURIComponent(token)}&overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions failed (${res.status})`);
  const data = await res.json();
  const route = data?.routes?.[0];
  const legs = route?.legs;
  if (!Array.isArray(legs) || legs.length === 0)
    throw new Error("Directions missing legs");
  const legMins = legs.map((l: { duration: number }) =>
    Math.max(1, Math.round((Number(l.duration) / 60) * HGV_TIME_MULTIPLIER)),
  );
  const legKm = legs.map((l: { distance: number }) =>
    Math.max(0.1, Number(l.distance) / 1000),
  );
  return { legMins, legKm, geometry: route?.geometry ?? null };
}

/** Total break minutes for a list of leg minutes (45 min after each 4h30 stretch). */
export function computeBreakMinutesForLegs(
  legMins: number[],
  includeBreaks: boolean,
): number {
  if (!includeBreaks) return 0;
  let driveSinceBreak = 0;
  let breakTotal = 0;
  for (const driveMins of legMins) {
    if (
      driveSinceBreak > 0 &&
      driveSinceBreak + driveMins > MAX_DRIVE_BEFORE_BREAK_MINS
    ) {
      breakTotal += BREAK_MINS;
      driveSinceBreak = 0;
    }
    driveSinceBreak += driveMins;
  }
  return breakTotal;
}

/** Build a driver schedule (drive / break / service rows) from leg mins + service time. */
export function buildSchedule(
  startTime: string,
  orderedStops: Stop[],
  stopLegMins: number[],
  serviceMinsDefault: number,
  includeBreaks: boolean,
  fromLabel?: string,
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let t = timeToMinutes(startTime) ?? 480;
  let driveSinceBreak = 0;

  rows.push({
    kind: "service",
    label: `Depart from ${fromLabel || "base"}`,
    minutes: 0,
    at: minutesToTime(t),
  });

  for (let i = 0; i < orderedStops.length; i++) {
    const driveMins = stopLegMins[i] ?? 0;
    if (
      includeBreaks &&
      driveSinceBreak > 0 &&
      driveSinceBreak + driveMins > MAX_DRIVE_BEFORE_BREAK_MINS
    ) {
      rows.push({
        kind: "break",
        label: "45 min break",
        minutes: BREAK_MINS,
        at: minutesToTime(t),
      });
      t += BREAK_MINS;
      driveSinceBreak = 0;
    }
    rows.push({
      kind: "drive",
      label: `Drive to Stop ${i + 1} (${orderedStops[i].postcode})`,
      minutes: driveMins,
      at: minutesToTime(t),
    });
    t += driveMins;
    driveSinceBreak += driveMins;
    rows.push({
      kind: "service",
      label: `Arrive Stop ${i + 1} (${orderedStops[i].postcode})`,
      minutes: serviceMinsDefault,
      at: minutesToTime(t),
    });
    t += serviceMinsDefault;
  }
  return rows;
}

/**
 * Reorder stops so booking-time stops stay in time order (anchors), and
 * non-booked stops are slotted between anchors via nearest-neighbor.
 */
export function orderStopsRespectingBookings(
  stops: Stop[],
  coords: Record<string, LngLat>,
  startLL: LngLat,
): Stop[] {
  const bookingStops = stops
    .filter((s) => s.time && timeToMinutes(s.time) != null)
    .slice()
    .sort(
      (a, b) =>
        (timeToMinutes(a.time!) ?? 0) - (timeToMinutes(b.time!) ?? 0),
    );
  const flexStops = stops.filter((s) => !s.time);

  const nnOrder = (seed: LngLat, pool: Stop[]): Stop[] => {
    const remaining = pool.slice();
    const ordered: Stop[] = [];
    let current = seed;
    while (remaining.length) {
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const ll = coords[remaining[i].postcode];
        if (!ll) continue;
        const d = haversineKm(current, ll);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push(next);
      const nextLL = coords[next.postcode];
      if (nextLL) current = nextLL;
    }
    return ordered;
  };

  if (bookingStops.length === 0) {
    return nnOrder(startLL, flexStops);
  }

  const ordered: Stop[] = [];
  let seed = startLL;
  let remainingFlex = flexStops.slice();
  for (let i = 0; i < bookingStops.length; i++) {
    const anchor = bookingStops[i];
    const anchorLL = coords[anchor.postcode];
    if (!anchorLL) {
      ordered.push(anchor);
      continue;
    }
    const bucket: Stop[] = [];
    const keep: Stop[] = [];
    for (const s of remainingFlex) {
      const sLL = coords[s.postcode];
      if (!sLL) {
        keep.push(s);
        continue;
      }
      const dToSeed = haversineKm(seed, sLL);
      const dSeedToAnchor = haversineKm(seed, anchorLL);
      if (dToSeed <= dSeedToAnchor) bucket.push(s);
      else keep.push(s);
    }
    ordered.push(...nnOrder(seed, bucket));
    ordered.push(anchor);
    seed = anchorLL;
    remainingFlex = keep;
  }
  ordered.push(...nnOrder(seed, remainingFlex));
  return ordered;
}

/** Cumulative km + driving minutes for a list of legs. */
export function legTotals(
  legRows: LegRow[],
  includeBreaks: boolean,
): { driveMins: number; breakMins: number; drivePlusBreaks: number; km: number } {
  const driveMins = legRows.reduce(
    (acc, r) => acc + (Number.isFinite(r.mins) ? r.mins : 0),
    0,
  );
  const km = legRows.reduce(
    (acc, r) => acc + (Number.isFinite(r.km) ? r.km : 0),
    0,
  );
  const breakMins = computeBreakMinutesForLegs(
    legRows.map((l) => l.mins),
    includeBreaks,
  );
  return {
    driveMins,
    breakMins,
    drivePlusBreaks: driveMins + breakMins,
    km: Math.round(km * 10) / 10,
  };
}
