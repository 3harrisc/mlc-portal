"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { rowToRun } from "@/types/runs";
import type { PlannedRun } from "@/types/runs";

// ── Helpers ──────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function extractPostcode(line: string): string | null {
  const m = line.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/);
  if (!m) return null;
  const noSpace = `${m[1]}${m[2]}`;
  if (noSpace.length >= 5) {
    return `${noSpace.slice(0, -3)} ${noSpace.slice(-3)}`;
  }
  return noSpace;
}

function parseStops(rawText: string): string[] {
  return (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(extractPostcode)
    .filter((pc): pc is string => pc !== null);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

// ── Component ────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const allowedCustomers = profile?.allowed_customers ?? [];

  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayISO);
  const [dateTo, setDateTo] = useState(todayISO);
  const [customerFilter, setCustomerFilter] = useState("All");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch runs for date range
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createClient();

      let query = supabase
        .from("runs")
        .select("*")
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: false });

      const { data, error } = await query;
      if (!cancelled && !error && data) {
        setRuns(data.map(rowToRun));
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  // Build filter options from data
  const customers = useMemo(() => {
    const set = new Set(runs.map((r) => r.customer));
    return ["All", ...Array.from(set).sort()];
  }, [runs]);

  const vehicles = useMemo(() => {
    const set = new Set(runs.map((r) => r.vehicle).filter(Boolean));
    return ["", ...Array.from(set).sort()];
  }, [runs]);

  // Apply filters
  const filtered = useMemo(() => {
    return runs
      .filter((r) => isAdmin || allowedCustomers.includes(r.customer))
      .filter((r) => customerFilter === "All" || r.customer === customerFilter)
      .filter((r) => !vehicleFilter || r.vehicle === vehicleFilter);
  }, [runs, customerFilter, vehicleFilter]);

  // Summary stats
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
    <div className="min-h-screen bg-black text-white">
      <Navigation />

      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <h1 className="text-xl md:text-3xl font-bold mb-6">Delivery Reports</h1>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Customer</label>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent text-sm"
            >
              {customers.map((c) => (
                <option key={c} value={c} className="bg-zinc-900">{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Vehicle</label>
            <select
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent text-sm"
            >
              <option value="" className="bg-zinc-900">All</option>
              {vehicles.filter(Boolean).map((v) => (
                <option key={v} value={v} className="bg-zinc-900">{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="border border-white/10 rounded-xl p-4 bg-white/5 text-center">
            <div className="text-2xl md:text-3xl font-bold">{totalRuns}</div>
            <div className="text-xs text-gray-400 mt-1">Total Runs</div>
          </div>
          <div className="border border-emerald-400/20 rounded-xl p-4 bg-emerald-400/5 text-center">
            <div className="text-2xl md:text-3xl font-bold text-emerald-400">{completedRuns}</div>
            <div className="text-xs text-gray-400 mt-1">Completed</div>
          </div>
          <div className="border border-yellow-400/20 rounded-xl p-4 bg-yellow-400/5 text-center">
            <div className="text-2xl md:text-3xl font-bold text-yellow-400">{inProgressRuns}</div>
            <div className="text-xs text-gray-400 mt-1">In Progress</div>
          </div>
        </div>

        {/* Run list */}
        {loading ? (
          <div className="text-gray-400 text-sm py-8 text-center">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-sm py-8 text-center">No runs found for this period.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((run) => {
              const stops = parseStops(run.rawText);
              const completedIndexes = run.completedStopIndexes?.length
                ? run.completedStopIndexes
                : run.progress?.completedIdx ?? [];
              const completedCount = completedIndexes.length;
              const totalStops = stops.length;
              const pct = totalStops > 0 ? Math.round((completedCount / totalStops) * 100) : 0;
              const isExpanded = expandedId === run.id;

              // Get first arrival / last departure from completed_meta
              const meta = run.completedMeta ?? {};
              const arrivalTimes = Object.values(meta).map((m) => m.arrivedISO ? new Date(m.arrivedISO).getTime() : new Date(m.atISO).getTime()).filter((t) => !isNaN(t));
              const departureTimes = Object.values(meta).map((m) => new Date(m.atISO).getTime()).filter((t) => !isNaN(t));
              const firstDelivery = arrivalTimes.length ? new Date(Math.min(...arrivalTimes)).toISOString() : null;
              const lastDelivery = departureTimes.length ? new Date(Math.max(...departureTimes)).toISOString() : null;

              const isComplete = totalStops > 0 && completedCount >= totalStops;

              return (
                <div key={run.id} className="border border-white/10 rounded-xl bg-white/5 overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : run.id)}
                    className="w-full text-left p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{run.jobNumber}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            isComplete
                              ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                              : completedCount > 0
                                ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/20"
                                : "bg-gray-400/10 text-gray-400 border border-gray-400/20"
                          }`}>
                            {isComplete ? "Complete" : completedCount > 0 ? "In Progress" : "Pending"}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {run.date} &middot; {run.customer} &middot; {run.vehicle || "No vehicle"}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {run.fromPostcode} &rarr; {totalStops} stop{totalStops !== 1 ? "s" : ""}
                          {run.toPostcode ? ` → ${run.toPostcode}` : ""}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-lg font-bold">{pct}%</div>
                        <div className="text-xs text-gray-400">
                          {completedCount}/{totalStops} stops
                        </div>
                        {firstDelivery && (
                          <div className="text-xs text-gray-500 mt-1">
                            {formatTime(firstDelivery)} – {formatTime(lastDelivery!)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isComplete ? "bg-emerald-400" : "bg-blue-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>

                  {/* Expanded stop detail */}
                  {isExpanded && (
                    <div className="border-t border-white/10 px-4 py-3 space-y-2">
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Stop Details
                      </div>
                      {stops.length === 0 ? (
                        <div className="text-xs text-gray-500">No stops parsed.</div>
                      ) : (
                        stops.map((pc, idx) => {
                          const stopMeta = meta[idx];
                          const isDone = completedIndexes.includes(idx);

                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between gap-3 py-1.5 border-b border-white/5 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  isDone
                                    ? "bg-emerald-400/20 text-emerald-400"
                                    : "bg-white/10 text-gray-500"
                                }`}>
                                  {isDone ? "\u2713" : idx + 1}
                                </span>
                                <span className={`text-sm ${isDone ? "text-gray-300" : "text-gray-500"}`}>
                                  {pc}
                                </span>
                              </div>

                              <div className="text-right">
                                {stopMeta ? (
                                  <div className="text-xs">
                                    {stopMeta.arrivedISO && (
                                      <span className="text-gray-400">Arr {formatTime(stopMeta.arrivedISO)} — </span>
                                    )}
                                    <span className="text-gray-300">Left {formatTime(stopMeta.atISO)}</span>
                                    <span className="text-gray-600 ml-1.5">
                                      ({stopMeta.by === "auto" ? "auto" : "manual"})
                                    </span>
                                  </div>
                                ) : isDone ? (
                                  <span className="text-xs text-gray-500">Completed</span>
                                ) : (
                                  <span className="text-xs text-gray-600">—</span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
