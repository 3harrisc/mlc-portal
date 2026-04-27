"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useScopedLoads } from "@/hooks/useScopedLoads";
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
 * Provides scoped loads + derived counts to the portal shell.
 *
 * Single fetch per page; sidebar, dashboard, /portal/loads, tracking, etc. all
 * consume. Reads the new `loads` table (separate from dispatch `runs`) so the
 * customer-facing UI is fully isolated from planner / invoicing rows.
 */
export function PortalDataProvider({ children }: { children: ReactNode }) {
  const { loads: runs, loading, refetch } = useScopedLoads();
  const today = todayISO();

  const value = useMemo<PortalDataValue>(() => {
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
  }, [runs, loading, today, refetch]);

  return (
    <PortalDataContext.Provider value={value}>
      {children}
    </PortalDataContext.Provider>
  );
}

export function usePortalData(): PortalDataValue {
  return useContext(PortalDataContext);
}
