"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { buildEtaChain, type EtaChainResult } from "@/lib/etaChain";
import { createClient } from "@/lib/supabase/client";
import { updateRun as updateRunAction, deleteRun as deleteRunAction } from "@/app/actions/runs";
import type { PlannedRun, ProgressState } from "@/types/runs";
import { rowToRun } from "@/types/runs";
import {
  COMPLETION_RADIUS_METERS,
  MIN_STANDSTILL_MINS,
  HGV_TIME_MULTIPLIER,
  MAX_SPEED_KPH,
  MAX_DRIVE_BEFORE_BREAK_MINS,
  BREAK_MINS,
} from "@/lib/constants";
import { fetchCustomers } from "@/lib/customers";
import { normalizePostcode, parseStops } from "@/lib/postcode-utils";
import { haversineMeters, nextStopIndex, minutesBetween, type LngLat } from "@/lib/geo-utils";
import { useNicknames } from "@/hooks/useNicknames";
import { withNickname } from "@/lib/postcode-nicknames";
import { generateEtaPdf } from "@/lib/generateEtaPdf";
import { computeChainedStarts } from "@/lib/runDuration";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type VehicleSnapshot = {
  vehicle: string;
  lat: number;
  lng: number;
  speedKph?: number;
  heading?: number;
  timestamp?: string; // ISO
};

type StopStatus = "completed" | "on_site" | "pending";

const DEFAULT_PROGRESS: ProgressState = {
  completedIdx: [],
  onSiteIdx: null,
  onSiteSinceMs: null,
  lastInside: false,
};

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

function etaFromNowPlusMinutes(totalMins: number, cutoffMins: number) {
  const now = new Date();
  const eta = new Date(now.getTime() + totalMins * 60_000);

  const hh = String(eta.getHours()).padStart(2, "0");
  const mm = String(eta.getMinutes()).padStart(2, "0");
  const hhmm = `${hh}:${mm}`;

  const etaDate = `${eta.getFullYear()}-${String(eta.getMonth() + 1).padStart(2, "0")}-${String(
    eta.getDate()
  ).padStart(2, "0")}`;

  const minsOfDay = eta.getHours() * 60 + eta.getMinutes();
  return { hhmm, etaDate, afterHours: minsOfDay >= cutoffMins };
}

function SortableStopRow({ id, postcode, index }: { id: string; postcode: string; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 border border-white/10 rounded-xl p-3 bg-white/5"
    >
      <button
        className="w-8 h-8 rounded-lg border border-white/10 bg-black/30 flex items-center justify-center cursor-grab"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ☰
      </button>
      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-semibold text-sm">
        {index + 1}
      </div>
      <div className="font-semibold">{postcode}</div>
    </div>
  );
}

/** Compare two progress states — returns true if anything meaningful changed */
function progressChanged(a: ProgressState, b: ProgressState): boolean {
  if (a.completedIdx.length !== b.completedIdx.length) return true;
  if (a.completedIdx.some((v, i) => v !== b.completedIdx[i])) return true;
  if (a.onSiteIdx !== b.onSiteIdx) return true;
  if (a.onSiteSinceMs !== b.onSiteSinceMs) return true;
  if (a.lastInside !== b.lastInside) return true;
  return false;
}

export default function RunDetailPage() {
  const params = useParams();
  const runId = params?.id as string;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  const router = useRouter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const nicknames = useNicknames();

  const [editingOrder, setEditingOrder] = useState(false);
  const [editStops, setEditStops] = useState<{ id: string; postcode: string }[]>([]);
  const [reRouting, setReRouting] = useState(false);
  const [addingDrop, setAddingDrop] = useState(false);
  const [newDropPC, setNewDropPC] = useState("");
  const [newDropPos, setNewDropPos] = useState<number>(-1); // -1 = end

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

  // Chained start time (computed from sibling runs on same vehicle+date)
  const [chainedStartTime, setChainedStartTime] = useState<string | null>(null);

  // Customer opening/closing times (fetched from DB)
  const [customerTimes, setCustomerTimes] = useState<{ open: string; close: string }>({ open: "08:00", close: "17:00" });

  // Debounce timer for persisting progress to DB
  const progressSaveTimer = useRef<any>(null);

  // Latest progress snapshot from DB (updated by periodic sync)
  const dbProgressRef = useRef<ProgressState | null>(null);

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

  // Fetch sibling runs (same vehicle+date) to compute chained start time
  useEffect(() => {
    if (!run || !run.vehicle?.trim()) return;
    const supabase = createClient();
    supabase
      .from("runs")
      .select("*")
      .eq("vehicle", run.vehicle.trim())
      .eq("date", run.date)
      .order("run_order", { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        if (!data || data.length <= 1) return;
        const siblings = data.map(rowToRun);
        // Sort: by run_order first, then by start_time
        siblings.sort((a, b) => {
          if (a.runOrder != null && b.runOrder != null) return a.runOrder - b.runOrder;
          if (a.runOrder != null) return -1;
          if (b.runOrder != null) return 1;
          return a.startTime.localeCompare(b.startTime);
        });
        const chains = computeChainedStarts(siblings);
        const myChain = chains.get(run.id);
        if (myChain && myChain.chainedStartTime !== run.startTime) {
          setChainedStartTime(myChain.chainedStartTime);
        }
      });
  }, [run?.id, run?.vehicle, run?.date]);

  // Periodically sync progress from DB to pick up cron-written completions
  useEffect(() => {
    if (!runId) return;
    const supabase = createClient();

    const sync = async () => {
      const { data } = await supabase
        .from("runs")
        .select("progress, completed_stop_indexes, completed_meta")
        .eq("id", runId)
        .single();
      if (!data) return;

      const dbProgress: ProgressState = data.progress ?? DEFAULT_PROGRESS;
      dbProgressRef.current = dbProgress;

      // Merge cron completions into local progress
      const local = progressRef.current ?? DEFAULT_PROGRESS;
      const merged = [...new Set([...local.completedIdx, ...dbProgress.completedIdx])].sort((a, b) => a - b);

      if (merged.length > local.completedIdx.length) {
        const updated: ProgressState = { ...local, completedIdx: merged };
        setProgress(updated);
        progressRef.current = updated;
      }

      // Sync completedStopIndexes and completedMeta from DB into run state
      const dbStops: number[] = data.completed_stop_indexes ?? [];
      const dbMeta = data.completed_meta ?? {};
      setRun((prev) => {
        if (!prev) return prev;
        const localStops = prev.completedStopIndexes ?? [];
        const mergedStops = [...new Set([...localStops, ...dbStops])].sort((a, b) => a - b);
        if (mergedStops.length === localStops.length && JSON.stringify(dbMeta) === JSON.stringify(prev.completedMeta)) return prev;
        return { ...prev, completedStopIndexes: mergedStops, completedMeta: { ...(prev.completedMeta ?? {}), ...dbMeta } };
      });
    };

    // Run immediately, then every 60 seconds
    sync();
    const timer = setInterval(sync, 60_000);
    return () => clearInterval(timer);
  }, [runId]);

  // Fetch customer open/close times from DB
  useEffect(() => {
    if (!run) return;
    fetchCustomers().then((customers) => {
      const c = customers.find((cust) => cust.name === run.customer);
      if (c) setCustomerTimes({ open: c.open_time, close: c.close_time });
    });
  }, [run?.customer]);

  // Parse cutoff minutes from customer close time
  const cutoffMins = useMemo(() => {
    const m = customerTimes.close.match(/^(\d{2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 17 * 60;
  }, [customerTimes.close]);

  const stops = useMemo(() => {
    if (!run) return [];
    return parseStops(run.rawText);
  }, [run]);

  // Extract per-stop delivery refs from rawText lines (e.g. "BS1 4DJ 09:00 REF:ABC123")
  const stopRefs = useMemo(() => {
    if (!run) return new Map<number, string>();
    const refs = new Map<number, string>();
    const lines = (run.rawText || "").split(/\r?\n/).filter(Boolean);
    let stopIdx = 0;
    for (const line of lines) {
      const hasPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(line);
      if (hasPostcode) {
        const refMatch = line.match(/REF:(.+?)$/i);
        if (refMatch) refs.set(stopIdx, refMatch[1].trim());
        stopIdx++;
      }
    }
    return refs;
  }, [run]);

  // Extract per-stop booking times from rawText lines (e.g. "B78 3HJ 14:30 REF:...")
  // Falls back to run.collectionTime for the first stop (booking time from email)
  const stopBookingTimes = useMemo(() => {
    if (!run) return new Map<number, string>();
    const times = new Map<number, string>();
    const lines = (run.rawText || "").split(/\r?\n/).filter(Boolean);
    let stopIdx = 0;
    for (const line of lines) {
      const hasPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(line);
      if (hasPostcode) {
        const timeMatch = line.match(/\b(\d{1,2}:\d{2})\b/);
        if (timeMatch) times.set(stopIdx, timeMatch[1]);
        stopIdx++;
      }
    }
    // For single-stop runs, use collectionTime as booking time if not already parsed
    if (!times.has(0) && run.collectionTime) {
      times.set(0, run.collectionTime);
    }
    return times;
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
    // Fire-and-forget server action — only send fields that exist
    const fields: Record<string, any> = {
      date: updated.date,
      vehicle: updated.vehicle,
      loadRef: updated.loadRef,
    };
    if (updated.collectionDate) fields.collectionDate = updated.collectionDate;
    updateRunAction(updated.id, fields);
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
        const effectiveStart = chainedStartTime || currentRun.startTime || "08:00";
        const [hh, mm] = effectiveStart.split(":").map(Number);
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
            nextDayStartHHMM: customerTimes.open,
            nextDayCutoffHHMM: customerTimes.close,
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
  }, [run?.id, run?.startTime, run?.includeBreaks, run?.serviceMins, isFutureRun, vehicleSnap?.lat, vehicleSnap?.lng, coordsByPostcode, stops.join("|"), mapboxToken, customerTimes, chainedStartTime]);

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
        // Merge any cron-written completions into local progress before running
        const current = progressRef.current ?? DEFAULT_PROGRESS;
        const dbSnap = dbProgressRef.current;
        let mergedCompleted = [...current.completedIdx];
        if (dbSnap) {
          for (const idx of dbSnap.completedIdx ?? []) {
            if (!mergedCompleted.includes(idx)) mergedCompleted.push(idx);
          }
          mergedCompleted.sort((a, b) => a - b);
        }
        const p: ProgressState = { ...current, completedIdx: mergedCompleted };

        const nsi = nextStopIndex(stops, p.completedIdx);

        if (nsi == null) {
          // All stops done — check if we need to detect departure from last stop
          if (p.onSiteIdx != null) {
            const trackedPc = stops[p.onSiteIdx];
            const trackedLL = coordsByPostcode[trackedPc];
            const vehicleLLCheck: LngLat = { lng: data.lng, lat: data.lat };
            const nearTracked = trackedLL
              ? haversineMeters(vehicleLLCheck, trackedLL) <= COMPLETION_RADIUS_METERS
              : false;
            if (!nearTracked) {
              p.onSiteIdx = null;
              p.onSiteSinceMs = null;
            }
          }
          if (progressChanged(current, p)) saveProgress(p);
          setEtaText("Done");
          setEtaDetails(null);
          return;
        }

        const nextPc = stops[nsi];
        const nextLL = coordsByPostcode[nextPc];

        const vehicleLL: LngLat = { lng: data.lng, lat: data.lat };

        if (nextLL) {
          const distM = haversineMeters(vehicleLL, nextLL);
          const inside = distM <= COMPLETION_RADIUS_METERS;
          const nowMs = Date.now();

          // 1. If tracking a completed stop (onSiteIdx differs from nsi),
          //    check if vehicle is still near it.
          if (p.onSiteIdx != null && p.onSiteIdx !== nsi) {
            const trackedPc = stops[p.onSiteIdx];
            const trackedLL = coordsByPostcode[trackedPc];
            const nearTracked = trackedLL
              ? haversineMeters(vehicleLL, trackedLL) <= COMPLETION_RADIUS_METERS
              : false;

            if (!nearTracked) {
              p.onSiteIdx = null;
              p.onSiteSinceMs = null;
            }
          }

          // 2. Handle the next uncompleted stop
          if (inside) {
            if (p.onSiteIdx !== nsi) {
              p.onSiteIdx = nsi;
              p.onSiteSinceMs = nowMs;
            }
            p.lastInside = true;

            if (
              p.onSiteSinceMs != null &&
              minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS
            ) {
              if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
              p.completedIdx.sort((a, b) => a - b);
            }
          } else {
            if (p.onSiteIdx === nsi) {
              if (
                p.onSiteSinceMs != null &&
                minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS
              ) {
                if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
                p.completedIdx.sort((a, b) => a - b);
              }
              p.onSiteIdx = null;
              p.onSiteSinceMs = null;
            }
            p.lastInside = false;
          }
        }

        if (progressChanged(current, p)) {
          saveProgress(p);

          // If client detected new completions, also sync completed_stop_indexes + completed_meta
          const newlyCompleted = p.completedIdx.filter((idx) => !current.completedIdx.includes(idx));
          if (newlyCompleted.length) {
            const arrivedISO = current.onSiteSinceMs
              ? new Date(current.onSiteSinceMs).toISOString()
              : new Date().toISOString();
            setRun((prev) => {
              if (!prev) return prev;
              const merged = [...new Set([...(prev.completedStopIndexes ?? []), ...newlyCompleted])].sort((a, b) => a - b);
              const meta: Record<number, any> = { ...(prev.completedMeta ?? {}) };
              for (const idx of newlyCompleted) {
                if (!meta[idx]) meta[idx] = { by: "auto" as const, arrivedISO };
              }
              updateRunAction(prev.id, { completedStopIndexes: merged, completedMeta: meta });
              return { ...prev, completedStopIndexes: merged, completedMeta: meta };
            });
          }
        }

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

        const eta = etaFromNowPlusMinutes(totalMins, cutoffMins);

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
  }, [run?.id, run?.vehicle, run?.includeBreaks, isFutureRun, coordsByPostcode, stops.join("|"), mapboxToken, cutoffMins]);

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

    // Also sync completed_stop_indexes + completed_meta so runs page shows COMPLETE
    // Use functional setRun to avoid stale closure during rapid clicks
    const nowISO = new Date().toISOString();
    setRun((prev) => {
      if (!prev) return prev;
      const newCompleted = [...(prev.completedStopIndexes ?? [])];
      if (!newCompleted.includes(idx)) {
        newCompleted.push(idx);
        newCompleted.sort((a, b) => a - b);
      }
      const newMeta = { ...(prev.completedMeta ?? {}), [idx]: { atISO: nowISO, by: "admin" as const } };
      updateRunAction(prev.id, { completedStopIndexes: newCompleted, completedMeta: newMeta });
      return { ...prev, completedStopIndexes: newCompleted, completedMeta: newMeta };
    });
  }

  function adminUndoCompleted(idx: number) {
    if (!run || !isAdmin) return;
    const current = progressRef.current ?? DEFAULT_PROGRESS;
    const p: ProgressState = { ...current, completedIdx: current.completedIdx.filter((x) => x !== idx) };
    saveProgress(p);

    // Also sync completed_stop_indexes + completed_meta
    setRun((prev) => {
      if (!prev) return prev;
      const newCompleted = (prev.completedStopIndexes ?? []).filter((x) => x !== idx);
      const newMeta = { ...(prev.completedMeta ?? {}) };
      delete newMeta[idx];
      updateRunAction(prev.id, { completedStopIndexes: newCompleted, completedMeta: newMeta });
      return { ...prev, completedStopIndexes: newCompleted, completedMeta: newMeta };
    });
  }

  function adminResetProgress() {
    if (!run || !isAdmin) return;
    const p: ProgressState = { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false };
    saveProgress(p);
    setEtaText("—");
    setEtaDetails(null);

    // Also clear completed_stop_indexes + completed_meta
    updateRunAction(run.id, { completedStopIndexes: [], completedMeta: {} });
    setRun((prev) => prev ? { ...prev, completedStopIndexes: [], completedMeta: {} } : prev);
  }

  async function handleDeleteRun() {
    if (!run || !isAdmin) return;
    if (!confirm("Are you sure you want to delete this run? This cannot be undone.")) return;
    const result = await deleteRunAction(run.id);
    if (result.error) {
      alert("Failed to delete run: " + result.error);
      return;
    }
    router.push("/runs");
  }

  async function handleReRoute() {
    if (!run || !isAdmin || !mapboxToken) return;
    if (!confirm("This will re-optimize the stop order and reset all delivery progress. Continue?")) return;
    setReRouting(true);
    try {
      const fromPC = normalizePostcode(run.fromPostcode);
      const allCoords = await ensureCoords([fromPC, ...stops]);
      const startLL = allCoords[fromPC];

      // Nearest-neighbor ordering
      const remaining = stops.slice();
      const ordered: string[] = [];
      let current = startLL;

      while (remaining.length) {
        let bestIdx = 0;
        let bestD = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const ll = allCoords[remaining[i]];
          if (!ll) continue;
          const d = haversineMeters(current, ll);
          if (d < bestD) {
            bestD = d;
            bestIdx = i;
          }
        }
        const next = remaining.splice(bestIdx, 1)[0];
        ordered.push(next);
        current = allCoords[next];
      }

      const newRawText = ordered.join("\n");
      const resetProgress: ProgressState = { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false };
      await updateRunAction(run.id, { rawText: newRawText, progress: resetProgress, completedStopIndexes: [], completedMeta: {} });
      setRun({ ...run, rawText: newRawText, progress: resetProgress, completedStopIndexes: [], completedMeta: {} });
      setProgress(resetProgress);
      progressRef.current = resetProgress;
      setEtaText("—");
      setEtaDetails(null);
    } catch (e: any) {
      alert("Re-route failed: " + (e?.message || "Unknown error"));
    } finally {
      setReRouting(false);
    }
  }

  async function handleAddDrop() {
    if (!run || !isAdmin || !newDropPC.trim()) return;

    const pc = normalizePostcode(newDropPC.trim());
    if (!pc) return;

    const currentStops = [...stops];
    const insertAt = newDropPos < 0 || newDropPos > currentStops.length
      ? currentStops.length
      : newDropPos;

    currentStops.splice(insertAt, 0, pc);
    const newRawText = currentStops.join("\n");

    // Shift all index-based tracking data at or after insertion point
    const shiftIdx = (idx: number) => idx >= insertAt ? idx + 1 : idx;

    const current = progressRef.current ?? DEFAULT_PROGRESS;
    const newCompletedIdx = current.completedIdx.map(shiftIdx).sort((a, b) => a - b);
    const newOnSiteIdx = current.onSiteIdx != null ? shiftIdx(current.onSiteIdx) : null;

    const newProgress: ProgressState = {
      ...current,
      completedIdx: newCompletedIdx,
      onSiteIdx: newOnSiteIdx,
    };

    const existingCompleted = (run.completedStopIndexes ?? []).map(shiftIdx).sort((a, b) => a - b);

    const existingMeta = run.completedMeta ?? {};
    const newMeta: Record<number, any> = {};
    for (const [k, v] of Object.entries(existingMeta)) {
      newMeta[shiftIdx(Number(k))] = v;
    }

    await updateRunAction(run.id, {
      rawText: newRawText,
      progress: newProgress,
      completedStopIndexes: existingCompleted,
      completedMeta: newMeta,
    });

    setRun({
      ...run,
      rawText: newRawText,
      progress: newProgress,
      completedStopIndexes: existingCompleted,
      completedMeta: newMeta,
    });
    setProgress(newProgress);
    progressRef.current = newProgress;

    // Pre-geocode the new postcode
    ensureCoords([pc]).catch(() => {});

    setNewDropPC("");
    setNewDropPos(-1);
    setAddingDrop(false);
  }

  async function handleRemoveDrop(removeIdx: number) {
    if (!run || !isAdmin) return;
    if (!confirm(`Remove stop ${removeIdx + 1} (${stops[removeIdx]}) from this run?`)) return;

    const currentStops = [...stops];
    currentStops.splice(removeIdx, 1);
    const newRawText = currentStops.join("\n");

    // Shift all index-based tracking data: indexes above removeIdx shift down by 1
    const unshiftIdx = (idx: number) => idx > removeIdx ? idx - 1 : idx;

    const current = progressRef.current ?? DEFAULT_PROGRESS;

    // Remove the deleted index from completedIdx, then shift remaining down
    const newCompletedIdx = current.completedIdx
      .filter((x) => x !== removeIdx)
      .map(unshiftIdx)
      .sort((a, b) => a - b);

    let newOnSiteIdx = current.onSiteIdx;
    if (newOnSiteIdx === removeIdx) {
      newOnSiteIdx = null;
    } else if (newOnSiteIdx != null && newOnSiteIdx > removeIdx) {
      newOnSiteIdx = newOnSiteIdx - 1;
    }

    const newProgress: ProgressState = {
      ...current,
      completedIdx: newCompletedIdx,
      onSiteIdx: newOnSiteIdx,
      onSiteSinceMs: newOnSiteIdx === null ? null : current.onSiteSinceMs,
      lastInside: newOnSiteIdx === null ? false : current.lastInside,
    };

    const existingCompleted = (run.completedStopIndexes ?? [])
      .filter((x) => x !== removeIdx)
      .map(unshiftIdx)
      .sort((a, b) => a - b);

    const existingMeta = run.completedMeta ?? {};
    const newMeta: Record<number, any> = {};
    for (const [k, v] of Object.entries(existingMeta)) {
      const oldIdx = Number(k);
      if (oldIdx === removeIdx) continue;
      newMeta[unshiftIdx(oldIdx)] = v;
    }

    await updateRunAction(run.id, {
      rawText: newRawText,
      progress: newProgress,
      completedStopIndexes: existingCompleted,
      completedMeta: newMeta,
    });

    setRun({
      ...run,
      rawText: newRawText,
      progress: newProgress,
      completedStopIndexes: existingCompleted,
      completedMeta: newMeta,
    });
    setProgress(newProgress);
    progressRef.current = newProgress;
  }

  function handleStartEditOrder() {
    if (!isAdmin) return;
    setEditStops(stops.map((pc, i) => ({ id: `stop-${i}`, postcode: pc })));
    setEditingOrder(true);
  }

  function handleCancelEditOrder() {
    setEditingOrder(false);
    setEditStops([]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setEditStops((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === active.id);
      const newIdx = prev.findIndex((s) => s.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  async function handleSaveOrder() {
    if (!run || !isAdmin) return;
    const newRawText = editStops.map((s) => s.postcode).join("\n");
    const resetProgress: ProgressState = { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false };
    await updateRunAction(run.id, { rawText: newRawText, progress: resetProgress, completedStopIndexes: [], completedMeta: {} });
    setRun({ ...run, rawText: newRawText, progress: resetProgress, completedStopIndexes: [], completedMeta: {} });
    setProgress(resetProgress);
    progressRef.current = resetProgress;
    setEtaText("—");
    setEtaDetails(null);
    setEditingOrder(false);
    setEditStops([]);
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

  // label: show "Next day [opening time]" if ETA falls past customer closing time
  const etaLabel =
    etaText === "—" || etaText === "Done"
      ? etaText
      : etaDetails && (etaDetails.etaDate !== run.date || etaDetails.afterHours)
      ? `Next day ${customerTimes.open}`
      : etaText;

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <a href={`/runs?date=${run.date}`} className="text-blue-400 underline">
            ← Back to runs
          </a>

          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (!run || !etaChain) return;
                generateEtaPdf({ run, etaChain, stops, stopRefs, stopBookingTimes, nicknames });
              }}
              disabled={!etaChain}
              className="px-3 py-1.5 rounded-lg border border-blue-400/30 text-blue-400 hover:bg-blue-400/10 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={etaChain ? "Download ETA schedule as PDF" : "Waiting for ETAs to load..."}
            >
              {etaChain ? "Print ETA" : "Print ETA (loading...)"}
            </button>
            <span className="text-sm text-gray-300">
              Mode:{" "}
              <span className={isAdmin ? "text-emerald-400 font-semibold" : "text-gray-400 font-semibold"}>
                {isAdmin ? "Admin" : "View only"}
              </span>
            </span>
          </div>
        </div>

        <h1 className="text-3xl font-bold mt-6">
          {isAdmin ? (
            <input
              type="date"
              value={run.date}
              onChange={(e) => {
                if (e.target.value) persist({ ...run, date: e.target.value });
              }}
              className="bg-transparent border-b border-white/20 focus:border-blue-400 outline-none text-white text-3xl font-bold w-[10ch] cursor-pointer"
            />
          ) : (
            run.date
          )}
          {" "}• {run.customer}
          {run.runType === "backload" && (
            <span className="ml-3 text-purple-400 text-base font-semibold">BACKLOAD</span>
          )}
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
          {run.runType === "backload" ? (
            <>
              Collection: <span className="text-gray-200 font-semibold">{withNickname(normalizePostcode(run.fromPostcode), nicknames)}</span>
              {run.collectionTime && <> • Booking: <span className="text-gray-200 font-semibold">{run.collectionTime}</span></>}
              {" "}• End at last delivery
              {run.collectionDate && run.collectionDate !== run.date && (
                <span className="text-cyan-400"> • Collect {run.collectionDate} → Deliver {run.date}</span>
              )}
              {isAdmin && (
                <span className="ml-2">
                  • Collection date:{" "}
                  <input
                    type="date"
                    value={run.collectionDate || ""}
                    onChange={(e) => persist({ ...run, collectionDate: e.target.value || undefined })}
                    className="bg-transparent border-b border-white/20 focus:border-blue-400 outline-none text-cyan-400 text-sm w-[9ch] cursor-pointer"
                  />
                </span>
              )}
            </>
          ) : (
            <>
              From {withNickname(normalizePostcode(run.fromPostcode), nicknames)} •{" "}
              {run.returnToBase ? (
                <>Return to base</>
              ) : (
                <>
                  To{" "}
                  <span className="text-gray-200 font-semibold">{effectiveEnd ? withNickname(normalizePostcode(effectiveEnd), nicknames) : "(not set)"}</span>
                </>
              )}
              {run.collectionTime && <> • Booking: <span className="text-gray-200 font-semibold">{run.collectionTime}</span></>}
            </>
          )}{" "}
          • Start {run.startTime}
          {chainedStartTime && <span className="text-yellow-400"> (chained: {chainedStartTime})</span>}
          {" "}• Breaks {run.includeBreaks ? "On" : "Off"}
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

              {nextIdx != null && stopBookingTimes.has(nextIdx) && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-lg font-bold text-amber-300">Booking {stopBookingTimes.get(nextIdx)}</span>
                </div>
              )}
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

            <div className="mt-4 flex gap-2 flex-wrap">
              <button
                onClick={handleReRoute}
                disabled={reRouting || stops.length === 0}
                className="px-4 py-2 rounded-lg border border-blue-400/30 text-blue-400 hover:bg-blue-400/10 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {reRouting ? "Re-routing..." : "Re-route (optimize order)"}
              </button>
              <button
                onClick={handleDeleteRun}
                className="px-4 py-2 rounded-lg border border-red-400/30 text-red-400 hover:bg-red-400/10 text-sm font-medium transition-colors"
              >
                Delete run
              </button>
            </div>
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
              Stops <span className="text-sm text-gray-400">{editingOrder ? "(editing order)" : "(live status)"}</span>
            </div>

            <div className="flex items-center gap-3">
              {isAdmin && !editingOrder && (
                <>
                  <button
                    onClick={handleStartEditOrder}
                    className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
                  >
                    Edit order
                  </button>
                  <button
                    onClick={() => { setAddingDrop(!addingDrop); setNewDropPC(""); setNewDropPos(-1); }}
                    className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
                  >
                    {addingDrop ? "Cancel" : "Add drop"}
                  </button>
                </>
              )}
              {!editingOrder && (
                <div className="text-sm text-gray-400">
                  Next stop:{" "}
                  <span className="text-gray-200 font-semibold">
                    {nextIdx == null ? "—" : `${nextIdx + 1}. ${stops[nextIdx]}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {addingDrop && (
            <div className="mt-3 flex items-end gap-3 flex-wrap border border-white/10 rounded-xl p-3 bg-white/5">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Postcode</label>
                <input
                  value={newDropPC}
                  onChange={(e) => setNewDropPC(e.target.value.toUpperCase())}
                  placeholder="e.g. SW1A 1AA"
                  className="w-40 border border-white/15 rounded-lg px-3 py-2 bg-transparent text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddDrop(); }}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Position</label>
                <select
                  value={newDropPos}
                  onChange={(e) => setNewDropPos(Number(e.target.value))}
                  className="w-40 border border-white/15 rounded-lg px-3 py-2 bg-transparent text-sm"
                >
                  <option value={-1} className="bg-black">End (after stop {stops.length})</option>
                  {stops.map((pc, i) => (
                    <option key={i} value={i} className="bg-black">Before stop {i + 1} ({pc})</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAddDrop}
                disabled={!newDropPC.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                Add
              </button>
            </div>
          )}

          {editingOrder ? (
            <>
              <div className="text-xs text-yellow-400 mt-2 mb-3">
                Drag stops to reorder. Saving will reset delivery progress.
              </div>
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={editStops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {editStops.map((s, idx) => (
                      <SortableStopRow key={s.id} id={s.id} postcode={s.postcode} index={idx} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleSaveOrder}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
                >
                  Save order
                </button>
                <button
                  onClick={handleCancelEditOrder}
                  className="px-4 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : stops.length === 0 ? (
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
                          {withNickname(pc, nicknames)}
                          {status !== "completed" && stopBookingTimes.has(idx) && (
                            <span className="ml-2 text-sm text-amber-300 font-normal">Booking {stopBookingTimes.get(idx)}</span>
                          )}
                          {status !== "completed" && !stopBookingTimes.has(idx) && stopEtaMap[idx] && (
                            <span className="ml-2 text-sm text-blue-300 font-normal">ETA {stopEtaMap[idx]}</span>
                          )}
                        </div>
                        {stopRefs.get(idx) && (
                          <div className="text-xs text-gray-400">Ref: {stopRefs.get(idx)}</div>
                        )}
                        {status === "on_site" && progress?.onSiteSinceMs && (
                          <div className="text-xs text-gray-500">
                            On site for {minutesBetween(progress.onSiteSinceMs, Date.now())} mins
                          </div>
                        )}
                        {status === "completed" && run?.completedMeta?.[idx] && (
                          <div className="text-xs text-gray-500">
                            {run.completedMeta[idx].arrivedISO && (
                              <span>Arrived {new Date(run.completedMeta[idx].arrivedISO!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                            )}
                            {run.completedMeta[idx].arrivedISO && run.completedMeta[idx].atISO && " — "}
                            {run.completedMeta[idx].atISO ? (
                              <span>Left {new Date(run.completedMeta[idx].atISO).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                            ) : run.completedMeta[idx].arrivedISO ? (
                              <span> — Still on site</span>
                            ) : null}
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
                          <button
                            onClick={() => handleRemoveDrop(idx)}
                            className="px-3 py-2 rounded-lg border border-red-500/30 hover:bg-red-500/10 text-red-400 text-sm"
                          >
                            Remove
                          </button>
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
