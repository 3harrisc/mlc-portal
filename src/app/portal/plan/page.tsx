"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import {
  createRuns as createRunsAction,
  nextJobNumber,
  deleteRun as deleteRunAction,
} from "@/app/actions/runs";
import {
  createTemplate as createTemplateAction,
  deleteTemplate as deleteTemplateAction,
} from "@/app/actions/templates";
import { createCustomer as createCustomerAction } from "@/app/admin/customers/actions";
import {
  type PlannedRun,
  type CustomerKey,
  type RouteTemplate,
  type RunType,
  type Customer,
  rowToRun,
  rowToTemplate,
} from "@/types/runs";
import {
  DEFAULT_SERVICE_MINS,
  DEFAULT_START_TIME,
} from "@/lib/constants";
import { fetchCustomers, DEFAULT_BASE } from "@/lib/customers";
import { normalizePostcode } from "@/lib/postcode-utils";
import { type LngLat } from "@/lib/geo-utils";
import {
  type Stop,
  type ScheduleRow,
  type LegRow,
  uid,
  addDays,
  isWeekday,
  parseStopsFromRawText,
  geocodePostcode,
  getDirections,
  buildSchedule,
  legTotals,
  orderStopsRespectingBookings,
} from "@/lib/portal/planning";
import Icon from "@/components/portal/Icon";
import { useToast } from "@/components/portal/ToastContext";

const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";

export default function PlanPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && profile && profile.role !== "admin") {
      router.push("/portal");
    }
  }, [authLoading, profile, router]);

  // ── Form state ──
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<CustomerKey>("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPostcode, setNewCustPostcode] = useState("");
  const [newCustSaving, setNewCustSaving] = useState(false);

  const [date, setDate] = useState<string>(() => isoToday());
  const [routeType, setRouteType] = useState<RunType>("regular");
  const [fromPostcode, setFromPostcode] = useState<string>(DEFAULT_BASE);
  const [toPostcode, setToPostcode] = useState<string>(DEFAULT_BASE);
  const [returnToBase, setReturnToBase] = useState<boolean>(true);
  const [collectFromPostcode, setCollectFromPostcode] = useState<string>("");
  const [collectionTime, setCollectionTime] = useState<string>("");
  const [collectionDate, setCollectionDate] = useState<string>("");
  const [vehicle, setVehicle] = useState<string>("");
  const [loadRef, setLoadRef] = useState<string>("");
  const [startTime, setStartTime] = useState<string>(DEFAULT_START_TIME);
  const [serviceMins, setServiceMins] = useState<number>(DEFAULT_SERVICE_MINS);
  const [includeBreaks, setIncludeBreaks] = useState<boolean>(true);
  const [rawText, setRawText] = useState<string>("");

  // ── Computed state ──
  const [stops, setStops] = useState<Stop[]>([]);
  const [routeError, setRouteError] = useState<string>("");
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [legRows, setLegRows] = useState<LegRow[]>([]);
  const [mapMode, setMapMode] = useState<"pins" | "route" | "route+legs">(
    "pins",
  );
  const [calculating, setCalculating] = useState(false);

  // ── Persistence state ──
  const [templates, setTemplates] = useState<RouteTemplate[]>([]);
  const [templateName, setTemplateName] = useState<string>("");
  const [plannedRuns, setPlannedRuns] = useState<PlannedRun[]>([]);
  const [repeatMonFri, setRepeatMonFri] = useState<boolean>(false);
  const [repeatWeeks, setRepeatWeeks] = useState<number>(1);
  const [repeatStartDate, setRepeatStartDate] = useState<string>(date);
  const [saving, setSaving] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [runSearch, setRunSearch] = useState("");

  // ── Map state ──
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapboxglRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  const [coordsByPostcode, setCoordsByPostcode] = useState<
    Record<string, LngLat>
  >({});
  const geoCacheRef = useRef<Map<string, LngLat>>(new Map());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const stopIds = useMemo(() => stops.map((s) => s.id), [stops]);
  const totals = useMemo(() => legTotals(legRows, includeBreaks), [
    legRows,
    includeBreaks,
  ]);
  const customerOptions = allCustomers.map((c) => c.name);
  const currentCust = allCustomers.find((c) => c.name === customer);
  const opening = {
    open: currentCust?.open_time ?? "08:00",
    close: currentCust?.close_time ?? "17:00",
  };

  // ── Initial load ──
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data ?? []).map(rowToTemplate)));
    supabase
      .from("runs")
      .select("*")
      .order("date", { ascending: true })
      .then(({ data }) => setPlannedRuns((data ?? []).map(rowToRun)));
    fetchCustomers().then((cs) => {
      setAllCustomers(cs);
      if (cs.length > 0) {
        setCustomer((prev) => prev || cs[0].name);
      }
    });
  }, []);

  // Keep to=from when return-to-base
  useEffect(() => {
    if (returnToBase) setToPostcode(fromPostcode);
  }, [returnToBase, fromPostcode]);

  useEffect(() => {
    setRepeatStartDate(date);
  }, [date]);

  // ── Mapbox init ──
  useEffect(() => {
    if (!mapboxToken) return;
    let cancelled = false;
    void (async () => {
      if (!mapContainerRef.current || mapRef.current) return;
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      mapboxglRef.current = mapboxgl;
      mapboxgl.accessToken = mapboxToken;
      const m = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE,
        center: [-2.5, 53.5],
        zoom: 5.3,
      });
      m.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      mapRef.current = m;
    })();
    return () => {
      cancelled = true;
    };
  }, [mapboxToken]);

  // Pre-geocode for map pins
  useEffect(() => {
    const pcs = [
      normalizePostcode(fromPostcode),
      ...(returnToBase
        ? [normalizePostcode(fromPostcode)]
        : normalizePostcode(toPostcode || "")
          ? [normalizePostcode(toPostcode || "")]
          : []),
      ...stops.map((s) => s.postcode),
    ].filter(Boolean);
    if (!pcs.length || !mapboxToken) return;
    void ensureCoords(pcs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, fromPostcode, toPostcode, mapboxToken, returnToBase]);

  // Re-render map markers + bounds when inputs change
  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxglRef.current;
    if (!map || !mapboxgl) return;

    for (const mk of markersRef.current) mk.remove?.();
    markersRef.current = [];

    if (mapMode === "pins") {
      try {
        if (map.getLayer("plan-route-line")) map.removeLayer("plan-route-line");
        if (map.getSource("plan-route")) map.removeSource("plan-route");
      } catch {
        /* ignore */
      }
    }

    const points: LngLat[] = [];
    const from = normalizePostcode(fromPostcode);
    const to = returnToBase ? from : normalizePostcode(toPostcode || "");

    const fromLL = coordsByPostcode[from];
    if (fromLL) {
      const el = pinElement({ kind: "origin", label: "S" });
      const mk = new mapboxgl.Marker({ element: el })
        .setLngLat([fromLL.lng, fromLL.lat])
        .setPopup(new mapboxgl.Popup().setText(`Start: ${from}`))
        .addTo(map);
      markersRef.current.push(mk);
      points.push(fromLL);
    }

    stops.forEach((s, idx) => {
      const ll = coordsByPostcode[s.postcode];
      if (!ll) return;
      const el = pinElement({
        kind: "stop",
        label: String(idx + 1),
      });
      const mk = new mapboxgl.Marker({ element: el })
        .setLngLat([ll.lng, ll.lat])
        .setPopup(
          new mapboxgl.Popup().setText(
            `${idx + 1}. ${s.postcode}${s.time ? ` (Booking ${s.time})` : ""}`,
          ),
        )
        .addTo(map);
      markersRef.current.push(mk);
      points.push(ll);
    });

    const toLL = to ? coordsByPostcode[to] : null;
    if (toLL) {
      const el = pinElement({ kind: "end", label: "E" });
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
      map.fitBounds(b, { padding: 60, duration: 350, maxZoom: 11 });
    }
  }, [coordsByPostcode, stops, fromPostcode, toPostcode, mapMode, returnToBase]);

  // Strip route line when switching to pins-only mode
  useEffect(() => {
    if (mapMode !== "pins") return;
    const map = mapRef.current;
    if (!map) return;
    try {
      if (map.getLayer("plan-route-line")) map.removeLayer("plan-route-line");
      if (map.getSource("plan-route")) map.removeSource("plan-route");
    } catch {
      /* ignore */
    }
  }, [mapMode]);

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
      const ll = await geocodePostcode(pc, mapboxToken);
      geoCacheRef.current.set(pc, ll);
      updates[pc] = ll;
    }
    setCoordsByPostcode(updates);
    return updates;
  }

  // ── Stop list actions ──
  function previewStops() {
    const parsed = parseStopsFromRawText(rawText, opening);
    setStops(parsed);
    setScheduleRows([]);
    setLegRows([]);
    setRouteError(parsed.length ? "" : "No valid postcodes found.");
  }

  function syncRawText(stopsArr: Stop[]) {
    setRawText(stopsArr.map((s) => s.input).join("\n"));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stops.findIndex((s) => s.id === active.id);
    const newIndex = stops.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(stops, oldIndex, newIndex);
    setStops(next);
    syncRawText(next);
    setScheduleRows([]);
    setLegRows([]);
  }

  function removeStop(id: string) {
    setStops((prev) => {
      const next = prev.filter((s) => s.id !== id);
      syncRawText(next);
      return next;
    });
    setScheduleRows([]);
    setLegRows([]);
  }

  // ── Routing actions ──
  async function calculateRoute() {
    setRouteError("");
    setScheduleRows([]);
    setLegRows([]);
    setCalculating(true);

    try {
      if (routeType === "backload") {
        await runBackloadRoute();
      } else {
        await runRegularRoute();
      }
    } catch (e: unknown) {
      setRouteError(e instanceof Error ? e.message : "Routing failed");
    } finally {
      setCalculating(false);
    }
  }

  async function runRegularRoute() {
    if (!stops.length) {
      setRouteError("No stops. Paste postcodes then click Preview list.");
      return;
    }
    const from = normalizePostcode(fromPostcode);
    const to = returnToBase
      ? normalizePostcode(fromPostcode)
      : normalizePostcode(toPostcode || "") || "";
    const pcs = [from, ...stops.map((s) => s.postcode), ...(to ? [to] : [])];

    const coords = await ensureCoords(pcs);
    const startLL = coords[from];
    if (!startLL) {
      setRouteError(`Couldn't geocode start postcode ${from}.`);
      return;
    }

    const ordered = orderStopsRespectingBookings(stops, coords, startLL);
    setStops(ordered);
    syncRawText(ordered);

    const routePoints: LngLat[] = [
      coords[from],
      ...ordered.map((s) => coords[s.postcode]).filter(Boolean),
    ];
    const usingLastDropAsEnd = !returnToBase && !to;
    const endLL = usingLastDropAsEnd ? null : coords[to || from];
    const routePointsWithEnd: LngLat[] = endLL
      ? [...routePoints, endLL]
      : routePoints;

    const dirs = await getDirections(routePointsWithEnd, mapboxToken);
    const stopLegMins = dirs.legMins.slice(0, ordered.length);
    setScheduleRows(
      buildSchedule(startTime, ordered, stopLegMins, serviceMins, includeBreaks, from),
    );

    const legs: LegRow[] = [];
    for (let i = 0; i < dirs.legMins.length; i++) {
      const fromLabel = i === 0 ? "Start" : `Stop ${i}`;
      const toLabel =
        i === ordered.length
          ? endLL
            ? "End"
            : `Stop ${i + 1}`
          : `Stop ${i + 1}`;
      legs.push({
        label: `${fromLabel} → ${toLabel}`,
        mins: dirs.legMins[i],
        km: Math.round(dirs.legKm[i] * 10) / 10,
      });
    }
    setLegRows(legs);
    drawRouteOnMap(dirs.geometry);
  }

  async function runBackloadRoute() {
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
    const coords = await ensureCoords(pcs);
    const routePoints: LngLat[] = [
      coords[from],
      ...stops.map((s) => coords[s.postcode]).filter(Boolean),
    ];

    const dirs = await getDirections(routePoints, mapboxToken);
    const stopLegMins = dirs.legMins.slice(0, stops.length);
    const effectiveStart = collectionTime || startTime;
    setScheduleRows(
      buildSchedule(
        effectiveStart,
        stops,
        stopLegMins,
        serviceMins,
        includeBreaks,
        `collection (${from})`,
      ),
    );

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
    drawRouteOnMap(dirs.geometry);
  }

  function drawRouteOnMap(geometry: GeoJSON.Geometry | null) {
    if (!geometry || !mapRef.current || mapMode === "pins") return;
    const map = mapRef.current;
    try {
      if (map.getLayer("plan-route-line")) map.removeLayer("plan-route-line");
      if (map.getSource("plan-route")) map.removeSource("plan-route");
    } catch {
      /* ignore */
    }
    map.addSource("plan-route", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry },
    });
    map.addLayer({
      id: "plan-route-line",
      type: "line",
      source: "plan-route",
      paint: {
        "line-color": "#1B3F90",
        "line-width": 3.5,
        "line-opacity": 0.85,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }

  // ── Templates ──
  async function saveTemplate() {
    const name = templateName.trim();
    if (!name) {
      showToast("Give the template a name first.", "err");
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
      showToast(result.error, "err");
      return;
    }
    setTemplates((prev) => [t, ...prev]);
    setTemplateName("");
    showToast(`Template "${name}" saved.`);
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
      const parsed = parseStopsFromRawText(t.rawText, opening);
      setStops(parsed);
      setScheduleRows([]);
      setLegRows([]);
    }, 0);
  }

  async function handleDeleteTemplate(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    await deleteTemplateAction(id);
  }

  // ── Save runs ──
  async function createRuns() {
    if (!rawText.trim()) {
      showToast("Paste your postcodes first.", "err");
      return;
    }
    if (routeType === "backload" && !collectFromPostcode.trim()) {
      showToast("Enter a collection postcode for the backload.", "err");
      return;
    }
    setSaving(true);

    let dates: string[] = [];
    if (!repeatMonFri) {
      dates = [date];
    } else {
      const totalDays = repeatWeeks * 7;
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(repeatStartDate, i);
        if (isWeekday(d)) dates.push(d);
      }
    }

    const from = normalizePostcode(fromPostcode);
    const to = returnToBase
      ? from
      : normalizePostcode(toPostcode || "") || "";
    const isBackload = routeType === "backload";
    const effectiveFrom = isBackload
      ? normalizePostcode(collectFromPostcode)
      : from;
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
        collectionDate:
          isBackload && collectionDate && collectionDate !== date
            ? collectionDate
            : undefined,
      });
    }

    const result = await createRunsAction(newRuns);
    setSaving(false);
    if (result.error) {
      showToast(result.error, "err");
      return;
    }

    setPlannedRuns((prev) =>
      [...newRuns, ...prev].sort((a, b) => (a.date < b.date ? -1 : 1)),
    );
    showToast(
      newRuns.length === 1
        ? `Run ${newRuns[0].jobNumber} saved.`
        : `${newRuns.length} runs saved.`,
    );
  }

  async function handleDeleteRun(id: string) {
    if (!window.confirm("Delete this saved run?")) return;
    setPlannedRuns((prev) => prev.filter((r) => r.id !== id));
    await deleteRunAction(id);
    showToast("Run deleted.");
  }

  function loadIntoForm(r: PlannedRun) {
    setCustomer(r.customer);
    setDate(r.date);
    setFromPostcode(r.fromPostcode);
    setReturnToBase(r.returnToBase);
    setToPostcode(r.returnToBase ? r.fromPostcode : r.toPostcode || "");
    setStartTime(r.startTime);
    setServiceMins(r.serviceMins);
    setIncludeBreaks(r.includeBreaks ?? true);
    setVehicle(r.vehicle);
    setLoadRef(r.loadRef);
    setRawText(r.rawText);
    setRouteType(r.runType ?? "regular");
    setTimeout(() => {
      const parsed = parseStopsFromRawText(r.rawText, opening);
      setStops(parsed);
      setScheduleRows([]);
      setLegRows([]);
    }, 0);
  }

  // ── New customer inline create ──
  async function addNewCustomer() {
    if (!newCustName.trim()) return;
    setNewCustSaving(true);
    const res = await createCustomerAction(
      newCustName.trim(),
      newCustPostcode.trim() || DEFAULT_BASE,
      "06:00",
      "18:00",
    );
    setNewCustSaving(false);
    if (res.error) {
      showToast(res.error, "err");
      return;
    }
    const updated = await fetchCustomers();
    setAllCustomers(updated);
    setCustomer(newCustName.trim());
    setNewCustName("");
    setNewCustPostcode("");
    setShowNewCustomer(false);
    showToast(`Added customer "${newCustName.trim()}".`);
  }

  // ── Saved runs filter ──
  const filteredRuns = useMemo(() => {
    const q = runSearch.toLowerCase().trim();
    if (!q) return plannedRuns;
    return plannedRuns.filter(
      (r) =>
        (r.jobNumber || "").toLowerCase().includes(q) ||
        r.date.includes(q) ||
        r.customer.toLowerCase().includes(q) ||
        (r.vehicle || "").toLowerCase().includes(q) ||
        r.fromPostcode.toLowerCase().includes(q),
    );
  }, [plannedRuns, runSearch]);

  if (authLoading || (profile && profile.role !== "admin")) {
    return (
      <div className="card">
        <div
          className="card-body"
          style={{ padding: 32, textAlign: "center", color: "var(--ink-500)" }}
        >
          {authLoading ? "Loading…" : "Admin access required."}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Plan a route</h1>
          <div className="page-subtitle">
            Paste postcodes, optimise the order, save the run. HGV time
            multiplier and 4h30 break logic baked in.
          </div>
        </div>
      </div>

      {/* ── Job details ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Job details</h3>
          <div className="actions">
            <div className="seg">
              <button
                type="button"
                className={routeType === "regular" ? "active" : ""}
                onClick={() => setRouteType("regular")}
              >
                Regular
              </button>
              <button
                type="button"
                className={routeType === "backload" ? "active" : ""}
                onClick={() => setRouteType("backload")}
              >
                Backload
              </button>
            </div>
          </div>
        </div>
        <div
          className="card-body"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14,
          }}
        >
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              className="input mono"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Customer</label>
            <div className="row gap-4">
              <select
                className="select"
                style={{ flex: 1 }}
                value={customer}
                onChange={(e) => {
                  const c = e.target.value;
                  setCustomer(c);
                  const obj = allCustomers.find((x) => x.name === c);
                  if (obj?.base_postcode && routeType === "regular") {
                    setFromPostcode(obj.base_postcode);
                  }
                }}
              >
                {customerOptions.length === 0 && (
                  <option value="">No customers</option>
                )}
                {customerOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                className={`btn sm ${showNewCustomer ? "primary" : ""}`}
                onClick={() => setShowNewCustomer(!showNewCustomer)}
              >
                <Icon name="plus" size={11} />
              </button>
            </div>
            {showNewCustomer && (
              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  background: "var(--surface-alt)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <input
                  className="input"
                  placeholder="Customer name"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  style={{ height: 28, fontSize: 12 }}
                />
                <input
                  className="input mono"
                  placeholder="Base postcode (optional)"
                  value={newCustPostcode}
                  onChange={(e) => setNewCustPostcode(e.target.value)}
                  style={{ height: 28, fontSize: 12 }}
                />
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={!newCustName.trim() || newCustSaving}
                  onClick={addNewCustomer}
                >
                  {newCustSaving ? "Saving…" : "Add customer"}
                </button>
              </div>
            )}
          </div>
          <div className="field">
            <label>Vehicle (optional)</label>
            <input
              className="input mono"
              placeholder="e.g. B12MLC"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Load reference (optional)</label>
            <input
              className="input"
              placeholder="e.g. CUS-12345"
              value={loadRef}
              onChange={(e) => setLoadRef(e.target.value)}
            />
          </div>

          {routeType === "regular" ? (
            <>
              <div className="field">
                <label>Start time</label>
                <input
                  type="time"
                  className="input mono"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="field">
                <label>From (routing only)</label>
                <input
                  className="input mono"
                  value={fromPostcode}
                  onChange={(e) =>
                    setFromPostcode(normalizePostcode(e.target.value))
                  }
                  placeholder="e.g. GL2 7ND"
                />
              </div>
              <div className="field">
                <label>To (routing only)</label>
                <input
                  className="input mono"
                  value={toPostcode}
                  disabled={returnToBase}
                  onChange={(e) =>
                    setToPostcode(normalizePostcode(e.target.value))
                  }
                  placeholder="Leave blank to finish at last drop"
                />
                <label
                  className="row gap-4"
                  style={{ fontSize: 12, marginTop: 4, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={returnToBase}
                    onChange={(e) => setReturnToBase(e.target.checked)}
                  />
                  Return to base
                </label>
              </div>
              <div className="field">
                <label>Service mins / breaks</label>
                <input
                  type="number"
                  className="input tnum"
                  value={serviceMins}
                  min={0}
                  onChange={(e) => setServiceMins(Number(e.target.value || 0))}
                />
                <label
                  className="row gap-4"
                  style={{ fontSize: 12, marginTop: 4, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={includeBreaks}
                    onChange={(e) => setIncludeBreaks(e.target.checked)}
                  />
                  45-min breaks after 4h30
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Collect from</label>
                <input
                  className="input mono"
                  value={collectFromPostcode}
                  onChange={(e) => setCollectFromPostcode(e.target.value)}
                  placeholder="e.g. B1 1BB"
                />
              </div>
              <div className="field">
                <label>Collection time (optional)</label>
                <input
                  type="time"
                  className="input mono"
                  value={collectionTime}
                  onChange={(e) => setCollectionTime(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Collection date (optional)</label>
                <input
                  type="date"
                  className="input mono"
                  value={collectionDate}
                  onChange={(e) => setCollectionDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Service mins / breaks</label>
                <input
                  type="number"
                  className="input tnum"
                  value={serviceMins}
                  min={0}
                  onChange={(e) => setServiceMins(Number(e.target.value || 0))}
                />
                <label
                  className="row gap-4"
                  style={{ fontSize: 12, marginTop: 4, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={includeBreaks}
                    onChange={(e) => setIncludeBreaks(e.target.checked)}
                  />
                  45-min breaks after 4h30
                </label>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Postcodes input ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>
            {routeType === "backload" ? "Delivery postcodes" : "Stops"}
          </h3>
          <span className="muted" style={{ fontSize: 11 }}>
            One per line · optional time after postcode (e.g. <span className="mono">LS9 0AB 14:00</span>)
          </span>
        </div>
        <div className="card-body">
          <textarea
            className="textarea mono"
            style={{ height: 140, fontSize: 13 }}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`LS9 0AB 14:00\nM1 2XX\nDN2 4PG 11:30`}
          />
          <div
            className="row gap-8"
            style={{ marginTop: 10, flexWrap: "wrap" }}
          >
            <button type="button" className="btn" onClick={previewStops}>
              <Icon name="list" size={13} /> Preview list
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={calculateRoute}
              disabled={calculating}
            >
              <Icon name="map" size={13} />{" "}
              {calculating
                ? "Routing…"
                : routeType === "backload"
                  ? "Calculate ETAs"
                  : "Route (respect bookings)"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setStops([]);
                setScheduleRows([]);
                setLegRows([]);
                setRawText("");
                setRouteError("");
              }}
            >
              <Icon name="x" size={13} /> Clear
            </button>
            <div className="spacer" />
            <span className="muted" style={{ fontSize: 11 }}>
              Customer opening: <span className="mono">{opening.open}</span>–
              <span className="mono">{opening.close}</span>
            </span>
          </div>
          {routeError && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 6,
                background: "var(--err-bg)",
                color: "var(--err)",
                fontSize: 12.5,
                border: "1px solid var(--err-bg)",
              }}
            >
              {routeError}
            </div>
          )}
        </div>
      </div>

      {/* ── Stops list (drag to reorder) ── */}
      {stops.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3>
              {routeType === "backload" ? "Deliveries" : "Stops"}
            </h3>
            <span className="muted" style={{ fontSize: 11 }}>
              {stops.length} · drag the handle to reorder
            </span>
          </div>
          <div className="card-body">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {stops.map((s, idx) => (
                    <SortableStopRow
                      key={s.id}
                      stop={s}
                      index={idx}
                      onRemove={() => removeStop(s.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}

      {/* ── Schedule ── */}
      {scheduleRows.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3>Driver schedule</h3>
            <span className="muted" style={{ fontSize: 11 }}>
              HGV multiplier · {includeBreaks ? "with" : "without"} 45-min breaks
            </span>
          </div>
          <div className="card-body">
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {scheduleRows.map((r, idx) => (
                <li
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--line)",
                    marginBottom: 6,
                    background:
                      r.kind === "break" ? "var(--warn-bg)" : "var(--surface)",
                  }}
                >
                  <div style={{ fontSize: 12.5 }}>
                    <span className="mono bold tnum">{r.at}</span>
                    <span className="muted" style={{ margin: "0 8px" }}>
                      ·
                    </span>
                    <span
                      style={
                        r.kind === "break"
                          ? { color: "var(--warn)", fontWeight: 600 }
                          : undefined
                      }
                    >
                      {r.label}
                    </span>
                  </div>
                  <div className="muted mono tnum" style={{ fontSize: 11.5 }}>
                    {r.minutes} min
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Map ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Map</h3>
          <span className="muted" style={{ fontSize: 11 }}>
            Start = navy <span className="bold">S</span>, drops numbered, end = blue <span className="bold">E</span>
          </span>
          <div className="actions">
            <div className="seg">
              <button
                type="button"
                className={mapMode === "pins" ? "active" : ""}
                onClick={() => setMapMode("pins")}
              >
                Pins
              </button>
              <button
                type="button"
                className={mapMode === "route" ? "active" : ""}
                onClick={() => setMapMode("route")}
              >
                Route
              </button>
              <button
                type="button"
                className={mapMode === "route+legs" ? "active" : ""}
                onClick={() => setMapMode("route+legs")}
              >
                Route + legs
              </button>
            </div>
          </div>
        </div>
        {mapboxToken ? (
          <div
            ref={mapContainerRef}
            style={{
              height: 420,
              width: "100%",
              borderBottom:
                mapMode === "route+legs" && legRows.length > 0
                  ? "1px solid var(--line)"
                  : undefined,
            }}
          />
        ) : (
          <div
            style={{
              height: 200,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-500)",
              fontSize: 12.5,
              background: "var(--surface-alt)",
            }}
          >
            Map unavailable — set NEXT_PUBLIC_MAPBOX_TOKEN to enable.
          </div>
        )}
        {mapMode === "route+legs" && legRows.length > 0 && (
          <div className="card-body">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <SmallStat label="Driving" value={`${totals.driveMins} min`} />
              <SmallStat
                label="Breaks"
                value={includeBreaks ? `${totals.breakMins} min` : "Off"}
              />
              <SmallStat
                label="Total"
                value={`${
                  includeBreaks ? totals.drivePlusBreaks : totals.driveMins
                } min · ${totals.km} km`}
              />
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {legRows.map((l, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 10px",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span>{l.label}</span>
                  <span className="muted mono tnum">
                    {l.mins} min · {l.km} km
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Templates / Repeat / Save ── */}
      <div className="three-col" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <h3>Templates</h3>
            <span className="muted mono" style={{ fontSize: 11 }}>
              {templates.length}
            </span>
          </div>
          <div className="card-body">
            <div className="row gap-4" style={{ marginBottom: 8 }}>
              <input
                className="input"
                placeholder="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                style={{ flex: 1, height: 28, fontSize: 12 }}
              />
              <button type="button" className="btn sm primary" onClick={saveTemplate}>
                Save
              </button>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              {templates.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  No templates yet. Save your current setup to reuse later.
                </div>
              ) : (
                templates.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: 8,
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        className="bold"
                        style={{
                          fontSize: 12.5,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {t.name}
                      </div>
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {t.customer} · {t.fromPostcode} →{" "}
                        {t.returnToBase ? "base" : t.toPostcode || "last drop"}
                      </div>
                    </div>
                    <div className="row gap-4">
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => applyTemplate(t)}
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => handleDeleteTemplate(t.id)}
                        style={{ color: "var(--err)" }}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Repeat Mon–Fri</h3>
          </div>
          <div className="card-body">
            <label
              className="row gap-4"
              style={{ fontSize: 12.5, cursor: "pointer", marginBottom: 10 }}
            >
              <input
                type="checkbox"
                checked={repeatMonFri}
                onChange={(e) => setRepeatMonFri(e.target.checked)}
              />
              Repeat on weekdays
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <div className="field">
                <label>Start date</label>
                <input
                  type="date"
                  className="input mono"
                  value={repeatStartDate}
                  disabled={!repeatMonFri}
                  onChange={(e) => setRepeatStartDate(e.target.value)}
                  style={{ height: 30 }}
                />
              </div>
              <div className="field">
                <label>How many weeks</label>
                <input
                  type="number"
                  className="input tnum"
                  min={1}
                  max={52}
                  value={repeatWeeks}
                  disabled={!repeatMonFri}
                  onChange={(e) =>
                    setRepeatWeeks(Number(e.target.value || 1))
                  }
                  style={{ height: 30 }}
                />
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              Weekend dates are skipped.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Save</h3>
          </div>
          <div className="card-body">
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Job numbers are assigned atomically when you save.
            </div>
            <button
              type="button"
              className="btn primary lg"
              onClick={createRuns}
              disabled={saving}
              style={{ width: "100%" }}
            >
              {saving
                ? "Saving…"
                : repeatMonFri
                  ? "Create runs"
                  : "Create run"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Saved runs ── */}
      <div className="card">
        <div className="card-header">
          <h3>Saved runs</h3>
          <span className="muted mono" style={{ fontSize: 11 }}>
            {plannedRuns.length}
          </span>
          <div className="actions">
            <input
              className="input"
              placeholder="Search by job, date, customer…"
              value={runSearch}
              onChange={(e) => {
                setRunSearch(e.target.value);
                setShowAllRuns(true);
              }}
              style={{ height: 28, fontSize: 12, width: 240 }}
            />
          </div>
        </div>
        <div className="card-body">
          {plannedRuns.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: 12 }}>
              None saved yet.
            </div>
          ) : (
            (() => {
              const PREVIEW = 5;
              const visible = showAllRuns
                ? filteredRuns
                : filteredRuns.slice(0, PREVIEW);
              const hasMore =
                !showAllRuns && filteredRuns.length > PREVIEW;
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {visible.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          padding: 10,
                          border: "1px solid var(--line)",
                          borderRadius: 6,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            className="bold"
                            style={{
                              fontSize: 12.5,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            <span className="mono">{r.jobNumber}</span> ·{" "}
                            {r.date} · {r.customer}
                            {r.vehicle ? ` · ${r.vehicle}` : ""}
                          </div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            From {r.fromPostcode} ·{" "}
                            {r.returnToBase
                              ? "return to base"
                              : r.toPostcode
                                ? `to ${r.toPostcode}`
                                : "end at last drop"}{" "}
                            · start {r.startTime}
                          </div>
                        </div>
                        <div className="row gap-4">
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => loadIntoForm(r)}
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => handleDeleteRun(r.id)}
                            style={{ color: "var(--err)" }}
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {runSearch && filteredRuns.length === 0 && (
                    <div
                      className="muted"
                      style={{ fontSize: 12, marginTop: 8 }}
                    >
                      No runs match &quot;{runSearch}&quot;.
                    </div>
                  )}
                  {hasMore && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setShowAllRuns(true)}
                      style={{ width: "100%", marginTop: 8 }}
                    >
                      Show all {filteredRuns.length}
                    </button>
                  )}
                </>
              );
            })()
          )}
        </div>
      </div>
    </>
  );
}

// ── Helpers ──

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pinElement({
  kind,
  label,
}: {
  kind: "origin" | "stop" | "end";
  label: string;
}): HTMLDivElement {
  const el = document.createElement("div");
  el.style.transform = "translate(-50%, -50%)";
  el.style.borderRadius = "999px";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.color = "#fff";
  el.style.fontWeight = "700";
  el.style.fontFamily = "var(--font-portal-mono)";
  el.style.border = "2px solid #fff";
  el.style.boxShadow = "0 1px 4px rgba(14,19,32,0.25)";
  if (kind === "origin") {
    el.style.width = "26px";
    el.style.height = "26px";
    el.style.background = "#0B2A6B";
    el.style.fontSize = "11px";
  } else if (kind === "end") {
    el.style.width = "26px";
    el.style.height = "26px";
    el.style.background = "#1B3F90";
    el.style.fontSize = "11px";
  } else {
    el.style.width = "24px";
    el.style.height = "24px";
    el.style.background = "#D81E2A";
    el.style.fontSize = "11px";
  }
  el.textContent = label;
  return el;
}

function SortableStopRow({
  stop,
  index,
  onRemove,
}: {
  stop: Stop;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "var(--surface)",
      }}
    >
      <button
        type="button"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: "1px solid var(--line)",
          background: "var(--surface-alt)",
          color: "var(--ink-500)",
          cursor: "grab",
          fontSize: 14,
        }}
      >
        ☰
      </button>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "var(--mlc-red)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {index + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="bold mono" style={{ fontSize: 12.5 }}>
          {stop.postcode}
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {stop.time ? (
            <>
              Booking <span className="bold">{stop.time}</span>
            </>
          ) : (
            "No booking"
          )}
          <span style={{ margin: "0 6px" }}>·</span>
          Open {stop.open}–{stop.close}
        </div>
      </div>
      <button
        type="button"
        className="btn sm ghost"
        onClick={onRemove}
        style={{ color: "var(--err)" }}
        aria-label="Remove stop"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 10,
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "var(--surface-alt)",
      }}
    >
      <div className="muted" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
        {label}
      </div>
      <div className="bold mono tnum" style={{ fontSize: 14, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
