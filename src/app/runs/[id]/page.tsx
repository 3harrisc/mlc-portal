"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { buildEtaChain, type EtaChainResult } from "@/lib/etaChain";
import { createClient } from "@/lib/supabase/client";
import { updateRun as updateRunAction } from "@/app/actions/runs";
import type { PlannedRun, ProgressState } from "@/types/runs";
import { rowToRun } from "@/types/runs";

type LngLat = { lng: number; lat: number };

type VehicleSnapshot = {
  vehicle: string;
  lat: number;
  lng: number;
  speedKph?: number;
  heading?: number;
  timestamp?: string; // ISO
};

type StopStatus = "completed" | "on_site" | "pending";

// completion rules
const COMPLETION_RADIUS_METERS = 500;
const MIN_STANDSTILL_MINS = 3;
const STANDSTILL_SPEED_KPH = 3;

// ETA realism
const HGV_TIME_MULTIPLIER = 1.15;
const MAX_SPEED_KPH = 88.5; // 55 mph
const MAX_DRIVE_BEFORE_BREAK_MINS = 270; // 4h30
const BREAK_MINS = 45;

// UI rule: show "Next day" if ETA local time >= 17:00 OR date rolls over
const AFTER_HOURS_CUTOFF_MINS = 17 * 60;

const DEFAULT_PROGRESS: ProgressState = {
  completedIdx: [],
  onSiteIdx: null,
  onSiteSinceMs: null,
  lastInside: false,
};

function normalizePostcode(input: string) {
  const s = (input || "").trim().toUpperCase();
  const noSpace = s.replace(/\s+/g, "");
  if (noSpace.length >= 5) {
    const head = noSpace.slice(0, -3);
    const tail = noSpace.slice(-3);
    return `${head} ${tail}`.trim();
  }
  return s;
}

function extractPostcode(line: string): string | null {
  const m = line
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/);
  if (!m) return null;
  return normalizePostcode(`${m[1]} ${m[2]}`);
}

function parseStops(rawText: string): string[] {
  const lines = (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const line of lines) {
    const pc = extractPostcode(line);
    if (pc) out.push(pc);
  }
  return out;
}

function haversineMeters(a: LngLat, b: LngLat) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(la1) * Math.cos(la2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

function minutesBetween(aMs: number, bMs: number) {
  return Math.max(0, Math.round((bMs - aMs) / 60000));
}

function nextStopIndex(stops: string[], completedIdx: number[]) {
  for (let i = 0; i < stops.length; i++) {
    if (!completedIdx.includes(i)) return i;
  }
  return null;
}

async function geocodePostcode(postcode: string, mapboxToken: string): Promise<LngLat> {
  const pc = normalizePostcode(postcode);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    pc
  )}.json?access_token=${encodeURIComponent(mapboxToken)}&country=gb&types=postcode&limit=1`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Geocode failed (${res.status}) for ${pc}`);
  const data = await res.json();
  const c = data?.features?.[0]?.center;
  if (!Array.isArray(c) || c.length < 2) throw new Error(`No geocode match for ${pc}`);
  return { lng: c[0], lat: c[1] };
}

// Mapbox directions for a single leg
async function getDirectionsLeg(from: LngLat, to: LngLat, mapboxToken: string): Promise<{ mins: number; km: number }> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?access_token=${encodeURIComponent(mapboxToken)}&overview=false&steps=false`;

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
  const minsFromMapbox = Math.max(1, Math.round((durationSec / 60) * HGV_TIME_MULTIPLIER));
  const minsBySpeedCap = Math.ceil((km / MAX_SPEED_KPH) * 60);
  const mins = Math.max(minsFromMapbox, minsBySpeedCap);

  return { mins, km: Math.round(km * 10) / 10 };
}

function addBreaksIfNeeded(driveMins: number, includeBreaks: boolean) {
  if (!includeBreaks) return 0;
  if (driveMins <= MAX_DRIVE_BEFORE_BREAK_MINS) return 0;
  const breaks = Math.floor(driveMins / MAX_DRIVE_BEFORE_BREAK_MINS);
  return breaks * BREAK_MINS;
}

function etaFromNowPlusMinutes(totalMins: number) {
  const now = new Date();
  const eta = new Date(now.getTime() + totalMins * 60_000);

  const hh = String(eta.getHours()).padStart(2, "0");
  const mm = String(eta.getMinutes()).padStart(2, "0");
  const hhmm = `${hh}:${mm}`;

  const etaDate = `${eta.getFullYear()}-${String(eta.getMonth() + 1).padStart(2, "0")}-${String(
    eta.getDate()
  ).padStart(2, "0")}`;

  const minsOfDay = eta.getHours() * 60 + eta.getMinutes();
  return { hhmm, etaDate, afterHours: minsOfDay >= AFTER_HOURS_CUTOFF_MINS };
}

export default function RunDetailPage() {
  const params = useParams();
  const runId = params?.id as string;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [run, setRun] = useState<PlannedRun | null>(null);
  const [runLoading, setRunLoading] = useState(true);

  const [vehicleSnap, setVehicleSnap] = useState<VehicleSnapshot | null>(null);
  const [vehicleError, setVehicleError] = useState<string>("");

  const [coordsByPostcode, setCoordsByPostcode] = useState<Record<string, LngLat>>({});
  const geoCacheRef = useRef<Map<string, LngLat>>(new Map());

  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressRef = useRef<ProgressState | null>(null);

  const [etaText, setEtaText] = useState<string>("—");
  const [etaDetails, setEtaDetails] = useState<{ mins: number; km: number; etaDate: string; afterHours: boolean } | null>(
    null
  );
  const [etaChain, setEtaChain] = useState<EtaChainResult | null>(null);

  // Debounce timer for persisting progress to DB
  const progressSaveTimer = useRef<any>(null);

  // Load run from Supabase
  useEffect(() => {
    if (!runId) return;

    const supabase = createClient();
    supabase
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single()
      .then(({ data }) => {
        if (data) {
          const r = rowToRun(data);
          setRun(r);
          const p = r.progress ?? DEFAULT_PROGRESS;
          setProgress(p);
          progressRef.current = p;
        }
        setRunLoading(false);
      });
  }, [runId]);

  const stops = useMemo(() => {
    if (!run) return [];
    return parseStops(run.rawText);
  }, [run]);

  const effectiveEnd = useMemo(() => {
    if (!run) return "";
    if (run.returnToBase) return normalizePostcode(run.fromPostcode);
    const to = normalizePostcode(run.toPostcode || "");
    if (to) return to;
    return stops.length ? stops[stops.length - 1] : "";
  }, [run, stops]);

  /** Persist run field changes to Supabase (admin only) */
  function persist(updated: PlannedRun) {
    if (!isAdmin) return;
    setRun(updated);
    // Fire-and-forget server action
    updateRunAction(updated.id, {
      vehicle: updated.vehicle,
      loadRef: updated.loadRef,
    });
  }

  /** Save progress to Supabase (debounced to avoid rapid writes during polling) */
  function saveProgress(p: ProgressState) {
    setProgress(p);
    progressRef.current = p;

    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(() => {
      if (!run) return;
      updateRunAction(run.id, { progress: p });
    }, 2000);
  }

  async function ensureCoords(postcodes: string[]) {
    if (!mapboxToken) throw new Error("Missing NEXT_PUBLIC_MAPBOX_TOKEN.");
    const unique = Array.from(new Set(postcodes.map(normalizePostcode))).filter(Boolean);

    const next: Record<string, LngLat> = { ...coordsByPostcode };

    for (const pc of unique) {
      if (next[pc]) continue;

      const cached = geoCacheRef.current.get(pc);
      if (cached) {
        next[pc] = cached;
        continue;
      }

      const ll = await geocodePostcode(pc, mapboxToken);
      geoCacheRef.current.set(pc, ll);
      next[pc] = ll;
    }

    setCoordsByPostcode(next);
    return next;
  }

  // pre-geocode
  useEffect(() => {
    if (!run) return;
    if (!mapboxToken) return;

    const pcs = [
      normalizePostcode(run.fromPostcode),
      normalizePostcode(run.toPostcode || ""),
      ...stops.map((s) => normalizePostcode(s)),
    ].filter(Boolean);

    if (!pcs.length) return;

    ensureCoords(pcs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, mapboxToken, stops.join("|")]);

  // Is this run in the future?
  const isFutureRun = useMemo(() => {
    if (!run) return false;
    const [y, mo, d] = run.date.split("-").map(Number);
    const [hh, mm] = (run.startTime || "08:00").split(":").map(Number);
    const runStart = new Date(y, mo - 1, d, hh, mm, 0);
    return runStart.getTime() > Date.now();
  }, [run?.date, run?.startTime]);

  // Scheduled ETA chain (for future runs or as fallback)
  useEffect(() => {
    if (!run || !mapboxToken) return;
    if (!stops.length) return;
    const currentRun = run;

    const completedIdx = progressRef.current?.completedIdx ?? [];
    const remaining = stops
      .map((pc, i) => ({ pc, i }))
      .filter(({ i }) => !completedIdx.includes(i));

    if (!remaining.length) {
      setEtaChain(null);
      return;
    }

    const fromPc = normalizePostcode(currentRun.fromPostcode);
    const allPcs = [fromPc, ...remaining.map((s) => s.pc)];
    const missingCoords = allPcs.some((pc) => !coordsByPostcode[pc]);
    if (missingCoords) return;

    let cancelled = false;

    async function compute() {
      const fromLL = coordsByPostcode[fromPc];
      const remainingWithCoords = remaining.map((s) => ({
        postcode: s.pc,
        coord: coordsByPostcode[s.pc],
      }));

      let startPos: LngLat;
      let startAt: Date;

      if (isFutureRun || !vehicleSnap) {
        startPos = fromLL;
        const [y, mo, d] = currentRun.date.split("-").map(Number);
        const [hh, mm] = (currentRun.startTime || "08:00").split(":").map(Number);
        startAt = new Date(y, mo - 1, d, hh, mm, 0);
      } else {
        startPos = { lng: vehicleSnap.lng, lat: vehicleSnap.lat };
        startAt = new Date();
      }

      const endPc = currentRun.returnToBase ? fromPc : normalizePostcode(currentRun.toPostcode || "");
      const endCoord = endPc ? coordsByPostcode[endPc] : null;

      try {
        const chain = await buildEtaChain({
          startAt,
          startPos,
          stops: remainingWithCoords,
          end: endCoord ? { postcode: endPc, coord: endCoord } : undefined,
          options: {
            mapboxToken,
            hgvTimeMultiplier: HGV_TIME_MULTIPLIER,
            maxSpeedKph: MAX_SPEED_KPH,
            includeBreaks: currentRun.includeBreaks,
            maxDriveBeforeBreakMins: MAX_DRIVE_BEFORE_BREAK_MINS,
            breakMins: BREAK_MINS,
            serviceMins: currentRun.serviceMins,
          },
        });
        if (!cancelled) setEtaChain(chain);
      } catch {
        if (!cancelled) setEtaChain(null);
      }
    }

    compute();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.startTime, run?.includeBreaks, run?.serviceMins, isFutureRun, vehicleSnap?.lat, vehicleSnap?.lng, coordsByPostcode, stops.join("|"), mapboxToken]);

  // Build a map: stop index -> ETA label from the chain
  const stopEtaMap = useMemo(() => {
    const map: Record<number, string> = {};
    if (!etaChain) return map;
    const completedIdx = progress?.completedIdx ?? [];
    const remaining = stops
      .map((_, i) => i)
      .filter((i) => !completedIdx.includes(i));
    for (let li = 0; li < etaChain.legs.length; li++) {
      const leg = etaChain.legs[li];
      if (leg.toLabel.startsWith("Stop") && li < remaining.length) {
        map[remaining[li]] = leg.arriveLabel;
      }
    }
    return map;
  }, [etaChain, stops, progress]);

  // Poll Webfleet + progress engine + next-stop ETA
  useEffect(() => {
    if (isFutureRun) {
      setEtaText("Not yet started");
      setEtaDetails(null);
      setVehicleSnap(null);
      setVehicleError("");
      return;
    }

    let cancelled = false;
    let timer: any;

    async function tick() {
      if (cancelled) return;
      if (!run) return;

      setVehicleError("");

      const vehicle = (run.vehicle || "").trim();
      if (!vehicle) {
        setVehicleSnap(null);
        setEtaText("—");
        setEtaDetails(null);
        return;
      }

      try {
        const res = await fetch(`/api/webfleet/vehicle?vehicle=${encodeURIComponent(vehicle)}`, {
          cache: "no-store",
        });

        if (!res.ok) throw new Error(`Webfleet API failed (${res.status})`);

        const data = (await res.json()) as VehicleSnapshot;
        if (!data || typeof data.lat !== "number" || typeof data.lng !== "number") {
          throw new Error("Webfleet response missing lat/lng");
        }

        if (cancelled) return;

        setVehicleSnap(data);

        // ---- Progress engine ----
        const current = progressRef.current ?? DEFAULT_PROGRESS;
        const p: ProgressState = { ...current, completedIdx: [...current.completedIdx] };

        const nsi = nextStopIndex(stops, p.completedIdx);

        if (nsi == null) {
          saveProgress(p);
          setEtaText("Done");
          setEtaDetails(null);
          return;
        }

        const nextPc = stops[nsi];
        const nextLL = coordsByPostcode[nextPc];

        const vehicleLL: LngLat = { lng: data.lng, lat: data.lat };
        const speedKph = typeof data.speedKph === "number" ? data.speedKph : undefined;

        if (nextLL) {
          const distM = haversineMeters(vehicleLL, nextLL);
          const inside = distM <= COMPLETION_RADIUS_METERS;

          const nowMs = Date.now();
          const stopped = speedKph == null ? false : speedKph <= STANDSTILL_SPEED_KPH;

          if (inside) {
            if (p.onSiteIdx !== nsi) {
              p.onSiteIdx = nsi;
              p.onSiteSinceMs = stopped ? nowMs : null;
              p.lastInside = true;
            } else {
              if (stopped) {
                if (!p.onSiteSinceMs) p.onSiteSinceMs = nowMs;
              } else {
                p.onSiteSinceMs = null;
              }
              p.lastInside = true;
            }

            // Complete while still inside if dwell threshold met
            // Keep onSiteIdx so UI still shows "ON SITE" until vehicle leaves
            if (
              p.onSiteSinceMs != null &&
              minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS
            ) {
              if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
              p.completedIdx.sort((a, b) => a - b);
            }
          } else {
            if (p.onSiteIdx === nsi && p.lastInside) {
              const hadDwell =
                p.onSiteSinceMs != null && minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS;

              if (hadDwell) {
                if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
                p.completedIdx.sort((a, b) => a - b);
              }

              p.onSiteIdx = null;
              p.onSiteSinceMs = null;
            }

            // Clear stale on-site state when stop was completed while inside
            // but nextStopIndex has since advanced past it
            if (
              p.onSiteIdx != null &&
              p.completedIdx.includes(p.onSiteIdx)
            ) {
              p.onSiteIdx = null;
              p.onSiteSinceMs = null;
            }

            p.lastInside = false;
          }
        }

        saveProgress(p);

        // ---- ETA engine (vehicle -> next not-completed stop) ----
        const nsi2 = nextStopIndex(stops, p.completedIdx);
        if (nsi2 == null) {
          setEtaText("Done");
          setEtaDetails(null);
          return;
        }

        const nextPc2 = stops[nsi2];
        const nextLL2 = coordsByPostcode[nextPc2];
        if (!nextLL2) {
          setEtaText("—");
          setEtaDetails(null);
          return;
        }

        if (!mapboxToken) {
          setEtaText("—");
          setEtaDetails(null);
          setVehicleError("Missing NEXT_PUBLIC_MAPBOX_TOKEN (needed for ETA).");
          return;
        }

        const { mins, km } = await getDirectionsLeg(vehicleLL, nextLL2, mapboxToken);
        const breakMins = addBreaksIfNeeded(mins, run.includeBreaks);
        const totalMins = mins + breakMins;

        const eta = etaFromNowPlusMinutes(totalMins);

        setEtaText(eta.hhmm);
        setEtaDetails({ mins: totalMins, km, etaDate: eta.etaDate, afterHours: eta.afterHours });
      } catch (e: any) {
        if (cancelled) return;
        setVehicleError(e?.message || "Failed to load vehicle / ETA");
        setVehicleSnap(null);
        setEtaText("—");
        setEtaDetails(null);
      }
    }

    tick();
    timer = setInterval(tick, 30_000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [run?.id, run?.vehicle, run?.includeBreaks, isFutureRun, coordsByPostcode, stops.join("|"), mapboxToken]);

  const stopStatuses = useMemo(() => {
    const out: StopStatus[] = stops.map(() => "pending");
    const p = progress;
    if (!p) return out;

    for (const i of p.completedIdx) {
      if (i >= 0 && i < out.length) out[i] = "completed";
    }
    if (p.onSiteIdx != null && p.onSiteIdx >= 0 && p.onSiteIdx < out.length) {
      out[p.onSiteIdx] = "on_site";
    }
    return out;
  }, [stops, progress]);

  const nextIdx = useMemo(() => {
    const p = progress;
    return nextStopIndex(stops, p ? p.completedIdx : []);
  }, [stops, progress]);

  function adminMarkCompleted(idx: number) {
    if (!run || !isAdmin) return;
    const current = progressRef.current ?? DEFAULT_PROGRESS;
    const p: ProgressState = { ...current, completedIdx: [...current.completedIdx] };

    if (!p.completedIdx.includes(idx)) {
      p.completedIdx.push(idx);
      p.completedIdx.sort((a, b) => a - b);
    }

    if (p.onSiteIdx === idx) {
      p.onSiteIdx = null;
      p.onSiteSinceMs = null;
      p.lastInside = false;
    }

    saveProgress(p);
  }

  function adminUndoCompleted(idx: number) {
    if (!run || !isAdmin) return;
    const current = progressRef.current ?? DEFAULT_PROGRESS;
    const p: ProgressState = { ...current, completedIdx: current.completedIdx.filter((x) => x !== idx) };
    saveProgress(p);
  }

  function adminResetProgress() {
    if (!run || !isAdmin) return;
    const p: ProgressState = { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false };
    saveProgress(p);
    setEtaText("—");
    setEtaDetails(null);
  }

  if (runLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navigation />
        <div className="max-w-5xl mx-auto p-8">
          <Link href="/runs" className="text-blue-400 underline">
            ← Back to runs
          </Link>
          <div className="mt-6 text-gray-400">Loading run...</div>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navigation />
        <div className="max-w-5xl mx-auto p-8">
          <Link href="/runs" className="text-blue-400 underline">
            ← Back to runs
          </Link>

          <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
            <div className="text-xl font-semibold">Run not found</div>
            <div className="text-gray-400 mt-2">This run ID doesn't exist.</div>
          </div>
        </div>
      </div>
    );
  }

  const vehicleAssigned = (run.vehicle || "").trim().length > 0;

  // label: show "Next day" if date rollover OR after 17:00
  const etaLabel =
    etaText === "—" || etaText === "Done"
      ? etaText
      : etaDetails && (etaDetails.etaDate !== run.date || etaDetails.afterHours)
      ? `Next day ${etaText}`
      : etaText;

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link href="/runs" className="text-blue-400 underline">
            ← Back to runs
          </Link>

          <span className="text-sm text-gray-300">
            Mode:{" "}
            <span className={isAdmin ? "text-emerald-400 font-semibold" : "text-gray-400 font-semibold"}>
              {isAdmin ? "Admin" : "View only"}
            </span>
          </span>
        </div>

        <h1 className="text-3xl font-bold mt-6">
          {run.date} • {run.customer}
          {run.vehicle?.trim() ? (
            <span className="ml-3 text-gray-300 text-base font-semibold">{run.vehicle}</span>
          ) : (
            <span className="ml-3 text-yellow-300 text-base font-semibold">UNASSIGNED</span>
          )}
        </h1>

        {/* Load Reference — editable by admin */}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-sm text-gray-500">Load Ref:</span>
          {isAdmin ? (
            <input
              value={run.loadRef || ""}
              onChange={(e) => persist({ ...run, loadRef: e.target.value })}
              placeholder="Enter load reference..."
              className="text-sm px-2 py-1 bg-white/5 border border-white/10 rounded text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <span className="text-sm text-gray-300 font-medium">
              {run.loadRef || "—"}
            </span>
          )}
          {run.jobNumber && (
            <span className="text-xs text-gray-600 ml-2">Job: {run.jobNumber}</span>
          )}
        </div>

        <div className="text-sm text-gray-400 mt-2">
          From {normalizePostcode(run.fromPostcode)} •{" "}
          {run.returnToBase ? (
            <>Return to base</>
          ) : (
            <>
              To{" "}
              <span className="text-gray-200 font-semibold">{effectiveEnd ? normalizePostcode(effectiveEnd) : "(not set)"}</span>
            </>
          )}{" "}
          • Start {run.startTime} • Breaks {run.includeBreaks ? "On" : "Off"}
        </div>

        {/* Live status card */}
        <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-lg font-semibold">{isFutureRun ? "Scheduled ETA" : "Live ETA"}</div>
              <div className="text-sm text-gray-400 mt-1">
                {isFutureRun
                  ? "Scheduled from start time + Mapbox routing"
                  : "Uses assigned vehicle position (Webfleet) → next stop (Mapbox)"}
              </div>

              {nextIdx != null && (
                <div className="mt-3 text-sm text-gray-300">
                  Next Drop <span className="font-semibold text-white">{stops[nextIdx]}</span>
                  {stopEtaMap[nextIdx] && (
                    <span className="ml-2 text-blue-300 font-semibold">ETA {stopEtaMap[nextIdx]}</span>
                  )}
                </div>
              )}

              <div className="mt-2 text-4xl font-bold">
                {isFutureRun ? "Not yet started" : etaLabel}
              </div>

              {etaDetails && (
                <div className="text-[11px] text-gray-500 mt-2">
                  {etaDetails.km} km • {etaDetails.mins} mins {run.includeBreaks ? "(incl breaks)" : ""}
                </div>
              )}

              {!vehicleAssigned && (
                <div className="mt-3 text-sm text-yellow-300 font-semibold">
                  Assign a vehicle to enable live ETA + on-site/completion.
                </div>
              )}

              {vehicleError && (
                <div className="mt-3 text-sm text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  {vehicleError}
                </div>
              )}

            </div>

            <div className="w-full md:min-w-[280px] md:w-auto">
              <div className="text-sm font-semibold mb-2">Vehicle snapshot</div>
              {!vehicleSnap ? (
                <div className="text-sm text-gray-400 border border-white/10 rounded-xl p-4">
                  {vehicleAssigned ? "Loading..." : "No vehicle assigned."}
                </div>
              ) : (
                <div className="border border-white/10 rounded-xl p-4">
                  <div className="text-sm text-gray-300">
                    <span className="text-gray-500">Reg:</span>{" "}
                    <span className="font-semibold">{vehicleSnap.vehicle || run.vehicle}</span>
                  </div>
                  <div className="text-sm text-gray-300 mt-1">
                    <span className="text-gray-500">Speed:</span>{" "}
                    <span className="font-semibold">
                      {typeof vehicleSnap.speedKph === "number" ? `${Math.round(vehicleSnap.speedKph)} kph` : "—"}
                    </span>
                  </div>
                  <div className="text-sm text-gray-300 mt-1">
                    <span className="text-gray-500">Coords:</span>{" "}
                    <span className="font-semibold">
                      {vehicleSnap.lat.toFixed(5)}, {vehicleSnap.lng.toFixed(5)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Updated: {vehicleSnap.timestamp ? new Date(vehicleSnap.timestamp).toLocaleString() : "just now"}
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={adminResetProgress}
                    className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
                  >
                    Reset progress
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Admin controls */}
        {isAdmin ? (
          <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
            <div className="text-lg font-semibold mb-4">Admin controls</div>

            <label className="block text-sm font-semibold mb-2">Vehicle</label>
            <input
              value={run.vehicle || ""}
              onChange={(e) => persist({ ...run, vehicle: e.target.value })}
              placeholder="Assign vehicle (must match Webfleet name/registration)"
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
            />

          </div>
        ) : (
          <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
            <div className="text-lg font-semibold">View only</div>
            <div className="text-sm text-gray-400 mt-2">
              Customers can view run details and statuses, but cannot change routing, stops, vehicle, or settings.
            </div>
          </div>
        )}

        {/* Stops list */}
        <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-lg font-semibold">
              Stops <span className="text-sm text-gray-400">(live status)</span>
            </div>

            <div className="text-sm text-gray-400">
              Next stop:{" "}
              <span className="text-gray-200 font-semibold">
                {nextIdx == null ? "—" : `${nextIdx + 1}. ${stops[nextIdx]}`}
              </span>
            </div>
          </div>

          {stops.length === 0 ? (
            <div className="text-gray-400 mt-4">No postcodes parsed from this run.</div>
          ) : (
            <div className="space-y-2 mt-4">
              {stops.map((pc, idx) => {
                const status = stopStatuses[idx] ?? "pending";
                const isNext = nextIdx === idx;

                const badge =
                  status === "completed"
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-200"
                    : status === "on_site"
                    ? "bg-yellow-500/15 border-yellow-500/30 text-yellow-200"
                    : isNext
                    ? "bg-blue-500/15 border-blue-500/30 text-blue-200"
                    : "bg-white/5 border-white/10 text-gray-300";

                const badgeText =
                  status === "completed" ? "COMPLETED" : status === "on_site" ? "ON SITE" : isNext ? "NEXT" : "PENDING";

                return (
                  <div
                    key={`${pc}-${idx}`}
                    className="border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-semibold">
                        {idx + 1}
                      </div>

                      <div>
                        <div className="font-semibold">
                          {pc}
                          {stopEtaMap[idx] && status !== "completed" && (
                            <span className="ml-2 text-sm text-blue-300 font-normal">ETA {stopEtaMap[idx]}</span>
                          )}
                        </div>
                        {status === "on_site" && progress?.onSiteSinceMs && (
                          <div className="text-xs text-gray-500">
                            Stopped for {minutesBetween(progress.onSiteSinceMs, Date.now())} mins (will complete on leaving)
                          </div>
                        )}
                        {status === "completed" && run?.completedMeta?.[idx] && (
                          <div className="text-xs text-gray-500">
                            {run.completedMeta[idx].arrivedISO && (
                              <span>Arrived {new Date(run.completedMeta[idx].arrivedISO!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                            )}
                            {run.completedMeta[idx].arrivedISO && run.completedMeta[idx].atISO && " — "}
                            {run.completedMeta[idx].atISO && (
                              <span>Left {new Date(run.completedMeta[idx].atISO).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className={`px-2 py-1 rounded-lg border text-xs font-semibold ${badge}`}>{badgeText}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        className="text-blue-400 underline text-sm"
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pc)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>

                      {isAdmin && (
                        <>
                          {status !== "completed" ? (
                            <button
                              onClick={() => adminMarkCompleted(idx)}
                              className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
                            >
                              Mark complete
                            </button>
                          ) : (
                            <button
                              onClick={() => adminUndoCompleted(idx)}
                              className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
                            >
                              Undo
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
