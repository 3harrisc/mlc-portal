"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useScopedRuns } from "@/hooks/useScopedRuns";
import { todayISO } from "@/lib/time-utils";
import type { PlannedRun } from "@/types/runs";
import { deriveStatus } from "@/lib/portal/loads";
import type { LoadStatus } from "./StatusPill";

interface EnrichedRun {
  run: PlannedRun;
  status: LoadStatus;
}

interface PortalCounts {
  loads: number;
  tracking: number;
  exceptions: number;
  deliveredToday: number;
  bookedToday: number;
}

interface PortalDataValue {
  runs: PlannedRun[];
  enriched: EnrichedRun[];
  counts: PortalCounts;
  loading: boolean;
  /** Force a re-fetch of runs without a full page reload. */
  refetch: () => void;
}

const PortalDataContext = createContext<PortalDataValue>({
  runs: [],
  enriched: [],
  counts: { loads: 0, tracking: 0, exceptions: 0, deliveredToday: 0, bookedToday: 0 },
  loading: true,
  refetch: () => {},
});

/**
 * Drops historical/imported rows from the customer-facing loads view.
 *
 * Legs imported from the legacy Excel planner all carry IDs prefixed with
 * `legacy-`. They are useful for invoicing reconciliation but not for the
 * customer tracking UI — there's no live vehicle, no reference to track, etc.
 */
function isLiveRun(r: PlannedRun): boolean {
  return !r.id.startsWith("legacy-");
}

/**
 * Provides scoped runs + derived counts to the portal shell.
 * Single fetch per page; sidebar, dashboard, loads, tracking, etc. all consume.
 */
export function PortalDataProvider({ children }: { children: ReactNode }) {
  const { runs: allRuns, loading, refetch } = useScopedRuns();
  const today = todayISO();

  const value = useMemo<PortalDataValue>(() => {
    // Customers track live runs only — historical Excel imports are out of scope.
    const runs = allRuns.filter(isLiveRun);
    const enriched: EnrichedRun[] = runs.map((r) => ({
      run: r,
      status: deriveStatus(r, today),
    }));
    const tracking = enriched.filter(
      (r) =>
        r.status === "in-transit" ||
        r.status === "loading" ||
        r.status === "delayed" ||
        r.status === "exception",
    ).length;
    const exceptions = enriched.filter((r) => r.status === "exception").length;
    const deliveredToday = enriched.filter(
      (r) => r.status === "delivered" && r.run.date === today,
    ).length;
    const bookedToday = enriched.filter((r) => r.run.date === today).length;
    return {
      runs,
      enriched,
      counts: {
        loads: runs.length,
        tracking,
        exceptions,
        deliveredToday,
        bookedToday,
      },
      loading,
      refetch,
    };
  }, [allRuns, loading, today, refetch]);

  return (
    <PortalDataContext.Provider value={value}>
      {children}
    </PortalDataContext.Provider>
  );
}

export function usePortalData(): PortalDataValue {
  return useContext(PortalDataContext);
}
