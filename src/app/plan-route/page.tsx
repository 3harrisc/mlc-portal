"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { createRuns as createRunsAction, nextJobNumber } from "@/app/actions/runs";
import { createTemplate as createTemplateAction, deleteTemplate as deleteTemplateAction } from "@/app/actions/templates";
import type { PlannedRun, CustomerKey, RouteTemplate, RunType } from "@/types/runs";
import { rowToRun, rowToTemplate } from "@/types/runs";
import { HGV_TIME_MULTIPLIER, MAX_DRIVE_BEFORE_BREAK_MINS, BREAK_MINS, DEFAULT_SERVICE_MINS, DEFAULT_START_TIME } from "@/lib/constants";
import { fetchCustomers, DEFAULT_BASE } from "@/lib/customers";
import type { Customer } from "@/types/runs";
import { normalizePostcode } from "@/lib/postcode-utils";
import { haversineKm, type LngLat } from "@/lib/geo-utils";
import { timeToMinutes, minutesToTime } from "@/lib/time-utils";

type Stop = {
  id: string;
  input: string;
  postcode: string;
  time?: string; // "HH:MM" booking time
  open?: string; // "HH:MM"
  close?: string; // "HH:MM"
};

type ScheduleRow =
  | { kind: "drive"; label: string; minutes: number; at: string }
  | { kind: "break"; label: string; minutes: number; at: string }
  | { kind: "service"; label: string; minutes: number; at: string };

type LegRow = { label: string; mins: number; km: number };

function uid() {
  return Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

function extractPostcodeAndTime(line: string): { postcode: string | null; time?: string } {
  const cleaned = line.trim();
  if (!cleaned) return { postcode: null };

  const m = cleaned.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*(\d{1,2}:\d{2})?\s*$/i);
  if (!m) return { postcode: null };
  const pc = normalizePostcode(m[1]);
  const time = m[2];
  if (time) {
    const [hh, mm] = time.split(":").map((x) => Number(x));
    if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return { postcode: pc, time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
    }
  }
  return { postcode: pc };
}

function addDays(yyyyMmDd: string, days: number) {
  const d = new Date(yyyyMmDd + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekday(yyyyMmDd: string) {
  const dow = new Date(yyyyMmDd + "T00:00:00").getDay();
  return dow >= 1 && dow <= 5;
}

async function geocode(postcode: string, token: string): Promise<LngLat> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    postcode
  )}.json?access_token=${encodeURIComponent(token)}&country=gb&types=postcode&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocode failed (${res.status}) for ${postcode}`);
  const data = await res.json();
  const c = data?.features?.[0]?.center;
  if (!Array.isArray(c) || c.length < 2) throw new Error(`No geocode match for ${postcode}`);
  return { lng: c[0], lat: c[1] };
}

async function getDirections(points: LngLat[], token: string): Promise<{ legMins: number[]; legKm: number[]; geometry: any | null }> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
    `?access_token=${encodeURIComponent(token)}&overview=full&geometries=geojson&steps=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions failed (${res.status})`);
  const data = await res.json();
  const route = data?.routes?.[0];
  const legs = route?.legs;
  if (!Array.isArray(legs) || legs.length === 0) throw new Error("Directions missing legs");

  const legMins = legs.map((l: any) => Math.max(1, Math.round((Number(l.duration) / 60) * HGV_TIME_MULTIPLIER)));
  const legKm = legs.map((l: any) => Math.max(0.1, Number(l.distance) / 1000));
  const geometry = route?.geometry ?? null;

  return { legMins, legKm, geometry };
}

function computeBreakMinutesForLegs(legMins: number[], includeBreaks: boolean) {
  if (!includeBreaks) return 0;

  let driveSinceBreak = 0;
  let breakTotal = 0;

  for (const driveMins of legMins) {
    if (driveSinceBreak > 0 && driveSinceBreak + driveMins > MAX_DRIVE_BEFORE_BREAK_MINS) {
      breakTotal += BREAK_MINS;
      driveSinceBreak = 0;
    }
    driveSinceBreak += driveMins;
  }
  return breakTotal;
}

function buildSchedule(
  startTime: string,
  orderedStops: Stop[],
  stopLegMins: number[],
  serviceMinsDefault: number,
  includeBreaks: boolean,
  fromPostcode?: string
) {
  const rows: ScheduleRow[] = [];
  let t = timeToMinutes(startTime) ?? 480;
  let driveSinceBreak = 0;

  rows.push({
    kind: "service",
    label: `Depart from ${fromPostcode || "base"}`,
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
      rows.push({ kind: "break", label: "45 min break", minutes: BREAK_MINS, at: minutesToTime(t) });
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

function SortableStopRow({
  stop,
  index,
  onRemove,
}: {
  stop: Stop;
  index: number;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-4 border border-white/10 rounded-xl p-4 bg-white/5"
    >
      <div className="flex items-center gap-3">
        <button
          className="w-10 h-10 rounded-lg border border-white/10 bg-black/30 flex items-center justify-center"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ☰
        </button>

        <div>
          <div className="text-lg font-semibold">
            {index + 1}. {stop.postcode}
          </div>
          <div className="text-xs text-gray-400">Input: {stop.input}</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-sm text-gray-300">
          {stop.time ? (
            <span>
              Booking: <span className="font-semibold">{stop.time}</span>
            </span>
          ) : (
            <span className="text-gray-500">No booking time</span>
          )}
          <span className="mx-2 text-gray-600">•</span>
          <span className="text-gray-400">
            Open: {stop.open}–{stop.close}
          </span>
        </div>

        <button onClick={() => onRemove(stop.id)} className="px-4 py-2 rounded-lg border border-white/15 hover:bg-white/10">
          Remove
        </button>
      </div>
    </div>
  );
}

export default function PlanRoutePage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, profile, router]);

  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<CustomerKey>("Montpellier");
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [routeType, setRouteType] = useState<RunType>("regular");

  const [fromPostcode, setFromPostcode] = useState<string>(DEFAULT_BASE);
  const [toPostcode, setToPostcode] = useState<string>(DEFAULT_BASE);
  const [returnToBase, setReturnToBase] = useState<boolean>(true);

  // Backload-specific
  const [collectFromPostcode, setCollectFromPostcode] = useState<string>("");
  const [collectionTime, setCollectionTime] = useState<string>("");

  const [vehicle, setVehicle] = useState<string>("");
  const [loadRef, setLoadRef] = useState<string>("");

  const [startTime, setStartTime] = useState<string>(DEFAULT_START_TIME);
  const [serviceMins, setServiceMins] = useState<number>(DEFAULT_SERVICE_MINS);

  // breaks toggle
  const [includeBreaks, setIncludeBreaks] = useState<boolean>(true);

  const [rawText, setRawText] = useState<string>("");

  const [stops, setStops] = useState<Stop[]>([]);
  const [routeError, setRouteError] = useState<string>("");

  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [legRows, setLegRows] = useState<LegRow[]>([]);

  const [mapMode, setMapMode] = useState<"pins" | "route" | "route+legs">("pins");

  // Templates + runs + repeat controls
  const [templates, setTemplates] = useState<RouteTemplate[]>([]);
  const [templateName, setTemplateName] = useState<string>("");
  const [plannedRuns, setPlannedRuns] = useState<PlannedRun[]>([]);
  const [repeatMonFri, setRepeatMonFri] = useState<boolean>(false);
  const [repeatWeeks, setRepeatWeeks] = useState<number>(1);
  const [repeatStartDate, setRepeatStartDate] = useState<string>(date);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [runSearch, setRunSearch] = useState("");

  // Map state
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const mapboxglRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeSourceReadyRef = useRef<boolean>(false);

  const [coordsByPostcode, setCoordsByPostcode] = useState<Record<string, LngLat>>({});
  const geoCacheRef = useRef<Map<string, LngLat>>(new Map());

  // Load from Supabase on mount
  useEffect(() => {
    const supabase = createClient();

    supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setTemplates((data ?? []).map(rowToTemplate));
      });

    supabase
      .from("runs")
      .select("*")
      .order("date", { ascending: true })
      .then(({ data }) => {
        setPlannedRuns((data ?? []).map(rowToRun));
      });

    fetchCustomers().then(setAllCustomers);
  }, []);

  // Keep to=from when returnToBase
  useEffect(() => {
    if (returnToBase) setToPostcode(fromPostcode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnToBase]);

  useEffect(() => {
    if (returnToBase) setToPostcode(fromPostcode);
  }, [fromPostcode, returnToBase]);

  useEffect(() => {
    setRepeatStartDate(date);
  }, [date]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const stopIds = useMemo(() => stops.map((s) => s.id), [stops]);

  // Totals for legs (driving / driving+breaks)
  const totals = useMemo(() => {
    const driveMins = legRows.reduce((acc, r) => acc + (Number.isFinite(r.mins) ? r.mins : 0), 0);
    const km = legRows.reduce((acc, r) => acc + (Number.isFinite(r.km) ? r.km : 0), 0);
    const breakMins = computeBreakMinutesForLegs(
      legRows.map((l) => l.mins),
      includeBreaks
    );
    return {
      driveMins,
      breakMins,
      drivePlusBreaks: driveMins + breakMins,
      km: Math.round(km * 10) / 10,
    };
  }, [legRows, includeBreaks]);

  function parseStopsFromText() {
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: Stop[] = [];
    const cust = allCustomers.find((c) => c.name === customer);
    const defOpen = { open: cust?.open_time ?? "08:00", close: cust?.close_time ?? "17:00" };

    for (const line of lines) {
      const { postcode, time } = extractPostcodeAndTime(line);
      if (!postcode) continue;

      parsed.push({
        id: uid(),
        input: line,
        postcode,
        time,
        open: defOpen.open,
        close: defOpen.close,
      });
    }

    setStops(parsed);
    setScheduleRows([]);
    setLegRows([]);
    setRouteError(parsed.length ? "" : "No valid postcodes found.");
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    const oldIndex = stops.findIndex((s) => s.id === active.id);
    const newIndex = stops.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(stops, oldIndex, newIndex);
    setStops(next);

    setScheduleRows([]);
    setLegRows([]);
  }

  function removeStop(id: string) {
    setStops((prev) => prev.filter((s) => s.id !== id));
    setScheduleRows([]);
    setLegRows([]);
  }

  async function ensureCoords(postcodes: string[]) {
    if (!mapboxToken) throw new Error("Missing Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN).");

    const unique = Array.from(new Set(postcodes.map(normalizePostcode)));
    const updates: Record<string, LngLat> = { ...coordsByPostcode };

    for (const pc of unique) {
      if (updates[pc]) continue;
      const cached = geoCacheRef.current.get(pc);
      if (cached) {
        updates[pc] = cached;
        continue;
      }
      const ll = await geocode(pc, mapboxToken);
      geoCacheRef.current.set(pc, ll);
      updates[pc] = ll;
    }

    setCoordsByPostcode(updates);
    return updates;
  }

  // Respect booking times: booked stops in time order; flex stops NN between anchors
  async function routeRespectBookings() {
    setRouteError("");
    setScheduleRows([]);
    setLegRows([]);

    if (!stops.length) {
      setRouteError("No stops. Paste postcodes then click Preview list.");
      return;
    }

    const from = normalizePostcode(fromPostcode);

    const to =
      returnToBase
        ? normalizePostcode(fromPostcode)
        : (normalizePostcode(toPostcode || "") || "");

    const pcs = [from, ...stops.map((s) => s.postcode), ...(to ? [to] : [])];

    let coords: Record<string, LngLat>;
    try {
      coords = await ensureCoords(pcs);
    } catch (e: any) {
      setRouteError(e?.message || "Geocoding failed");
      return;
    }

    const bookingStops = stops
      .filter((s) => s.time && timeToMinutes(s.time) != null)
      .slice()
      .sort((a, b) => (timeToMinutes(a.time!) ?? 0) - (timeToMinutes(b.time!) ?? 0));

    const flexStops = stops.filter((s) => !s.time);

    const startLL = coords[from];

    function nnOrder(seed: LngLat, pool: Stop[]) {
      const remaining = pool.slice();
      const ordered: Stop[] = [];
      let current = seed;

      while (remaining.length) {
        let bestIdx = 0;
        let bestD = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const ll = coords[remaining[i].postcode];
          const d = haversineKm(current, ll);
          if (d < bestD) {
            bestD = d;
            bestIdx = i;
          }
        }
        const next = remaining.splice(bestIdx, 1)[0];
        ordered.push(next);
        current = coords[next.postcode];
      }
      return ordered;
    }

    const ordered: Stop[] = [];
    let seed = startLL;
    const anchored = bookingStops;

    if (anchored.length === 0) {
      ordered.push(...nnOrder(seed, flexStops));
    } else {
      let remainingFlex = flexStops.slice();

      for (let i = 0; i < anchored.length; i++) {
        const anchor = anchored[i];
        const anchorLL = coords[anchor.postcode];

        const bucket: Stop[] = [];
        const keep: Stop[] = [];

        for (const s of remainingFlex) {
          const sLL = coords[s.postcode];
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
    }

    setStops(ordered);

    try {
      const routePoints: LngLat[] = [coords[from], ...ordered.map((s) => coords[s.postcode])];

      const usingLastDropAsEnd = !returnToBase && !to;
      const endLL = usingLastDropAsEnd ? null : coords[to || from];

      const routePointsWithEnd: LngLat[] = endLL ? [...routePoints, endLL] : routePoints;

      const dirs = await getDirections(routePointsWithEnd, mapboxToken);

      const stopLegMins = dirs.legMins.slice(0, ordered.length);
      const sched = buildSchedule(startTime, ordered, stopLegMins, serviceMins, includeBreaks, from);
      setScheduleRows(sched);

      const legs: LegRow[] = [];
      for (let i = 0; i < dirs.legMins.length; i++) {
        const fromLabel = i === 0 ? "Start" : `Stop ${i}`;
        const toLabel =
          i === ordered.length
            ? (endLL ? "End" : `Stop ${i + 1}`)
            : `Stop ${i + 1}`;
        legs.push({
          label: `${fromLabel} → ${toLabel}`,
          mins: dirs.legMins[i],
          km: Math.round(dirs.legKm[i] * 10) / 10,
        });
      }
      setLegRows(legs);

      if (dirs.geometry && mapRef.current && mapMode !== "pins") {
        const map = mapRef.current;

        try {
          if (map.getLayer("mlc-route-line")) map.removeLayer("mlc-route-line");
          if (map.getSource("mlc-route")) map.removeSource("mlc-route");
        } catch {
          // ignore
        }

        map.addSource("mlc-route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: dirs.geometry,
          },
        });

        map.addLayer({
          id: "mlc-route-line",
          type: "line",
          source: "mlc-route",
          paint: {
            "line-width": 4,
            "line-opacity": 0.85,
          },
        });

        routeSourceReadyRef.current = true;
      }
    } catch (e: any) {
      setRouteError(e?.message || "Schedule/legs build failed");
    }
  }

  // Backload routing: collection → deliveries (no return)
  async function routeBackload() {
    setRouteError("");
    setScheduleRows([]);
    setLegRows([]);

    if (!collectFromPostcode.trim()) {
      setRouteError("Enter a collection postcode.");
      return;
    }
    if (!stops.length) {
      setRouteError("No delivery stops. Paste postcodes then click Preview list.");
      return;
    }

    const from = normalizePostcode(collectFromPostcode);
    const pcs = [from, ...stops.map((s) => s.postcode)];

    let coords: Record<string, LngLat>;
    try {
      coords = await ensureCoords(pcs);
    } catch (e: any) {
      setRouteError(e?.message || "Geocoding failed");
      return;
    }

    try {
      const routePoints: LngLat[] = [coords[from], ...stops.map((s) => coords[s.postcode])];
      const dirs = await getDirections(routePoints, mapboxToken);

      const stopLegMins = dirs.legMins.slice(0, stops.length);
      const effectiveStart = collectionTime || startTime;
      const sched = buildSchedule(effectiveStart, stops, stopLegMins, serviceMins, includeBreaks, `collection (${from})`);
      setScheduleRows(sched);

      const legs: LegRow[] = [];
      for (let i = 0; i < dirs.legMins.length; i++) {
        const fromLabel = i === 0 ? `Collection (${from})` : `Delivery ${i}`;
        const toLabel = `Delivery ${i + 1}`;
        legs.push({
          label: `${fromLabel} → ${toLabel}`,
          mins: dirs.legMins[i],
          km: Math.round(dirs.legKm[i] * 10) / 10,
        });
      }
      setLegRows(legs);

      if (dirs.geometry && mapRef.current && mapMode !== "pins") {
        const map = mapRef.current;
        try {
          if (map.getLayer("mlc-route-line")) map.removeLayer("mlc-route-line");
          if (map.getSource("mlc-route")) map.removeSource("mlc-route");
        } catch { /* ignore */ }

        map.addSource("mlc-route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: dirs.geometry },
        });
        map.addLayer({
          id: "mlc-route-line",
          type: "line",
          source: "mlc-route",
          paint: { "line-width": 4, "line-opacity": 0.85 },
        });
        routeSourceReadyRef.current = true;
      }
    } catch (e: any) {
      setRouteError(e?.message || "Schedule/legs build failed");
    }
  }

  // Templates / runs actions
  async function saveTemplate() {
    const name = templateName.trim();
    if (!name) {
      setRouteError("Give the template a name first.");
      return;
    }

    const t: RouteTemplate = {
      id: uid(),
      name,
      customer,
      fromPostcode: normalizePostcode(fromPostcode),
      toPostcode: normalizePostcode(toPostcode),
      returnToBase,
      serviceMins,
      startTime,
      includeBreaks,
      rawText,
    };

    const result = await createTemplateAction(t);
    if (result.error) {
      setRouteError(result.error);
      return;
    }

    setTemplates([t, ...templates]);
    setTemplateName("");
  }

  function applyTemplate(t: RouteTemplate) {
    setCustomer(t.customer);
    setFromPostcode(t.fromPostcode);
    setReturnToBase(t.returnToBase);
    setToPostcode(t.returnToBase ? t.fromPostcode : t.toPostcode);
    setServiceMins(t.serviceMins);
    setStartTime(t.startTime);
    setIncludeBreaks(t.includeBreaks ?? true);
    setRawText(t.rawText);

    setTimeout(() => {
      parseStopsFromText();
    }, 0);
  }

  async function handleDeleteTemplate(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    await deleteTemplateAction(id);
  }

  async function createRuns() {
    if (!rawText.trim()) {
      setRouteError("Paste your postcodes first.");
      return;
    }
    if (routeType === "backload" && !collectFromPostcode.trim()) {
      setRouteError("Enter a collection postcode for the backload.");
      return;
    }

    setSaveMessage("");
    setSaving(true);

    let dates: string[] = [];
    if (!repeatMonFri) {
      dates = [date];
    } else {
      const start = repeatStartDate;
      const totalDays = repeatWeeks * 7;
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(start, i);
        if (isWeekday(d)) dates.push(d);
      }
    }

    const from = normalizePostcode(fromPostcode);

    const to =
      returnToBase
        ? from
        : (normalizePostcode(toPostcode || "") || "");

    // Get job numbers from server (atomic)
    const isBackload = routeType === "backload";
    const effectiveFrom = isBackload ? normalizePostcode(collectFromPostcode) : from;
    const effectiveTo = isBackload ? "" : to;

    const newRuns: PlannedRun[] = [];
    for (const d of dates) {
      const { jobNumber: jn } = await nextJobNumber(d);
      newRuns.push({
        id: uid(),
        jobNumber: jn,
        loadRef: loadRef.trim(),
        date: d,
        customer,
        vehicle,
        fromPostcode: effectiveFrom,
        toPostcode: effectiveTo,
        returnToBase: isBackload ? false : returnToBase,
        startTime,
        serviceMins,
        includeBreaks,
        rawText,
        completedStopIndexes: [],
        completedMeta: {},
        runType: routeType,
        runOrder: null,
        collectionTime: isBackload && collectionTime ? collectionTime : undefined,
      });
    }

    const result = await createRunsAction(newRuns);
    setSaving(false);
    if (result.error) {
      setRouteError(result.error);
      return;
    }

    const next = [...newRuns, ...plannedRuns].sort((a, b) => (a.date < b.date ? -1 : 1));
    setPlannedRuns(next);

    const msg = newRuns.length === 1
      ? `Run ${newRuns[0].jobNumber} saved!`
      : `${newRuns.length} runs saved!`;
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(""), 5000);
  }

  async function deleteRun(id: string) {
    setPlannedRuns((prev) => prev.filter((r) => r.id !== id));
    const { deleteRun: deleteRunAction } = await import("@/app/actions/runs");
    await deleteRunAction(id);
  }

  function duplicateRun(r: PlannedRun) {
    setCustomer(r.customer);
    setDate(r.date);
    setFromPostcode(r.fromPostcode);
    setReturnToBase(r.returnToBase);
    setToPostcode(r.returnToBase ? r.fromPostcode : (r.toPostcode || ""));
    setStartTime(r.startTime);
    setServiceMins(r.serviceMins);
    setIncludeBreaks(r.includeBreaks ?? true);
    setVehicle(r.vehicle);
    setRawText(r.rawText);

    setTimeout(() => {
      parseStopsFromText();
    }, 0);
  }

  // --- MAP SETUP ---
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!mapContainerRef.current) return;
      if (mapRef.current) return;

      const mapboxgl = (await import("mapbox-gl")).default;
      mapboxglRef.current = mapboxgl;

      mapboxgl.accessToken = mapboxToken || "no-token";

      const m = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [-2.5, 53.5],
        zoom: 5.3,
      });

      if (cancelled) return;
      mapRef.current = m;

      m.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [mapboxToken]);

  // Pre-geocode so map can show pins
  useEffect(() => {
    const pcs = [
      normalizePostcode(fromPostcode),
      ...(returnToBase ? [normalizePostcode(fromPostcode)] : (normalizePostcode(toPostcode || "") ? [normalizePostcode(toPostcode || "")] : [])),
      ...stops.map((s) => s.postcode),
    ].filter(Boolean);

    if (!pcs.length) return;
    if (!mapboxToken) return;
    ensureCoords(pcs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, fromPostcode, toPostcode, mapboxToken, returnToBase]);

  // Update markers whenever coords/stops/from/to changes
  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxglRef.current;
    if (!map || !mapboxgl) return;

    for (const mk of markersRef.current) mk.remove?.();
    markersRef.current = [];

    try {
      if (mapMode === "pins") {
        if (map.getLayer("mlc-route-line")) map.removeLayer("mlc-route-line");
        if (map.getSource("mlc-route")) map.removeSource("mlc-route");
        routeSourceReadyRef.current = false;
      }
    } catch {
      // ignore
    }

    const points: LngLat[] = [];

    const from = normalizePostcode(fromPostcode);
    const to = returnToBase ? from : normalizePostcode(toPostcode || "");

    const fromLL = coordsByPostcode[from];

    // Start marker
    if (fromLL) {
      const el = document.createElement("div");
      el.style.width = "30px";
      el.style.height = "30px";
      el.style.borderRadius = "999px";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = "12px";
      el.style.fontWeight = "800";
      el.style.border = "2px solid rgba(255,255,255,0.85)";
      el.style.background = "rgba(16,185,129,0.25)";
      el.style.color = "white";
      el.textContent = "S";

      const mk = new mapboxgl.Marker({ element: el })
        .setLngLat([fromLL.lng, fromLL.lat])
        .setPopup(new mapboxgl.Popup().setText(`Start: ${from}`))
        .addTo(map);

      markersRef.current.push(mk);
      points.push(fromLL);
    }

    // Stop markers (numbered)
    stops.forEach((s, idx) => {
      const ll = coordsByPostcode[s.postcode];
      if (!ll) return;

      const el = document.createElement("div");
      el.style.width = "28px";
      el.style.height = "28px";
      el.style.borderRadius = "999px";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = "13px";
      el.style.fontWeight = "700";
      el.style.border = "2px solid rgba(255,255,255,0.85)";
      el.style.background = "rgba(0,0,0,0.75)";
      el.style.color = "white";
      el.style.boxShadow = "0 6px 16px rgba(0,0,0,0.35)";
      el.textContent = String(idx + 1);

      const label = `${idx + 1}. ${s.postcode}${s.time ? ` (Booking ${s.time})` : ""}`;

      const mk = new mapboxgl.Marker({ element: el })
        .setLngLat([ll.lng, ll.lat])
        .setPopup(new mapboxgl.Popup().setText(label))
        .addTo(map);

      markersRef.current.push(mk);
      points.push(ll);
    });

    // End marker
    const toLL = to ? coordsByPostcode[to] : null;
    if (toLL) {
      const el = document.createElement("div");
      el.style.width = "30px";
      el.style.height = "30px";
      el.style.borderRadius = "999px";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = "12px";
      el.style.fontWeight = "800";
      el.style.border = "2px solid rgba(255,255,255,0.85)";
      el.style.background = "rgba(59,130,246,0.25)";
      el.style.color = "white";
      el.textContent = "E";

      const mk = new mapboxgl.Marker({ element: el })
        .setLngLat([toLL.lng, toLL.lat])
        .setPopup(new mapboxgl.Popup().setText(`End: ${to}`))
        .addTo(map);

      markersRef.current.push(mk);
      points.push(toLL);
    }

    if (points.length >= 2) {
      const b = new mapboxgl.LngLatBounds();
      points.forEach((p) => b.extend([p.lng, p.lat]));
      map.fitBounds(b, { padding: 60, duration: 350, maxZoom: 10 });
    }
  }, [coordsByPostcode, stops, fromPostcode, toPostcode, mapMode, returnToBase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapMode !== "pins") return;
    try {
      if (map.getLayer("mlc-route-line")) map.removeLayer("mlc-route-line");
      if (map.getSource("mlc-route")) map.removeSource("mlc-route");
      routeSourceReadyRef.current = false;
    } catch {
      // ignore
    }
  }, [mapMode]);

  const customerOptions = allCustomers.map((c) => c.name);
  const currentCust = allCustomers.find((c) => c.name === customer);
  const opening = { open: currentCust?.open_time ?? "08:00", close: currentCust?.close_time ?? "17:00" };

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-4">Plan Route</h1>

        {/* Route type tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setRouteType("regular")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              routeType === "regular"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                : "border border-white/15 text-gray-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            Regular Route
          </button>
          <button
            onClick={() => setRouteType("backload")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              routeType === "backload"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/20"
                : "border border-white/15 text-gray-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            Backload
          </button>
        </div>

        {/* Shared fields: date, customer, vehicle, load ref */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-2">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Customer</label>
            <select value={customer} onChange={(e) => { const c = e.target.value as CustomerKey; setCustomer(c); const cObj = allCustomers.find((x) => x.name === c); if (cObj?.base_postcode && routeType === "regular") setFromPostcode(cObj.base_postcode); }} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent">
              {customerOptions.map((c) => (<option key={c} value={c} className="bg-black">{c}</option>))}
            </select>
            <div className="text-xs text-gray-400 mt-2">Customer controls who can view later.</div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Vehicle (optional)</label>
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. B12MLC" className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
            <div className="text-xs text-gray-500 mt-2">Use reg exactly as Webfleet name.</div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Load Reference (optional)</label>
            <input value={loadRef} onChange={(e) => setLoadRef(e.target.value)} placeholder="e.g. CUS-12345" className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
            <div className="text-xs text-gray-500 mt-2">Customer or internal reference for this load.</div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">{routeType === "backload" ? "Departure time" : "Start time"}</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
          </div>
        </div>

        {/* Regular route fields */}
        {routeType === "regular" && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
            <div>
              <label className="block text-sm font-semibold mb-2">From (routing only)</label>
              <input value={fromPostcode} onChange={(e) => setFromPostcode(normalizePostcode(e.target.value))} placeholder="e.g. GL2 7ND" className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
              <div className="text-xs text-gray-400 mt-2">Default base is GL2 7ND (Montpellier).</div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">To (routing only)</label>
              <input value={toPostcode} onChange={(e) => setToPostcode(normalizePostcode(e.target.value))} disabled={returnToBase} placeholder="Leave blank to finish at last drop" className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent disabled:opacity-50" />
              <div className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={returnToBase} onChange={(e) => setReturnToBase(e.target.checked)} />
                <span>Return to base</span>
              </div>
              {!returnToBase && !normalizePostcode(toPostcode || "") && (
                <div className="text-xs text-emerald-300 mt-2">End = last drop (no return leg)</div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Default service time (mins)</label>
              <input type="number" value={serviceMins} min={0} onChange={(e) => setServiceMins(Number(e.target.value || 0))} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
              <div className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeBreaks} onChange={(e) => setIncludeBreaks(e.target.checked)} />
                <span>Include 45-min breaks (after 4h30 driving)</span>
              </div>
              <div className="text-xs text-gray-400 mt-2">Service time is used for the on-site blocks in the schedule.</div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Default opening (by customer)</label>
              <div className="w-full border border-white/15 rounded-lg px-3 py-2 bg-white/5">{opening.open}–{opening.close}</div>
              <div className="text-xs text-gray-400 mt-2">Applied to newly parsed stops automatically.</div>
            </div>
          </div>
        )}

        {/* Backload fields */}
        {routeType === "backload" && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Collect from</label>
              <input value={collectFromPostcode} onChange={(e) => setCollectFromPostcode(e.target.value)} placeholder="e.g. B1 1BB" className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
              <div className="text-xs text-gray-400 mt-2">Collection postcode. This is the route start point.</div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Collection booking time (optional)</label>
              <input type="time" value={collectionTime} onChange={(e) => setCollectionTime(e.target.value)} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
              <div className="text-xs text-gray-400 mt-2">If the collection has a booked time slot.</div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Default service time (mins)</label>
              <input type="number" value={serviceMins} min={0} onChange={(e) => setServiceMins(Number(e.target.value || 0))} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
              <div className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeBreaks} onChange={(e) => setIncludeBreaks(e.target.checked)} />
                <span>Include 45-min breaks (after 4h30 driving)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Default opening (by customer)</label>
              <div className="w-full border border-white/15 rounded-lg px-3 py-2 bg-white/5">{opening.open}–{opening.close}</div>
              <div className="text-xs text-gray-400 mt-2">Applied to newly parsed stops automatically.</div>
            </div>
          </div>
        )}

        <div className="mt-6">
          <label className="block mb-2 font-semibold">
            {routeType === "backload"
              ? "Delivery postcodes (one per line). Optional time after postcode (e.g. LS9 0AB 14:00)"
              : "Paste postcodes (one per line). Optional time after postcode (e.g. LS9 0AB 14:00)"}
          </label>
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} className="w-full h-40 p-4 border border-white/15 rounded-xl bg-transparent" placeholder={`LS9 0AB 14:00\nM1 2XX\nDN2 4PG 11:30`} />
        </div>

        <div className="flex flex-wrap gap-3 mt-4">
          <button onClick={parseStopsFromText} className="px-5 py-2 rounded-lg border border-white/15 hover:bg-white/10">Preview list</button>
          <button
            onClick={routeType === "backload" ? routeBackload : routeRespectBookings}
            className={`px-5 py-2 rounded-lg ${routeType === "backload" ? "bg-purple-600 hover:bg-purple-500" : "bg-blue-600 hover:bg-blue-500"}`}
          >
            {routeType === "backload" ? "Calculate ETAs" : "Route (respect booking times)"}
          </button>
          <button onClick={() => { setStops([]); setScheduleRows([]); setLegRows([]); setRouteError(""); setRawText(""); }} className="px-5 py-2 rounded-lg border border-white/15 hover:bg-white/10">Clear stops</button>
          <div className="text-xs text-gray-400 flex items-center">
            {routeType === "backload" ? (
              <>
                Collection: <span className="mx-2 text-white/80">{normalizePostcode(collectFromPostcode) || "(not set)"}</span>
                {collectionTime && <> • Booking: <span className="text-white/80">{collectionTime}</span></>}
              </>
            ) : (
              <>
                From: <span className="mx-2 text-white/80">{normalizePostcode(fromPostcode)}</span> • To:{" "}
                <span className="mx-2 text-white/80">{returnToBase ? normalizePostcode(fromPostcode) : (normalizePostcode(toPostcode || "") || "(last drop)")}</span>
              </>
            )}
            {" "}• Customer: <span className="mx-2 text-white/80">{customer}</span> • Date: <span className="mx-2 text-white/80">{date}</span>
          </div>
        </div>

        {routeError && (
          <div className="mt-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-200">{routeError}</div>
        )}

        {/* Templates + Repeat + Create Runs */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Templates */}
          <div className="border border-white/10 rounded-2xl p-5 bg-white/5">
            <h3 className="text-lg font-semibold mb-3">Templates (repeat jobs)</h3>
            <div className="flex gap-2">
              <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name (e.g. North West Artic)" className="flex-1 border border-white/15 rounded-lg px-3 py-2 bg-transparent" />
              <button onClick={saveTemplate} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500">Save</button>
            </div>
            <div className="text-xs text-gray-400 mt-2">Saves customer + from/to + settings + your pasted postcode list.</div>
            <div className="mt-4 space-y-2 max-h-56 overflow-auto pr-1">
              {templates.length === 0 ? (
                <div className="text-sm text-gray-400">No templates yet.</div>
              ) : (
                templates.map((t) => (
                  <div key={t.id} className="border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-xs text-gray-400">{t.customer} • From {t.fromPostcode} • {t.returnToBase ? "Return to base" : `To ${t.toPostcode || "(last drop)"}`} • Breaks: {t.includeBreaks ? "On" : "Off"}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => applyTemplate(t)} className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10">Use</button>
                      <button onClick={() => handleDeleteTemplate(t.id)} className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10">Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Repeat */}
          <div className="border border-white/10 rounded-2xl p-5 bg-white/5">
            <h3 className="text-lg font-semibold mb-3">Repeat</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={repeatMonFri} onChange={(e) => setRepeatMonFri(e.target.checked)} />
              Repeat Mon–Fri
            </label>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Start date</label>
                <input type="date" value={repeatStartDate} onChange={(e) => setRepeatStartDate(e.target.value)} disabled={!repeatMonFri} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">How many weeks</label>
                <input type="number" min={1} max={52} value={repeatWeeks} onChange={(e) => setRepeatWeeks(Number(e.target.value || 1))} disabled={!repeatMonFri} className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent disabled:opacity-50" />
              </div>
            </div>
            <div className="text-xs text-gray-400 mt-3">Creates runs for weekdays only (Mon–Fri). Weekend days are skipped automatically.</div>
            <button onClick={createRuns} disabled={saving} className="mt-4 w-full px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors">
              {saving ? "Saving..." : `Create run${repeatMonFri ? "s" : ""} (save)`}
            </button>
            {saveMessage && (
              <div className="mt-3 text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2 font-medium">
                {saveMessage}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-3">Job numbers are created automatically when runs are saved.</div>
          </div>

          {/* Customer opening presets */}
          <div className="border border-white/10 rounded-2xl p-5 bg-white/5">
            <h3 className="text-lg font-semibold mb-3">Customer opening presets</h3>
            <div className="text-sm text-gray-300">Current default for <span className="font-semibold">{customer}</span>: <span className="font-semibold">{opening.open}–{opening.close}</span></div>
            <div className="text-xs text-gray-400 mt-2">New stops inherit this automatically.</div>
          </div>
        </div>

        <div className="mt-8 border border-white/10 rounded-2xl p-6 bg-white/5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">{routeType === "backload" ? "Deliveries" : "Stops"} (drag to reorder)</h2>
            <div className="text-sm text-gray-400">
              {routeType === "backload"
                ? "Delivery order as pasted. Drag to reorder if needed."
                : "Booking-time stops are kept in time order when routing. You can still override."}
            </div>
          </div>

          {stops.length === 0 ? (
            <div className="text-gray-400">No stops yet. Paste postcodes then click Preview list.</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {stops.map((s, idx) => (
                    <SortableStopRow key={s.id} stop={s} index={idx} onRemove={() => removeStop(s.id)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {scheduleRows.length > 0 && (
          <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
            <h3 className="text-xl font-semibold mb-2">Driver schedule (HGV rules)</h3>
            <div className="text-xs text-gray-400 mb-4">Driving-time only • {includeBreaks ? "includes" : "does NOT include"} 45 min breaks after 4h30 driving • HGV time multiplier applied</div>
            <ul className="space-y-2">
              {scheduleRows.map((r, idx) => (
                <li key={idx} className="flex items-center justify-between border border-white/10 rounded-xl p-3">
                  <div className="text-sm">
                    <span className="font-semibold">{r.at}</span>
                    <span className="mx-2 text-gray-600">•</span>
                    <span className={r.kind === "break" ? "text-yellow-300 font-semibold" : ""}>{r.label}</span>
                  </div>
                  <div className="text-sm text-gray-400">{r.minutes} mins</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 border border-white/10 rounded-2xl p-2 bg-white/5">
          <div className="px-4 pt-3 pb-2 text-sm text-gray-400 flex items-center justify-between gap-4 flex-wrap">
            <div>Map view (numbered pins). Start = <span className="text-white/80">S</span>, End = <span className="text-white/80">E</span></div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">Map mode</label>
              <select value={mapMode} onChange={(e) => setMapMode(e.target.value as any)} className="border border-white/15 rounded-lg px-3 py-2 bg-black text-white text-sm">
                <option value="pins" className="bg-black">Pins only</option>
                <option value="route" className="bg-black">Pins + route line</option>
                <option value="route+legs" className="bg-black">Pins + route line + leg info</option>
              </select>
              <div className="text-xs text-gray-500">Token: {mapboxToken ? "set" : "missing"} (NEXT_PUBLIC_MAPBOX_TOKEN)</div>
            </div>
          </div>

          <div ref={mapContainerRef} className="h-[420px] w-full rounded-2xl overflow-hidden" />

          {(mapMode === "route+legs" && legRows.length > 0) && (
            <div className="p-4">
              <h4 className="font-semibold mb-2">Legs & totals</h4>
              <div className="text-xs text-gray-400 mb-3">Times include HGV multiplier. Distances are km.</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="border border-white/10 rounded-xl p-3">
                  <div className="text-xs text-gray-400">Driving time</div>
                  <div className="text-lg font-semibold">{totals.driveMins} mins</div>
                </div>
                <div className="border border-white/10 rounded-xl p-3">
                  <div className="text-xs text-gray-400">Breaks</div>
                  <div className="text-lg font-semibold">{includeBreaks ? `${totals.breakMins} mins` : "Off"}</div>
                </div>
                <div className="border border-white/10 rounded-xl p-3">
                  <div className="text-xs text-gray-400">Driving + breaks</div>
                  <div className="text-lg font-semibold">{includeBreaks ? `${totals.drivePlusBreaks} mins` : `${totals.driveMins} mins`}</div>
                  <div className="text-xs text-gray-500 mt-1">{totals.km} km</div>
                </div>
              </div>
              <div className="space-y-2">
                {legRows.map((l, idx) => (
                  <div key={idx} className="flex items-center justify-between border border-white/10 rounded-xl p-3">
                    <div className="text-sm">{l.label}</div>
                    <div className="text-sm text-gray-300">{l.mins} mins <span className="text-gray-600">•</span> {l.km} km</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Planned runs list */}
        <div className="mt-6 border border-white/10 rounded-2xl p-6 bg-white/5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h3 className="text-xl font-semibold">
              Saved runs {plannedRuns.length > 0 && <span className="text-sm text-gray-400 font-normal">({plannedRuns.length})</span>}
            </h3>
            {plannedRuns.length > 0 && (
              <input
                type="text"
                value={runSearch}
                onChange={(e) => { setRunSearch(e.target.value); setShowAllRuns(true); }}
                placeholder="Search by job, date, customer..."
                className="w-full sm:w-64 px-3 py-1.5 border border-white/15 rounded-lg bg-transparent text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>
          {plannedRuns.length === 0 ? (
            <div className="text-gray-400">None saved yet. Use &quot;Create run(s)&quot; above.</div>
          ) : (() => {
            const q = runSearch.toLowerCase().trim();
            const filtered = q
              ? plannedRuns.filter((r) =>
                  (r.jobNumber || "").toLowerCase().includes(q) ||
                  r.date.includes(q) ||
                  r.customer.toLowerCase().includes(q) ||
                  (r.vehicle || "").toLowerCase().includes(q) ||
                  r.fromPostcode.toLowerCase().includes(q)
                )
              : plannedRuns;
            const PREVIEW_COUNT = 5;
            const visible = showAllRuns ? filtered : filtered.slice(0, PREVIEW_COUNT);
            const hasMore = !showAllRuns && filtered.length > PREVIEW_COUNT;
            return (
              <>
                <div className="space-y-2">
                  {visible.map((r) => (
                    <div key={r.id} className="border border-white/10 rounded-xl p-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{r.jobNumber} • {r.date} • {r.customer} {r.vehicle ? `• ${r.vehicle}` : ""}</div>
                        <div className="text-xs text-gray-400 truncate">From {r.fromPostcode} • {r.returnToBase ? "Return to base" : (r.toPostcode ? `To ${r.toPostcode}` : "End at last drop")} • Start {r.startTime}</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => duplicateRun(r)} className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm">Load</button>
                        <button onClick={() => deleteRun(r.id)} className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
                {q && filtered.length === 0 && (
                  <div className="text-gray-500 text-sm mt-3">No runs match &quot;{runSearch}&quot;</div>
                )}
                {hasMore && (
                  <button
                    onClick={() => setShowAllRuns(true)}
                    className="mt-3 w-full py-2 rounded-lg border border-white/10 hover:bg-white/5 text-sm text-gray-400 transition-colors"
                  >
                    Show all {filtered.length} saved runs
                  </button>
                )}
                {showAllRuns && filtered.length > PREVIEW_COUNT && !q && (
                  <button
                    onClick={() => setShowAllRuns(false)}
                    className="mt-3 w-full py-2 rounded-lg border border-white/10 hover:bg-white/5 text-sm text-gray-400 transition-colors"
                  >
                    Show less
                  </button>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
