// src/lib/etaChain.ts
// Drop-in helper: builds an ETA “chain” across remaining stops (vehicle -> stop N -> stop N+1 ...)
// Uses Mapbox Directions per-leg + HGV multiplier + 55mph cap + optional WTD break logic.
// NOTE: This does NOT include service time unless you pass serviceMins.
// NOTE: “Next day” rule here is only for DISPLAY (after 17:00 shows "Next day").
// You can tighten this later to actually roll into the next day with working windows.

import { normalizePostcode } from "@/lib/postcode-utils";
import type { LngLat } from "@/lib/geo-utils";
export type { LngLat };

export type EtaLeg = {
  fromLabel: string;
  toLabel: string;
  fromPostcode?: string;
  toPostcode?: string;
  km: number;
  driveMins: number; // driving only (after multiplier + speed cap)
  breakMins: number; // break minutes inserted before/during this leg (if needed)
  serviceMins: number; // time on site at arrival (if included)
  departAtISO: string;
  arriveAtISO: string;
  departAtHHMM: string;
  arriveAtHHMM: string;
  arriveLabel: string; // "HH:MM" or "Next day HH:MM"
};

export type EtaChainResult = {
  startedAtISO: string;
  legs: EtaLeg[];
  totalKm: number;
  totalDriveMins: number;
  totalBreakMins: number;
  totalServiceMins: number;
  totalMins: number;
  finalArriveAtISO: string;
  finalArriveAtHHMM: string;
  finalArriveLabel: string;
};

export type EtaChainOptions = {
  mapboxToken: string;

  // Adjust Mapbox "car" driving to HGV reality
  hgvTimeMultiplier?: number; // default 1.15

  // 55mph cap: never allow faster than this (kph)
  maxSpeedKph?: number; // default 88.5 (55 mph)

  includeBreaks?: boolean; // default true
  maxDriveBeforeBreakMins?: number; // default 270 (4h30)
  breakMins?: number; // default 45

  // If you want to add on-site time at each stop
  serviceMins?: number; // default 0

  // Working day window — if an arrival/departure exceeds cutoff, roll to next day start
  nextDayCutoffHHMM?: string; // default "17:00"
  nextDayStartHHMM?: string; // default "08:00"
};



function timeToMins(hhmm: string) {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function fmtHHMM(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function addMins(date: Date, mins: number) {
  return new Date(date.getTime() + mins * 60_000);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

async function getDirectionsLeg(
  from: LngLat,
  to: LngLat,
  token: string,
  hgvTimeMultiplier: number,
  maxSpeedKph: number
): Promise<{ mins: number; km: number }> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?access_token=${encodeURIComponent(token)}&overview=false&steps=false`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Mapbox Directions failed (${res.status})`);
  const data = await res.json();

  const route = data?.routes?.[0];
  const durationSec = Number(route?.duration);
  const distanceM = Number(route?.distance);

  if (!Number.isFinite(durationSec) || !Number.isFinite(distanceM)) {
    throw new Error("Mapbox Directions missing duration/distance");
  }

  const km = Math.max(0.1, distanceM / 1000);

  // base mins from mapbox
  const minsFromMapbox = Math.max(1, Math.round((durationSec / 60) * hgvTimeMultiplier));

  // enforce max speed cap (never allow faster than 55mph)
  const minsBySpeedCap = Math.ceil((km / maxSpeedKph) * 60);

  return { mins: Math.max(minsFromMapbox, minsBySpeedCap), km: round1(km) };
}

function applyNextDayLabel(arrive: Date, startDate: Date, cutoffHHMM: string) {
  const hhmm = fmtHHMM(arrive);
  // If the arrival is on a different calendar day than the start, label as next day
  const sameDay =
    arrive.getFullYear() === startDate.getFullYear() &&
    arrive.getMonth() === startDate.getMonth() &&
    arrive.getDate() === startDate.getDate();
  if (!sameDay) return `Next day ${hhmm}`;
  const cutoff = timeToMins(cutoffHHMM) ?? 17 * 60;
  const arriveMins = arrive.getHours() * 60 + arrive.getMinutes();
  return arriveMins > cutoff ? `Next day ${hhmm}` : hhmm;
}

/**
 * Compute ETA chain:
 * - starts at `startAt` (defaults to now)
 * - first leg is vehicle position -> next stop
 * - then each remaining stop -> next stop (and optional finalEnd)
 * - break logic is continuous DRIVING time (break resets the counter)
 */
export async function buildEtaChain(params: {
  startAt?: Date;
  startPos: LngLat; // vehicle position NOW
  // remaining stops in order (postcodes + coords already known)
  stops: Array<{ postcode: string; coord: LngLat }>;
  // optional: final end after last stop (e.g. base). If omitted, chain ends at last stop.
  end?: { postcode: string; coord: LngLat };
  options: EtaChainOptions;
}): Promise<EtaChainResult> {
  const {
    startAt = new Date(),
    startPos,
    stops,
    end,
    options,
  } = params;

  const mapboxToken = options.mapboxToken;
  if (!mapboxToken) throw new Error("Missing mapboxToken");

  const hgvTimeMultiplier = options.hgvTimeMultiplier ?? 1.15;
  const maxSpeedKph = options.maxSpeedKph ?? 88.5;

  const includeBreaks = options.includeBreaks ?? true;
  const maxDriveBeforeBreakMins = options.maxDriveBeforeBreakMins ?? 270;
  const breakMins = options.breakMins ?? 45;

  const serviceMinsDefault = options.serviceMins ?? 0;
  const cutoffHHMM = options.nextDayCutoffHHMM ?? "17:00";
  const nextDayStartHHMM = options.nextDayStartHHMM ?? "08:00";
  const cutoffMins = timeToMins(cutoffHHMM) ?? 17 * 60;
  const nextDayStartMins = timeToMins(nextDayStartHHMM) ?? 8 * 60;

  if (!stops.length) {
    return {
      startedAtISO: startAt.toISOString(),
      legs: [],
      totalKm: 0,
      totalDriveMins: 0,
      totalBreakMins: 0,
      totalServiceMins: 0,
      totalMins: 0,
      finalArriveAtISO: startAt.toISOString(),
      finalArriveAtHHMM: fmtHHMM(startAt),
      finalArriveLabel: applyNextDayLabel(startAt, startAt, cutoffHHMM),
    };
  }

  // Build waypoints list: vehicle -> stop1 -> stop2 ... -> stopN -> (end?)
  const points: Array<{ label: string; postcode?: string; coord: LngLat }> = [
    { label: "Vehicle", coord: startPos },
    ...stops.map((s, i) => ({ label: `Stop ${i + 1}`, postcode: normalizePostcode(s.postcode), coord: s.coord })),
  ];

  if (end) {
    points.push({ label: "End", postcode: normalizePostcode(end.postcode), coord: end.coord });
  }

  const legs: EtaLeg[] = [];

  let cursor = new Date(startAt);
  let driveSinceBreak = 0;

  let totalKm = 0;
  let totalDriveMins = 0;
  let totalBreakMins = 0;
  let totalServiceMins = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];

    // compute drive leg
    const { mins: driveMins, km } = await getDirectionsLeg(
      from.coord,
      to.coord,
      mapboxToken,
      hgvTimeMultiplier,
      maxSpeedKph
    );

    // Break logic: account for accumulated driving + this leg
    let insertedBreak = 0;
    if (includeBreaks) {
      const totalDrive = driveSinceBreak + driveMins;
      if (totalDrive > maxDriveBeforeBreakMins) {
        const numBreaks = Math.floor(totalDrive / maxDriveBeforeBreakMins);
        insertedBreak = numBreaks * breakMins;
        driveSinceBreak = totalDrive - numBreaks * maxDriveBeforeBreakMins;
      } else {
        driveSinceBreak = totalDrive;
      }
    }

    if (insertedBreak > 0) {
      totalBreakMins += insertedBreak;
    }

    const departAt = new Date(cursor);
    cursor = addMins(cursor, driveMins + insertedBreak);

    let arriveAt = new Date(cursor);

    // service time applies only when arriving at a STOP (not vehicle, not end)
    let serviceMins = 0;
    if (to.label.startsWith("Stop")) {
      // If arrival is past the working day cutoff, the customer won't be
      // available until they open — roll arrival to next day opening time.
      const arriveMins = arriveAt.getHours() * 60 + arriveAt.getMinutes();
      if (arriveMins >= cutoffMins) {
        const rolled = new Date(arriveAt);
        rolled.setDate(rolled.getDate() + 1);
        rolled.setHours(Math.floor(nextDayStartMins / 60), nextDayStartMins % 60, 0, 0);
        arriveAt = rolled;
        cursor = new Date(arriveAt);
        driveSinceBreak = 0;
      }

      serviceMins = serviceMinsDefault;
      cursor = addMins(cursor, serviceMins);
      totalServiceMins += serviceMins;

      // If departure (post-service) is past cutoff, roll cursor to next day
      const cursorMins = cursor.getHours() * 60 + cursor.getMinutes();
      if (cursorMins >= cutoffMins) {
        const nextDay = new Date(cursor);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(Math.floor(nextDayStartMins / 60), nextDayStartMins % 60, 0, 0);
        cursor = nextDay;
        driveSinceBreak = 0;
      }
    }

    totalKm += km;
    totalDriveMins += driveMins;

    legs.push({
      fromLabel: from.label,
      toLabel: to.label,
      fromPostcode: from.postcode,
      toPostcode: to.postcode,
      km,
      driveMins,
      breakMins: insertedBreak,
      serviceMins,
      departAtISO: departAt.toISOString(),
      arriveAtISO: arriveAt.toISOString(),
      departAtHHMM: fmtHHMM(departAt),
      arriveAtHHMM: fmtHHMM(arriveAt),
      arriveLabel: applyNextDayLabel(arriveAt, startAt, cutoffHHMM),
    });
  }

  const totalMins = totalDriveMins + totalBreakMins + totalServiceMins;
  const finalArriveAtISO = legs.length ? legs[legs.length - 1].arriveAtISO : startAt.toISOString();
  const finalArriveDate = new Date(finalArriveAtISO);

  return {
    startedAtISO: startAt.toISOString(),
    legs,
    totalKm: round1(totalKm),
    totalDriveMins,
    totalBreakMins,
    totalServiceMins,
    totalMins,
    finalArriveAtISO,
    finalArriveAtHHMM: fmtHHMM(finalArriveDate),
    finalArriveLabel: applyNextDayLabel(finalArriveDate, startAt, cutoffHHMM),
  };
}
