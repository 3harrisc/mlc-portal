"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import Icon from "@/components/portal/Icon";
import { rowToRun } from "@/types/runs";
import type { PlannedRun } from "@/types/runs";
import { todayISO } from "@/lib/time-utils";
import { parseStops } from "@/lib/postcode-utils";

interface DriverInfo {
  id: string;
  email: string;
  full_name: string | null;
  assigned_vehicle: string | null;
}

type DriverStatusKind =
  | "no_vehicle"
  | "no_run"
  | "not_started"
  | "in_progress"
  | "complete";

interface DriverStatus {
  driver: DriverInfo;
  run: PlannedRun | null;
  stops: string[];
  completedCount: number;
  totalStops: number;
  currentStopIdx: number | null;
  status: DriverStatusKind;
}

function statusPill(s: DriverStatusKind): { label: string; cls: string } {
  switch (s) {
    case "complete":    return { label: "Complete", cls: "delivered" };
    case "in_progress": return { label: "In progress", cls: "in-transit" };
    case "not_started": return { label: "Not started", cls: "scheduled" };
    case "no_run":      return { label: "No run today", cls: "delayed" };
    case "no_vehicle":  return { label: "No vehicle", cls: "exception" };
  }
}

export default function AdminDriversPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [driverStatuses, setDriverStatuses] = useState<DriverStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const today = todayISO();

    const [{ data: drivers }, { data: runsData }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, full_name, assigned_vehicle")
        .eq("role", "driver")
        .eq("active", true)
        .order("email"),
      supabase.from("runs").select("*").eq("date", today),
    ]);

    const runs = (runsData ?? []).map(rowToRun);
    const statuses: DriverStatus[] = (drivers ?? []).map((d: DriverInfo) => {
      if (!d.assigned_vehicle?.trim()) {
        return { driver: d, run: null, stops: [], completedCount: 0, totalStops: 0, currentStopIdx: null, status: "no_vehicle" };
      }
      const matchedRun = runs.find(
        (r) => r.vehicle.trim().toUpperCase() === d.assigned_vehicle!.trim().toUpperCase()
      );
      if (!matchedRun) {
        return { driver: d, run: null, stops: [], completedCount: 0, totalStops: 0, currentStopIdx: null, status: "no_run" };
      }
      const stops = parseStops(matchedRun.rawText);
      const completedCount = Math.max(
        (matchedRun.completedStopIndexes ?? []).length,
        (matchedRun.progress?.completedIdx ?? []).length
      );
      const currentStopIdx = matchedRun.progress?.onSiteIdx ?? null;
      const isComplete = stops.length > 0 && completedCount >= stops.length;
      const status: DriverStatusKind = isComplete
        ? "complete"
        : completedCount > 0 || currentStopIdx != null
        ? "in_progress"
        : "not_started";
      return { driver: d, run: matchedRun, stops, completedCount, totalStops: stops.length, currentStopIdx, status };
    });

    setDriverStatuses(statuses);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    queueMicrotask(() => { loadData(); });
    const timer = setInterval(loadData, 60_000);
    return () => clearInterval(timer);
  }, [profile, loadData]);

  const summary = useMemo(() => {
    const byStatus: Record<DriverStatusKind, number> = {
      complete: 0, in_progress: 0, not_started: 0, no_run: 0, no_vehicle: 0,
    };
    for (const ds of driverStatuses) byStatus[ds.status]++;
    return { ...byStatus, total: driverStatuses.length };
  }, [driverStatuses]);

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Driver overview</h1>
          <div className="page-subtitle">
            {todayISO()} · {summary.total} driver{summary.total !== 1 ? "s" : ""}
            {lastRefresh && <span className="muted" style={{ marginLeft: 8 }}>Updated {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button type="button" className="btn sm" onClick={() => void loadData()} disabled={loading}>
          <Icon name="refresh" size={11} /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="kpi-grid">
        <Stat label="In progress" value={summary.in_progress} accent="var(--info)" />
        <Stat label="Complete"    value={summary.complete}    accent="var(--ok)" />
        <Stat label="Not started" value={summary.not_started} />
        <Stat label="No run"      value={summary.no_run}      accent="var(--warn)" />
      </div>

      {loading && driverStatuses.length === 0 ? (
        <div className="muted">Loading drivers…</div>
      ) : driverStatuses.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
            No active drivers. Add driver users in{" "}
            <Link href="/admin/users" style={{ color: "var(--mlc-blue)" }}>User management</Link>.
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Vehicle</th>
                <th>Status</th>
                <th>Run</th>
                <th>Progress</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {driverStatuses.map((ds) => {
                const pill = statusPill(ds.status);
                const pct = ds.totalStops > 0 ? Math.round((ds.completedCount / ds.totalStops) * 100) : 0;
                return (
                  <tr key={ds.driver.id} style={{ cursor: "default" }}>
                    <td>
                      <div className="bold">{ds.driver.full_name ?? ds.driver.email}</div>
                      {ds.driver.full_name && (
                        <div className="muted" style={{ fontSize: 11 }}>{ds.driver.email}</div>
                      )}
                    </td>
                    <td className="mono">
                      {ds.driver.assigned_vehicle ?? <span className="muted">—</span>}
                    </td>
                    <td>
                      <span className={`pill ${pill.cls}`}>
                        <span className="dot" />{pill.label}
                      </span>
                    </td>
                    <td>
                      {ds.run ? (
                        <>
                          <div className="bold mono" style={{ fontSize: 11.5 }}>{ds.run.jobNumber || "—"}</div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {ds.run.customer} · {ds.totalStops} stop{ds.totalStops !== 1 ? "s" : ""}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {ds.run && ds.totalStops > 0 ? (
                        <>
                          <div style={{
                            height: 6, background: "var(--surface-alt)", borderRadius: 3,
                            overflow: "hidden", maxWidth: 160,
                          }}>
                            <div style={{
                              height: "100%", width: `${pct}%`,
                              background: ds.status === "complete" ? "var(--ok)" : "var(--info)",
                              transition: "width 400ms",
                            }} />
                          </div>
                          <div className="muted mono tnum" style={{ fontSize: 11, marginTop: 3 }}>
                            {ds.completedCount}/{ds.totalStops}
                            {ds.currentStopIdx != null && ds.stops[ds.currentStopIdx] && (
                              <> · on site at {ds.stops[ds.currentStopIdx]}</>
                            )}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="right">
                      {ds.run && (
                        <Link href={`/runs/${ds.run.id}`} className="btn primary sm">
                          <Icon name="arrowR" size={11} /> Run
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}
