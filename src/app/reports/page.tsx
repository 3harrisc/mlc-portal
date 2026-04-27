"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import { createClient } from "@/lib/supabase/client";
import { rowToRun } from "@/types/runs";
import type { PlannedRun } from "@/types/runs";
import { parseStops } from "@/lib/postcode-utils";
import { todayISO, formatTime } from "@/lib/time-utils";

export default function ReportsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const allowedCustomers = useMemo(() => profile?.allowed_customers ?? [], [profile]);

  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayISO);
  const [dateTo, setDateTo] = useState(todayISO);
  const [customerFilter, setCustomerFilter] = useState("All");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("runs")
        .select("*")
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: false });
      if (!cancelled && !error && data) setRuns(data.map(rowToRun));
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const customers = useMemo(() => {
    const set = new Set(runs.map((r) => r.customer));
    return ["All", ...Array.from(set).sort()];
  }, [runs]);

  const vehicles = useMemo(() => {
    const set = new Set(runs.map((r) => r.vehicle).filter(Boolean));
    return Array.from(set).sort();
  }, [runs]);

  const filtered = useMemo(() => {
    return runs
      .filter((r) => isAdmin || allowedCustomers.includes(r.customer))
      .filter((r) => customerFilter === "All" || r.customer === customerFilter)
      .filter((r) => !vehicleFilter || r.vehicle === vehicleFilter);
  }, [runs, customerFilter, vehicleFilter, isAdmin, allowedCustomers]);

  const totalRuns = filtered.length;
  const completedRuns = filtered.filter((r) => {
    const stops = parseStops(r.rawText);
    const done = r.completedStopIndexes?.length ?? r.progress?.completedIdx?.length ?? 0;
    return stops.length > 0 && done >= stops.length;
  }).length;
  const inProgressRuns = filtered.filter((r) => {
    const stops = parseStops(r.rawText);
    const done = r.completedStopIndexes?.length ?? r.progress?.completedIdx?.length ?? 0;
    return done > 0 && done < stops.length;
  }).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Delivery reports</h1>
          <div className="page-subtitle">Run-level completion stats with stop-by-stop timestamps.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div className="field">
              <label>From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input" />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input" />
            </div>
            <div className="field">
              <label>Customer</label>
              <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className="select">
                {customers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Vehicle</label>
              <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="select">
                <option value="">All</option>
                {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="kpi">
          <div className="kpi-label"><Icon name="list" size={12} /> Total runs</div>
          <div className="kpi-value">{totalRuns}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label" style={{ color: "var(--ok)" }}><Icon name="check" size={12} /> Completed</div>
          <div className="kpi-value" style={{ color: "var(--ok)" }}>{completedRuns}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label" style={{ color: "var(--warn)" }}><Icon name="clock" size={12} /> In progress</div>
          <div className="kpi-value" style={{ color: "var(--warn)" }}>{inProgressRuns}</div>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading runs…</div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
            No runs found for this period.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((run) => {
            const stops = parseStops(run.rawText);
            const completedIndexes = run.completedStopIndexes?.length
              ? run.completedStopIndexes
              : run.progress?.completedIdx ?? [];
            const completedCount = completedIndexes.length;
            const totalStops = stops.length;
            const pct = totalStops > 0 ? Math.round((completedCount / totalStops) * 100) : 0;
            const isExpanded = expandedId === run.id;

            const meta = run.completedMeta ?? {};
            const arrivalTimes = Object.values(meta)
              .map((m) => m.arrivedISO ? new Date(m.arrivedISO).getTime() : m.atISO ? new Date(m.atISO).getTime() : NaN)
              .filter((t) => !isNaN(t));
            const departureTimes = Object.values(meta).filter((m) => m.atISO).map((m) => new Date(m.atISO!).getTime()).filter((t) => !isNaN(t));
            const firstDelivery = arrivalTimes.length ? new Date(Math.min(...arrivalTimes)).toISOString() : null;
            const lastDelivery = departureTimes.length ? new Date(Math.max(...departureTimes)).toISOString() : null;

            const isComplete = totalStops > 0 && completedCount >= totalStops;
            const status = isComplete ? "complete" : completedCount > 0 ? "in-progress" : "pending";
            const pillCls = isComplete ? "delivered" : completedCount > 0 ? "in-transit" : "scheduled";

            return (
              <div key={run.id} className="card">
                <div
                  className="card-header"
                  style={{ cursor: "pointer" }}
                  onClick={() => setExpandedId(isExpanded ? null : run.id)}
                >
                  <h3 style={{ flex: 1, minWidth: 0 }}>
                    <span className="row gap-8" style={{ flexWrap: "wrap" }}>
                      <span className="mono">{run.jobNumber}</span>
                      <span className={`pill ${pillCls}`}>
                        <span className="dot" />
                        {status}
                      </span>
                    </span>
                    <span className="muted" style={{ fontSize: 11, fontWeight: 400, display: "block", marginTop: 2 }}>
                      {run.date} · {run.customer} · {run.vehicle || "No vehicle"}
                    </span>
                  </h3>
                  <div className="actions">
                    <span className="bold mono tnum" style={{ fontSize: 14 }}>{pct}%</span>
                    <span className="muted mono tnum" style={{ fontSize: 11 }}>{completedCount}/{totalStops}</span>
                    {firstDelivery && lastDelivery && (
                      <span className="muted mono" style={{ fontSize: 11 }}>
                        {formatTime(firstDelivery)}–{formatTime(lastDelivery)}
                      </span>
                    )}
                    <Icon name={isExpanded ? "chevD" : "chevR"} size={12} className="muted" />
                  </div>
                </div>
                <div style={{ height: 4, background: "var(--surface-alt)" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: isComplete ? "var(--ok)" : "var(--info)",
                      transition: "width 400ms",
                    }}
                  />
                </div>

                {isExpanded && (
                  <div className="card-body">
                    <div className="muted" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 8 }}>
                      STOP DETAILS
                    </div>
                    {stops.length === 0 ? (
                      <div className="muted" style={{ fontSize: 12 }}>No stops parsed.</div>
                    ) : (
                      <table className="data">
                        <tbody>
                          {stops.map((pc, idx) => {
                            const stopMeta = meta[idx];
                            const isDone = completedIndexes.includes(idx);
                            return (
                              <tr key={idx} style={{ cursor: "default" }}>
                                <td style={{ width: 40 }}>
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      width: 22, height: 22, borderRadius: "50%",
                                      background: isDone ? "var(--ok-bg)" : "var(--surface-alt)",
                                      color: isDone ? "var(--ok)" : "var(--ink-400)",
                                      fontSize: 11, fontWeight: 600,
                                    }}
                                  >
                                    {isDone ? <Icon name="check" size={11} /> : idx + 1}
                                  </span>
                                </td>
                                <td className="mono">{pc}</td>
                                <td className="right" style={{ fontSize: 11 }}>
                                  {stopMeta ? (
                                    <>
                                      {stopMeta.arrivedISO && (
                                        <span className="muted">Arr {formatTime(stopMeta.arrivedISO)} </span>
                                      )}
                                      <span>{stopMeta.atISO ? `Left ${formatTime(stopMeta.atISO)}` : "On site"}</span>
                                      <span className="muted" style={{ marginLeft: 6 }}>({stopMeta.by === "auto" ? "auto" : "manual"})</span>
                                    </>
                                  ) : isDone ? (
                                    <span className="muted">Completed</span>
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
