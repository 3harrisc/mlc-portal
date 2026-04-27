"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { rowToRun, type PlannedRun } from "@/types/runs";
import { todayISO } from "@/lib/time-utils";
import { parseStops } from "@/lib/postcode-utils";
import { useAuth } from "@/components/AuthProvider";
import { useNicknames } from "@/hooks/useNicknames";
import { useDriversByVehicle, lookupDriver } from "@/hooks/useDriversByVehicle";
import { usePostcodeCoords } from "@/hooks/usePostcodeCoords";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { normVehicle } from "@/lib/webfleet";
import { normalizePostcode } from "@/lib/postcode-utils";
import { withNickname } from "@/lib/postcode-nicknames";
import { deleteRun } from "@/app/actions/runs";
import Icon from "@/components/portal/Icon";
import StatusPill from "@/components/portal/StatusPill";
import PortalMap, {
  type MapPin,
  type MapRoute,
} from "@/components/portal/PortalMap";
import ShareLinkPanel from "@/components/portal/ShareLinkPanel";
import { useToast } from "@/components/portal/ToastContext";
import { deriveStatus, quickEta } from "@/lib/portal/loads";

interface TimelineEvent {
  at: string; // ISO-ish "YYYY-MM-DD HH:MM"
  title: string;
  meta?: string;
  kind: "ok" | "current" | "pending" | "info" | "err";
}

export default function LoadDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const nicknames = useNicknames();
  const [run, setRun] = useState<PlannedRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("runs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
      } else {
        setRun(rowToRun(data));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <>
        <PageHeaderBack />
        <div className="card">
          <div
            className="card-body"
            style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}
          >
            Loading load…
          </div>
        </div>
      </>
    );
  }

  if (notFound || !run) {
    return (
      <>
        <PageHeaderBack />
        <div className="card">
          <div
            className="card-body"
            style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}
          >
            We couldn&apos;t find that load. It may have been deleted, or you
            may not have access to it.
          </div>
        </div>
      </>
    );
  }

  return <LoadDetailView run={run} nicknames={nicknames} />;
}

function PageHeaderBack() {
  return (
    <div className="page-header">
      <div>
        <Link href="/portal/loads" className="btn sm ghost">
          <Icon name="chevL" size={12} /> Back to loads
        </Link>
      </div>
    </div>
  );
}

function LoadDetailView({
  run,
  nicknames,
}: {
  run: PlannedRun;
  nicknames: Record<string, string>;
}) {
  const router = useRouter();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [isDeleting, startDelete] = useTransition();
  const { byVehicle } = useDriversByVehicle();
  const driver = lookupDriver(byVehicle, run.vehicle);
  const { positions } = useVehiclePositions();
  const truckPos = positions[normVehicle(run.vehicle)] ?? null;
  const isAdmin = profile?.role === "admin";

  const handleDelete = () => {
    const label = run.jobNumber || run.id;
    if (!window.confirm(`Delete load ${label}? This cannot be undone.`)) return;
    startDelete(async () => {
      const result = await deleteRun(run.id);
      if (result.error) {
        showToast(`Couldn't delete: ${result.error}`, "err");
        return;
      }
      showToast(`Load ${label} deleted.`);
      router.push("/portal/loads");
    });
  };
  const today = todayISO();
  const status = deriveStatus(run, today);
  const stops = useMemo(() => parseStops(run.rawText), [run.rawText]);
  const completedIdx = useMemo(() => {
    const fromCompleted = new Set(run.completedStopIndexes ?? []);
    (run.progress?.completedIdx ?? []).forEach((i) => fromCompleted.add(i));
    return fromCompleted;
  }, [run.completedStopIndexes, run.progress]);
  const completedCount = completedIdx.size;
  const total = stops.length;
  const eta = quickEta(run);

  const { coords } = usePostcodeCoords(stops);

  const { mapPins, mapRoutes } = useMemo(
    () => buildMapData(stops, coords, completedIdx, truckPos, status === "delivered"),
    [stops, coords, completedIdx, truckPos, status],
  );

  const events = useMemo<TimelineEvent[]>(
    () => buildTimeline(run, stops, completedIdx, status),
    [run, stops, completedIdx, status],
  );

  const fromName = withNickname(run.fromPostcode, nicknames) || run.fromPostcode;
  const toName = withNickname(run.toPostcode, nicknames) || run.toPostcode;
  const dateDisp = new Date(`${run.date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <div className="page-header" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row gap-8" style={{ marginBottom: 6 }}>
            <Link href="/portal/loads" className="btn sm ghost">
              <Icon name="chevL" size={12} /> Back to loads
            </Link>
            <StatusPill status={status} />
            {run.runType === "backload" && (
              <span className="pill scheduled">
                <span className="dot" />
                Backload
              </span>
            )}
          </div>
          <h1 className="page-title">
            <span className="mono">{run.jobNumber || run.id}</span>
            {run.loadRef && (
              <span
                className="muted"
                style={{ fontWeight: 400, fontSize: 14, marginLeft: 12 }}
              >
                {run.loadRef}
              </span>
            )}
          </h1>
          <div className="page-subtitle">
            {run.customer} · {fromName} ({run.fromPostcode}) → {toName} (
            {run.toPostcode || "—"}) · {dateDisp}
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn" type="button">
            <Icon name="phone" size={13} /> Contact driver
          </button>
          <button className="btn" type="button">
            <Icon name="download" size={13} /> Download POD
          </button>
          {isAdmin && (
            <button
              className="btn"
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              style={{ color: "var(--err)", borderColor: "var(--err-bg)" }}
            >
              <Icon name="x" size={13} /> {isDeleting ? "Deleting…" : "Delete"}
            </button>
          )}
          <button className="btn ghost icon-btn" type="button" aria-label="More">
            <Icon name="more" size={15} />
          </button>
        </div>
      </div>

      <ShareLinkPanel runId={run.id} />

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat-cell">
          <div className="l">Progress</div>
          <div className="v">
            {completedCount}
            <span
              style={{
                color: "var(--ink-500)",
                fontWeight: 400,
                fontSize: 13,
              }}
            >
              /{total} stops
            </span>
          </div>
        </div>
        <div className="stat-cell">
          <div className="l">ETA at next drop</div>
          <div className="v mono">
            {status === "delivered" ? "Delivered" : eta}
          </div>
        </div>
        <div className="stat-cell">
          <div className="l">Service</div>
          <div className="v" style={{ fontSize: 14 }}>
            {run.runType === "backload" ? "Backload" : "Delivery"}
          </div>
        </div>
        <div className="stat-cell">
          <div className="l">Start time</div>
          <div className="v mono">{run.startTime || "—"}</div>
        </div>
      </div>

      <div className="two-col">
        <div className="col gap-16">
          <div className="card">
            <div className="card-header">
              <h3>Route &amp; live position</h3>
              <span className="muted" style={{ fontSize: 11 }}>
                · {total} stop{total === 1 ? "" : "s"}
              </span>
              <div className="actions">
                {truckPos && (
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {truckPos.speedKph != null
                      ? `${Math.round(truckPos.speedKph * 0.621371)} mph`
                      : "Position live"}
                  </span>
                )}
              </div>
            </div>
            <div style={{ height: 320, borderBottom: "1px solid var(--line)" }}>
              <PortalMap pins={mapPins} routes={mapRoutes} height="100%" />
            </div>
            <div className="card-body">
              <ol
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {stops.map((pc, i) => {
                  const done = completedIdx.has(i);
                  return (
                    <li
                      key={`${pc}-${i}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 10px",
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        background: done
                          ? "var(--ok-bg)"
                          : i === 0
                            ? "var(--mlc-blue-50)"
                            : "var(--surface-alt)",
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: done
                            ? "var(--ok)"
                            : i === 0
                              ? "var(--mlc-blue)"
                              : "var(--mlc-red)",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="bold" style={{ fontSize: 12.5 }}>
                          {withNickname(pc, nicknames) || pc}
                        </div>
                        <div className="muted mono" style={{ fontSize: 11 }}>
                          {pc} ·{" "}
                          {i === 0
                            ? "Collection"
                            : `Drop ${i}`}
                        </div>
                      </div>
                      {done && (
                        <span className="pill delivered">
                          <span className="dot" />
                          Done
                        </span>
                      )}
                    </li>
                  );
                })}
                {stops.length === 0 && (
                  <li
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "var(--ink-500)",
                      fontSize: 12.5,
                    }}
                  >
                    No stops on this run.
                  </li>
                )}
              </ol>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Event timeline</h3>
              <span className="muted" style={{ fontSize: 11 }}>
                {events.length} events
              </span>
            </div>
            <div className="card-body">
              <div className="timeline">
                {events.map((e, i) => (
                  <div
                    key={i}
                    className={`tl-item ${e.kind === "ok" ? "done" : e.kind === "current" ? "current" : ""}`}
                  >
                    <div className="tl-time mono">
                      {e.at.slice(11)} · {e.at.slice(0, 10)}
                    </div>
                    <div
                      className="tl-title"
                      style={
                        e.kind === "err" ? { color: "var(--err)" } : undefined
                      }
                    >
                      {e.title}
                    </div>
                    {e.meta && <div className="tl-meta">{e.meta}</div>}
                  </div>
                ))}
                {events.length === 0 && (
                  <div
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "var(--ink-500)",
                      fontSize: 12.5,
                    }}
                  >
                    No events recorded yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="col gap-16">
          <div className="card">
            <div className="card-header">
              <h3>Vehicle &amp; driver</h3>
            </div>
            <div className="card-body">
              <div className="row gap-12" style={{ marginBottom: driver ? 14 : 0 }}>
                <div
                  className="img-placeholder"
                  style={{ width: 80, height: 60 }}
                >
                  vehicle
                </div>
                <div>
                  <div className="bold mono" style={{ fontSize: 14 }}>
                    {run.vehicle || "Unassigned"}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {run.vehicle
                      ? "Tractor unit"
                      : "Awaiting vehicle assignment"}
                  </div>
                </div>
              </div>
              {driver && (
                <>
                  <div className="divider" />
                  <div className="row gap-12">
                    <div
                      className="avatar"
                      style={{ width: 36, height: 36, fontSize: 13 }}
                    >
                      {driver.name
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s) => s[0]?.toUpperCase() ?? "")
                        .join("")}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bold" style={{ fontSize: 13 }}>
                        {driver.name}
                      </div>
                      <div
                        className="muted"
                        style={{
                          fontSize: 11,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {driver.email}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Consignment</h3>
            </div>
            <div className="card-body">
              <dl className="kv-grid">
                <dt>Customer</dt>
                <dd>{run.customer}</dd>
                <dt>Booking ref</dt>
                <dd className="mono">{run.loadRef || "—"}</dd>
                <dt>Job number</dt>
                <dd className="mono">{run.jobNumber}</dd>
                <dt>Service</dt>
                <dd>{run.runType === "backload" ? "Backload" : "Delivery"}</dd>
                <dt>Start time</dt>
                <dd className="mono">{run.startTime || "—"}</dd>
                {run.collectionTime && (
                  <>
                    <dt>Collection time</dt>
                    <dd className="mono">{run.collectionTime}</dd>
                  </>
                )}
                <dt>Return to base</dt>
                <dd>{run.returnToBase ? "Yes" : "No"}</dd>
              </dl>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Documents</h3>
            </div>
            <div className="card-body">
              <div
                style={{
                  padding: 16,
                  textAlign: "center",
                  color: "var(--ink-500)",
                  fontSize: 12,
                }}
              >
                POD / CMR uploads land here once dispatch attaches them.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function buildTimeline(
  run: PlannedRun,
  stops: string[],
  completedIdx: Set<number>,
  status: ReturnType<typeof deriveStatus>,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const meta = run.completedMeta ?? {};

  events.push({
    at: `${run.date} ${run.startTime || "00:00"}`,
    title: "Run scheduled",
    meta: `Booking ref ${run.loadRef || "—"}`,
    kind: "info",
  });

  stops.forEach((pc, i) => {
    const done = completedIdx.has(i);
    const m = meta[i];
    const at = m?.atISO
      ? formatLocalIso(m.atISO)
      : `${run.date} ${run.startTime || "00:00"}`;
    const label = i === 0 ? "Collection" : `Drop ${i}`;
    if (done) {
      events.push({
        at,
        title: `${label} completed at ${pc}`,
        meta: m?.by ? `Marked by ${m.by}` : undefined,
        kind: "ok",
      });
    } else {
      const nextStopIdx = stops.findIndex((_, idx) => !completedIdx.has(idx));
      const isCurrent = i === nextStopIdx && status !== "delivered";
      events.push({
        at,
        title: isCurrent ? `Heading to ${pc}` : `Scheduled: ${label} at ${pc}`,
        kind: isCurrent ? "current" : "pending",
      });
    }
  });

  return events;
}

function formatLocalIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 5);
  return `${date} ${time}`;
}

function buildMapData(
  stops: string[],
  coords: Record<string, { lat: number; lng: number }>,
  completedIdx: Set<number>,
  truckPos: { lat: number; lng: number } | null,
  delivered: boolean,
): { mapPins: MapPin[]; mapRoutes: MapRoute[] } {
  const pins: MapPin[] = [];
  const stopPoints: Array<[number, number] | null> = stops.map((pc) => {
    const c = coords[normalizePostcode(pc)];
    return c ? [c.lng, c.lat] : null;
  });

  // First "stop" is treated as origin; the rest are drops.
  stops.forEach((pc, i) => {
    const point = stopPoints[i];
    if (!point) return;
    const done = completedIdx.has(i);
    const nextIdx = stops.findIndex((_, idx) => !completedIdx.has(idx));
    const isCurrent = !delivered && i === nextIdx;
    pins.push({
      id: `stop-${i}`,
      kind: i === 0 ? "origin" : "stop",
      lng: point[0],
      lat: point[1],
      badge: i === 0 ? undefined : String(i),
      state: done ? "done" : isCurrent ? "current" : "pending",
      label: pc,
    });
  });

  if (truckPos && !delivered) {
    pins.push({
      id: "truck",
      kind: "truck",
      lng: truckPos.lng,
      lat: truckPos.lat,
      selected: true,
      label: "Vehicle position",
    });
  }

  // Build done + remaining route segments based on the contiguous stretch of
  // completed stops at the start of the route.
  const routes: MapRoute[] = [];
  const validPoints = stopPoints.filter(
    (p): p is [number, number] => p !== null,
  );
  if (validPoints.length >= 2) {
    let firstIncomplete = stops.findIndex((_, i) => !completedIdx.has(i));
    if (firstIncomplete === -1) firstIncomplete = stops.length;
    const donePoints = stopPoints
      .slice(0, firstIncomplete)
      .filter((p): p is [number, number] => p !== null);
    const remainingPoints = stopPoints
      .slice(Math.max(0, firstIncomplete - 1))
      .filter((p): p is [number, number] => p !== null);
    if (donePoints.length >= 2) {
      routes.push({
        id: "done",
        points: donePoints,
        state: "done",
      });
    }
    if (remainingPoints.length >= 2) {
      routes.push({
        id: "remaining",
        points: remainingPoints,
        state: "remaining",
      });
    }
  }

  return { mapPins: pins, mapRoutes: routes };
}
