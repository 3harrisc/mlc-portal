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
import { deleteLoad, setLoadVehicle, updateLoad } from "@/app/actions/loads";
import LoadEditModal, {
  type LoadEdits,
} from "@/components/portal/LoadEditModal";
import { listVehicles } from "@/app/actions/fleet";
import { buildRoutePlan, type RoutePlan, type PlanLeg } from "@/lib/portal/route-plan";
import Icon from "@/components/portal/Icon";
import StatusPill from "@/components/portal/StatusPill";
import PortalMap, {
  type MapPin,
  type MapRoute,
} from "@/components/portal/PortalMap";
import ShareLinkPanel from "@/components/portal/ShareLinkPanel";
import { useToast } from "@/components/portal/ToastContext";
import {
  deriveStatus,
  displayDestination,
  legSiteTimes,
  quickEta,
} from "@/lib/portal/loads";
import { chainedEta, computeLoadChains } from "@/lib/portal/load-chains";

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
  // Siblings are other loads on the same vehicle+date — needed so we can
  // compute chained start times for stacked customer loads (matches what the
  // dispatch planner does for stacked runs).
  const [siblings, setSiblings] = useState<PlannedRun[]>([]);
  // Customer's depot postcode. Used by buildRoutePlan to decide whether the
  // load's fromPostcode IS the collection point (Ashwood-style multi-drop)
  // or just a synthetic copy of it on a return-to-base row.
  const [customerBase, setCustomerBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("loads")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const detail = rowToRun(data);
      setRun(detail);

      // Look up the customer's base_postcode. Customer names in the runs
      // table are case-sensitive labels but the customers table is keyed
      // on `name`, so we use ilike for tolerant matching.
      if (detail.customer) {
        const { data: cust } = await supabase
          .from("customers")
          .select("base_postcode")
          .ilike("name", detail.customer)
          .maybeSingle();
        if (!cancelled) setCustomerBase(cust?.base_postcode ?? null);
      }

      // Fetch siblings only when the load has a vehicle assigned — without a
      // vehicle there's nothing to chain. Includes the current load so the
      // chain map can sort it relative to its peers.
      if (detail.vehicle?.trim()) {
        const { data: sibRows } = await supabase
          .from("loads")
          .select("*")
          .eq("date", detail.date)
          .eq("vehicle", detail.vehicle);
        if (!cancelled && sibRows) {
          setSiblings(sibRows.map(rowToRun));
        }
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

  return (
    <LoadDetailView
      run={run}
      siblings={siblings}
      nicknames={nicknames}
      customerBase={customerBase}
      onRunChange={setRun}
      onSiblingsChange={setSiblings}
    />
  );
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
  siblings,
  nicknames,
  customerBase,
  onRunChange,
  onSiblingsChange,
}: {
  run: PlannedRun;
  siblings: PlannedRun[];
  nicknames: Record<string, string>;
  customerBase: string | null;
  onRunChange: (run: PlannedRun) => void;
  onSiblingsChange: (siblings: PlannedRun[]) => void;
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

  // Canonical fleet list for the inline reg picker (admin only). Includes
  // RENTAL / SUBBY pseudo-vehicles via the `vehicles` table.
  const [fleetVehicles, setFleetVehicles] = useState<string[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listVehicles().then((res) => {
      if (cancelled) return;
      setFleetVehicles(
        (res.vehicles ?? []).filter((v) => v.active).map((v) => v.id),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const [savingVehicle, setSavingVehicle] = useState(false);

  /**
   * Persist a new registration on this load. After success we refresh the
   * local `run` state and re-fetch siblings so chained-start computation
   * downstream picks up the change without a full page reload.
   */
  async function handleSetVehicle(raw: string) {
    const trimmed = raw.trim().toUpperCase();
    if (trimmed === (run.vehicle ?? "").toUpperCase()) return;
    setSavingVehicle(true);
    const res = await setLoadVehicle(run.id, trimmed);
    if (res.error) {
      setSavingVehicle(false);
      showToast(`Couldn't save reg: ${res.error}`, "err");
      return;
    }
    onRunChange({ ...run, vehicle: trimmed });
    // Re-pull siblings so chained-start times reflect the new vehicle binding.
    if (trimmed) {
      const supabase = createClient();
      const { data: sibRows } = await supabase
        .from("loads")
        .select("*")
        .eq("date", run.date)
        .eq("vehicle", trimmed);
      if (sibRows) onSiblingsChange(sibRows.map(rowToRun));
    } else {
      onSiblingsChange([]);
    }
    setSavingVehicle(false);
    showToast(trimmed ? `Vehicle set to ${trimmed}` : "Vehicle cleared");
  }

  // Edit modal: state + persistence handler. We refetch siblings on
  // success because changes to runType / startTime affect chained-start
  // computation for stacked loads on the same vehicle+date.
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  async function handleSaveEdits(edits: LoadEdits) {
    setEditSaving(true);
    const res = await updateLoad(run.id, {
      date: edits.date,
      runType: edits.runType,
      startTime: edits.startTime,
      collectionTime: edits.collectionTime || null,
      collectionDate: edits.collectionDate || null,
      fromPostcode: edits.fromPostcode,
      toPostcode: edits.toPostcode,
      rawText: edits.rawText,
      returnToBase: edits.returnToBase,
      serviceMins: edits.serviceMins,
      includeBreaks: edits.includeBreaks,
    });
    if (res.error) {
      setEditSaving(false);
      showToast(`Couldn't save: ${res.error}`, "err");
      return;
    }
    const dateChanged = edits.date !== run.date;
    onRunChange({
      ...run,
      date: edits.date,
      runType: edits.runType,
      startTime: edits.startTime,
      collectionTime: edits.collectionTime || undefined,
      collectionDate: edits.collectionDate || undefined,
      fromPostcode: edits.fromPostcode,
      toPostcode: edits.toPostcode,
      rawText: edits.rawText,
      returnToBase: edits.returnToBase,
      serviceMins: edits.serviceMins,
      includeBreaks: edits.includeBreaks,
    });
    // Refetch siblings against the (possibly new) date so chained-start
    // computation reflects the load's new place in the day's lineup.
    if (run.vehicle?.trim()) {
      const supabase = createClient();
      const { data: sibRows } = await supabase
        .from("loads")
        .select("*")
        .eq("date", edits.date)
        .eq("vehicle", run.vehicle);
      if (sibRows) onSiblingsChange(sibRows.map(rowToRun));
    }
    setEditSaving(false);
    setEditOpen(false);
    showToast(dateChanged ? `Load moved to ${edits.date}` : "Load updated");
  }

  const handleDelete = () => {
    const label = run.jobNumber || run.id;
    if (!window.confirm(`Delete load ${label}? This cannot be undone.`)) return;
    startDelete(async () => {
      const result = await deleteLoad(run.id);
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
  // Canonical "what does this load look like on the road" plan. Folds in
  // the customer's base postcode so Ashwood-style multi-drop runs render
  // their depot as the collection point and every parsed stop as a drop.
  const plan: RoutePlan = useMemo(
    () => buildRoutePlan(run, customerBase),
    [run, customerBase],
  );
  const completedIdx = useMemo(() => {
    const fromCompleted = new Set(run.completedStopIndexes ?? []);
    (run.progress?.completedIdx ?? []).forEach((i) => fromCompleted.add(i));
    return fromCompleted;
  }, [run.completedStopIndexes, run.progress]);
  const completedCount = completedIdx.size;
  // Combined postcode list: every leg in this load's plan (so the map can
  // pin the depot, every drop, and the return-to-base leg) + every sibling's
  // from / last-stop postcodes (so chained-start travel time uses real
  // haversine distance rather than the 30-minute fallback).
  const allChainPostcodes = useMemo(() => {
    const set = new Set<string>();
    for (const leg of plan.legs) {
      if (leg.postcode) set.add(leg.postcode);
    }
    const chainable = siblings.length > 0 ? siblings : [run];
    for (const r of chainable) {
      if (r.fromPostcode) set.add(r.fromPostcode);
      const sibStops = parseStops(r.rawText);
      if (sibStops.length) set.add(sibStops[sibStops.length - 1]);
    }
    return Array.from(set);
  }, [plan, siblings, run]);
  const { coords } = usePostcodeCoords(allChainPostcodes);

  // When this load shares a vehicle+date with one or more siblings, surface
  // the chained start time / ETA — matches dispatch's stacked-run handling.
  const chains = useMemo(
    () => computeLoadChains(siblings.length > 0 ? siblings : [run], coords),
    [siblings, run, coords],
  );
  const chainedInfo = chains.get(run.id);
  const displayedStart = chainedInfo?.chainedStartTime ?? run.startTime;
  const eta = chainedInfo ? chainedEta(run, chainedInfo) : quickEta(run);

  const { mapPins, mapRoutes } = useMemo(
    () => buildMapData(plan, coords, completedIdx, truckPos, status === "delivered"),
    [plan, coords, completedIdx, truckPos, status],
  );

  const events = useMemo<TimelineEvent[]>(
    () => buildTimeline(run, plan, completedIdx, status),
    [run, plan, completedIdx, status],
  );

  // Subtitle uses the route plan's first/last "real" leg (origin and final
  // delivery) so return-to-base loads no longer read "CF44 8ER -> CF44 8ER".
  // Falls back to displayDestination(run) when the plan only has one leg —
  // covers email-forwarded runs where the lorry returns to base, so the
  // shown destination is the parsed delivery postcode rather than the
  // round-trip origin.
  const subtitleLegs = plan.legs.filter((l) => l.kind !== "return");
  const originPostcode = subtitleLegs[0]?.postcode ?? run.fromPostcode;
  const finalPostcode =
    subtitleLegs.length > 1
      ? subtitleLegs[subtitleLegs.length - 1].postcode
      : displayDestination(run);
  const fromName = withNickname(originPostcode, nicknames) || originPostcode;
  const toName = withNickname(finalPostcode, nicknames) || finalPostcode;
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
            {run.customer} · {fromName} ({originPostcode}) → {toName} (
            {finalPostcode || "—"}) · {dateDisp}
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
              onClick={() => setEditOpen(true)}
              title="Edit run details, switch run type, reorder stops"
            >
              <Icon name="settings" size={13} /> Edit run
            </button>
          )}
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
              /{plan.dropCount} drops
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
          <div className="v mono">{displayedStart || "—"}</div>
          {chainedInfo && (
            <div className="muted" style={{ fontSize: 10.5 }}>
              chained · booked {run.startTime}
            </div>
          )}
        </div>
      </div>

      <div className="two-col">
        <div className="col gap-16">
          <div className="card">
            <div className="card-header">
              <h3>Route &amp; live position</h3>
              <span className="muted" style={{ fontSize: 11 }}>
                · {plan.dropCount} drop{plan.dropCount === 1 ? "" : "s"}
                {plan.legs.some((l) => l.kind === "return") && " · returns to base"}
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
                {plan.legs.map((leg, i) => {
                  // Synthetic legs (collection from the depot, return-to-base)
                  // are never marked complete — completedIdx tracks indexes
                  // into the parseStops array, so only legs with stopIndex
                  // can be done.
                  const done = leg.stopIndex != null && completedIdx.has(leg.stopIndex);
                  const isOrigin = leg.kind === "origin";
                  const isReturn = leg.kind === "return";
                  // Arrived / departed / on-site state — surfaced for every
                  // real (non-synthetic) leg so customers can read off their
                  // KPI fields (on-time arrival, dwell time, etc.).
                  const site = legSiteTimes(run, leg.stopIndex ?? null);
                  return (
                    <li
                      key={`${leg.postcode}-${i}-${leg.kind}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 10px",
                        border: site.onSite
                          ? "1px solid var(--mlc-blue)"
                          : "1px solid var(--line)",
                        borderRadius: 6,
                        background: site.onSite
                          ? "var(--mlc-blue-50)"
                          : done
                            ? "var(--ok-bg)"
                            : isOrigin
                              ? "var(--mlc-blue-50)"
                              : "var(--surface-alt)",
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: site.onSite
                            ? "var(--mlc-blue)"
                            : done
                              ? "var(--ok)"
                              : isOrigin
                                ? "var(--mlc-blue)"
                                : isReturn
                                  ? "var(--ink-500)"
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
                          {withNickname(leg.postcode, nicknames) || leg.postcode}
                        </div>
                        <div className="muted mono" style={{ fontSize: 11 }}>
                          {leg.postcode} · {leg.label}
                        </div>
                        {/* Arrived / departed / on-site times — only shown
                            for real stops with at least one timestamp. */}
                        {(site.arrivedAt || site.departedAt || site.onSite) && (
                          <div
                            className="row gap-12"
                            style={{ marginTop: 4, flexWrap: "wrap", fontSize: 11 }}
                          >
                            {site.arrivedAt && (
                              <span className="mono">
                                <span className="muted">Arrived</span>{" "}
                                <span className="bold">{site.arrivedAt}</span>
                              </span>
                            )}
                            {site.departedAt && (
                              <span className="mono">
                                <span className="muted">Departed</span>{" "}
                                <span className="bold">{site.departedAt}</span>
                              </span>
                            )}
                            {site.onSite && !site.departedAt && site.onSiteSince && (
                              <span
                                className="mono"
                                style={{ color: "var(--mlc-blue)" }}
                              >
                                <span className="muted">On site since</span>{" "}
                                <span className="bold">{site.onSiteSince}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {site.onSite ? (
                        <span
                          className="pill"
                          style={{
                            background: "var(--mlc-blue)",
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 99,
                            fontSize: 10.5,
                            fontWeight: 600,
                          }}
                        >
                          <span
                            className="dot"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "#fff",
                              animation: "pulse 1.5s ease-in-out infinite",
                            }}
                          />
                          On Site
                        </span>
                      ) : done ? (
                        <span className="pill delivered">
                          <span className="dot" />
                          Done
                        </span>
                      ) : null}
                    </li>
                  );
                })}
                {plan.legs.length === 0 && (
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
              <div
                className="row gap-12"
                style={{ marginBottom: driver ? 14 : 0, alignItems: "flex-start" }}
              >
                <div
                  className="img-placeholder"
                  style={{ width: 80, height: 60, flexShrink: 0 }}
                >
                  vehicle
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isAdmin ? (
                    <>
                      <input
                        type="text"
                        list="load-detail-fleet"
                        defaultValue={run.vehicle ?? ""}
                        onBlur={(e) => void handleSetVehicle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") {
                            (e.target as HTMLInputElement).value = run.vehicle ?? "";
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="Pick reg…"
                        disabled={savingVehicle}
                        className="input mono"
                        style={{
                          height: 32,
                          padding: "0 10px",
                          fontSize: 13,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          width: "100%",
                        }}
                      />
                      <datalist id="load-detail-fleet">
                        {fleetVehicles.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {savingVehicle
                          ? "Saving…"
                          : run.vehicle
                            ? "Tractor unit · type or pick from fleet"
                            : "Assign a registration to enable tracking"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bold mono" style={{ fontSize: 14 }}>
                        {run.vehicle || "Unassigned"}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {run.vehicle
                          ? "Tractor unit"
                          : "Awaiting vehicle assignment"}
                      </div>
                    </>
                  )}
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

      <LoadEditModal
        open={editOpen}
        run={run}
        saving={editSaving}
        onClose={() => setEditOpen(false)}
        onSave={handleSaveEdits}
      />
    </>
  );
}

function buildTimeline(
  run: PlannedRun,
  plan: RoutePlan,
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

  // The "next" leg-in-progress is the first leg whose stopIndex hasn't
  // been completed. Synthetic legs (origin from the depot, return-to-base)
  // can't be "completed" — we just show them as info anchors.
  const nextDropLegIdx = plan.legs.findIndex(
    (l) => l.stopIndex != null && !completedIdx.has(l.stopIndex),
  );

  plan.legs.forEach((leg, i) => {
    const done = leg.stopIndex != null && completedIdx.has(leg.stopIndex);
    const m = leg.stopIndex != null ? meta[leg.stopIndex] : undefined;
    const onSite =
      leg.stopIndex != null && run.progress?.onSiteIdx === leg.stopIndex;
    const fallbackAt = `${run.date} ${run.startTime || "00:00"}`;

    if (done) {
      // Emit two events: arrival, then departure. Keeps the timeline
      // honest for customer KPI audits — both timestamps live in
      // completed_meta, no point hiding the arrival.
      if (m?.arrivedISO) {
        events.push({
          at: formatLocalIso(m.arrivedISO),
          title: `Arrived at ${leg.postcode}`,
          kind: "ok",
        });
      }
      events.push({
        at: m?.atISO ? formatLocalIso(m.atISO) : fallbackAt,
        title: `Departed ${leg.postcode} · ${leg.label} complete`,
        meta: m?.by ? `Marked by ${m.by}` : undefined,
        kind: "ok",
      });
    } else if (onSite) {
      // Live "on site" — vehicle inside the radius but not yet departed.
      const since = run.progress?.onSiteSinceMs
        ? new Date(run.progress.onSiteSinceMs).toISOString()
        : null;
      events.push({
        at: since ? formatLocalIso(since) : fallbackAt,
        title: `On site at ${leg.postcode}`,
        kind: "current",
      });
    } else if (leg.kind === "origin") {
      events.push({
        at: fallbackAt,
        title: `Start: ${leg.label} at ${leg.postcode}`,
        kind: "info",
      });
    } else if (leg.kind === "return") {
      events.push({
        at: fallbackAt,
        title: `Return to base at ${leg.postcode}`,
        kind: "info",
      });
    } else {
      const isCurrent = i === nextDropLegIdx && status !== "delivered";
      events.push({
        at: fallbackAt,
        title: isCurrent
          ? `Heading to ${leg.postcode}`
          : `Scheduled: ${leg.label} at ${leg.postcode}`,
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
  plan: RoutePlan,
  coords: Record<string, { lat: number; lng: number }>,
  completedIdx: Set<number>,
  truckPos: { lat: number; lng: number } | null,
  delivered: boolean,
): { mapPins: MapPin[]; mapRoutes: MapRoute[] } {
  const pins: MapPin[] = [];
  // One [lng, lat] per leg, in plan order. We DON'T filter out missing
  // points here — instead we track the gaps so the route line still
  // connects the legs we DO have. This avoids dropping a pin for the
  // depot just because postcode_coords hasn't been hydrated yet.
  const legPoints: Array<[number, number] | null> = plan.legs.map((leg) => {
    const c = coords[normalizePostcode(leg.postcode)];
    return c ? [c.lng, c.lat] : null;
  });

  const isDoneLeg = (leg: PlanLeg) =>
    leg.stopIndex != null && completedIdx.has(leg.stopIndex);

  // First non-completed real drop = "current" highlight on the map.
  const nextDropLegIdx = plan.legs.findIndex(
    (l) => l.kind === "drop" && !isDoneLeg(l),
  );

  plan.legs.forEach((leg, i) => {
    const point = legPoints[i];
    if (!point) return;
    const done = isDoneLeg(leg);
    const isCurrent = !delivered && i === nextDropLegIdx;
    // Synthetic origin / return legs render as "origin" pins so they
    // visually anchor the route line; numbered drops render as "stop".
    const kind = leg.kind === "drop" ? "stop" : "origin";
    pins.push({
      id: `leg-${i}-${leg.kind}`,
      kind,
      lng: point[0],
      lat: point[1],
      badge:
        leg.kind === "drop" && leg.stopIndex != null
          ? String(leg.stopIndex + 1)
          : undefined,
      state: done ? "done" : isCurrent ? "current" : "pending",
      label: `${leg.postcode} · ${leg.label}`,
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

  // Route line: split into "done" (everything up to the first incomplete
  // drop) and "remaining" (from the last completed drop onwards). We
  // skip null points so a missing geocode mid-route doesn't crash the
  // line but we still preserve order.
  const routes: MapRoute[] = [];
  const firstIncompleteLegIdx = plan.legs.findIndex(
    (l) => l.kind === "drop" && !isDoneLeg(l),
  );
  const splitAt =
    firstIncompleteLegIdx === -1 ? plan.legs.length : firstIncompleteLegIdx;
  const donePoints = legPoints
    .slice(0, splitAt)
    .filter((p): p is [number, number] => p !== null);
  const remainingPoints = legPoints
    .slice(Math.max(0, splitAt - 1))
    .filter((p): p is [number, number] => p !== null);
  if (donePoints.length >= 2) {
    routes.push({ id: "done", points: donePoints, state: "done" });
  }
  if (remainingPoints.length >= 2) {
    routes.push({
      id: "remaining",
      points: remainingPoints,
      state: "remaining",
    });
  }

  return { mapPins: pins, mapRoutes: routes };
}
