"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PlannedRun } from "@/types/runs";
import { rowToRun } from "@/types/runs";
import { todayISO } from "@/lib/time-utils";
import { parseStops } from "@/lib/postcode-utils";

type DriverInfo = {
  id: string;
  email: string;
  full_name: string | null;
  assigned_vehicle: string | null;
};

type DriverStatus = {
  driver: DriverInfo;
  run: PlannedRun | null;
  stops: string[];
  completedCount: number;
  totalStops: number;
  currentStopIdx: number | null;
  status: "no_vehicle" | "no_run" | "not_started" | "in_progress" | "complete";
};

function getStatus(ds: DriverStatus): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
} {
  switch (ds.status) {
    case "complete":
      return {
        label: "COMPLETE",
        color: "text-emerald-400",
        bgColor: "bg-emerald-500/5",
        borderColor: "border-emerald-500/40",
      };
    case "in_progress":
      return {
        label: `${ds.completedCount}/${ds.totalStops} STOPS`,
        color: "text-blue-400",
        bgColor: "bg-blue-500/5",
        borderColor: "border-blue-500/40",
      };
    case "not_started":
      return {
        label: "NOT STARTED",
        color: "text-gray-400",
        bgColor: "bg-white/5",
        borderColor: "border-white/10",
      };
    case "no_run":
      return {
        label: "NO RUN TODAY",
        color: "text-yellow-400",
        bgColor: "bg-yellow-500/5",
        borderColor: "border-yellow-500/30",
      };
    case "no_vehicle":
      return {
        label: "NO VEHICLE",
        color: "text-red-400",
        bgColor: "bg-red-500/5",
        borderColor: "border-red-500/30",
      };
  }
}

export default function AdminDriversPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [driverStatuses, setDriverStatuses] = useState<DriverStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, profile, router]);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();
    const today = todayISO();

    // Fetch all drivers
    const { data: drivers } = await supabase
      .from("profiles")
      .select("id, email, full_name, assigned_vehicle")
      .eq("role", "driver")
      .eq("active", true)
      .order("email");

    // Fetch today's runs
    const { data: runsData } = await supabase
      .from("runs")
      .select("*")
      .eq("date", today);

    const runs = (runsData ?? []).map(rowToRun);

    // Build driver status list
    const statuses: DriverStatus[] = (drivers ?? []).map((driver) => {
      if (!driver.assigned_vehicle?.trim()) {
        return {
          driver,
          run: null,
          stops: [],
          completedCount: 0,
          totalStops: 0,
          currentStopIdx: null,
          status: "no_vehicle" as const,
        };
      }

      const matchedRun = runs.find(
        (r) =>
          r.vehicle.trim().toUpperCase() ===
          driver.assigned_vehicle!.trim().toUpperCase()
      );

      if (!matchedRun) {
        return {
          driver,
          run: null,
          stops: [],
          completedCount: 0,
          totalStops: 0,
          currentStopIdx: null,
          status: "no_run" as const,
        };
      }

      const stops = parseStops(matchedRun.rawText);
      const completedCount = Math.max(
        (matchedRun.completedStopIndexes ?? []).length,
        (matchedRun.progress?.completedIdx ?? []).length
      );
      const currentStopIdx = matchedRun.progress?.onSiteIdx ?? null;
      const isComplete = stops.length > 0 && completedCount >= stops.length;

      let status: DriverStatus["status"];
      if (isComplete) {
        status = "complete";
      } else if (completedCount > 0 || currentStopIdx != null) {
        status = "in_progress";
      } else {
        status = "not_started";
      }

      return {
        driver,
        run: matchedRun,
        stops,
        completedCount,
        totalStops: stops.length,
        currentStopIdx,
        status,
      };
    });

    setDriverStatuses(statuses);
    setLastRefresh(new Date());
    setLoading(false);
  }

  useEffect(() => {
    if (profile?.role === "admin") {
      loadData();
      const timer = setInterval(loadData, 60_000);
      return () => clearInterval(timer);
    }
  }, [profile]);

  // Summary counts
  const summary = useMemo(() => {
    const total = driverStatuses.length;
    const complete = driverStatuses.filter((d) => d.status === "complete").length;
    const inProgress = driverStatuses.filter((d) => d.status === "in_progress").length;
    const notStarted = driverStatuses.filter((d) => d.status === "not_started").length;
    const noRun = driverStatuses.filter((d) => d.status === "no_run").length;
    const noVehicle = driverStatuses.filter((d) => d.status === "no_vehicle").length;
    return { total, complete, inProgress, notStarted, noRun, noVehicle };
  }, [driverStatuses]);

  if (authLoading || profile?.role !== "admin") {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navigation />
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-xl md:text-3xl font-bold">Driver Overview</h1>
            <p className="text-sm text-gray-400 mt-1">
              {todayISO()} &mdash; {summary.total} driver{summary.total !== 1 ? "s" : ""}
              {lastRefresh && (
                <span className="ml-2 text-gray-600">
                  Updated {lastRefresh.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="border border-blue-500/30 bg-blue-500/5 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{summary.inProgress}</div>
            <div className="text-xs text-gray-400 mt-1">In Progress</div>
          </div>
          <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-emerald-400">{summary.complete}</div>
            <div className="text-xs text-gray-400 mt-1">Complete</div>
          </div>
          <div className="border border-white/10 bg-white/5 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-gray-400">{summary.notStarted}</div>
            <div className="text-xs text-gray-400 mt-1">Not Started</div>
          </div>
          <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-yellow-400">{summary.noRun}</div>
            <div className="text-xs text-gray-400 mt-1">No Run</div>
          </div>
          <div className="border border-red-500/30 bg-red-500/5 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{summary.noVehicle}</div>
            <div className="text-xs text-gray-400 mt-1">No Vehicle</div>
          </div>
        </div>

        {/* Driver list */}
        {loading && driverStatuses.length === 0 ? (
          <p className="text-gray-400">Loading drivers...</p>
        ) : driverStatuses.length === 0 ? (
          <div className="text-gray-400 py-8 text-center">
            No active drivers found. Add driver users in{" "}
            <Link href="/admin/users" className="text-blue-400 underline">
              User Management
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-3">
            {driverStatuses.map((ds) => {
              const st = getStatus(ds);
              return (
                <div
                  key={ds.driver.id}
                  className={`border ${st.borderColor} ${st.bgColor} rounded-xl p-4`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">
                          {ds.driver.full_name || ds.driver.email}
                        </span>
                        {ds.driver.assigned_vehicle && (
                          <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/10 text-gray-300">
                            {ds.driver.assigned_vehicle}
                          </span>
                        )}
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${st.color} bg-black/20`}
                        >
                          {st.label}
                        </span>
                      </div>

                      {ds.run && (
                        <div className="text-xs text-gray-400 mt-1.5">
                          <span className="font-medium text-gray-300">
                            {ds.run.jobNumber}
                          </span>
                          <span className="mx-1.5">&middot;</span>
                          {ds.run.customer}
                          <span className="mx-1.5">&middot;</span>
                          {ds.totalStops} stop{ds.totalStops !== 1 ? "s" : ""}
                          {ds.status === "in_progress" && (
                            <>
                              <span className="mx-1.5">&middot;</span>
                              <span className="text-blue-400">
                                {ds.totalStops - ds.completedCount} remaining
                              </span>
                            </>
                          )}
                        </div>
                      )}

                      {/* Progress bar */}
                      {ds.run && ds.totalStops > 0 && (
                        <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden w-full max-w-xs">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              ds.status === "complete"
                                ? "bg-emerald-500"
                                : "bg-blue-500"
                            }`}
                            style={{
                              width: `${Math.round(
                                (ds.completedCount / ds.totalStops) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      )}

                      {/* Current stop info */}
                      {ds.currentStopIdx != null && ds.stops[ds.currentStopIdx] && (
                        <div className="text-xs text-yellow-400 mt-1">
                          On site at stop {ds.currentStopIdx + 1}: {ds.stops[ds.currentStopIdx]}
                        </div>
                      )}
                    </div>

                    {ds.run && (
                      <Link
                        href={`/runs/${ds.run.id}`}
                        className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors shrink-0"
                      >
                        View Run
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
