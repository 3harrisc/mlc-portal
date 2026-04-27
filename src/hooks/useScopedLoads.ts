"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { rowToRun, type PlannedRun } from "@/types/runs";

interface ScopedLoadsResult {
  loads: PlannedRun[];
  loading: boolean;
  error: Error | null;
  /**
   * Re-run the loads query without a full page reload — used after deletes /
   * inline-edits so the table reflects the server state without losing the
   * user's place / scroll position / unrelated UI state.
   */
  refetch: () => void;
}

/**
 * Customer-facing equivalent of useScopedRuns, but reads from the new
 * `loads` table. Customer users see only loads whose customer is in their
 * `allowed_customers`; admins see everything.
 *
 * Filtering is currently post-fetch in JS for parity with useScopedRuns —
 * replacing this with row-level security is a phase-3 follow-up.
 */
export function useScopedLoads(): ScopedLoadsResult {
  const { profile, loading: authLoading } = useAuth();
  const [loads, setLoads] = useState<PlannedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refetch = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const supabase = createClient();
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error: queryError } = await supabase
        .from("loads")
        .select("*")
        .order("date", { ascending: false });
      if (cancelled) return;
      if (queryError) {
        setError(new Error(queryError.message));
        setLoads([]);
      } else {
        setLoads((data ?? []).map(rowToRun));
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, refreshTick]);

  const isAdmin = profile?.role === "admin";
  const allowedKey = (profile?.allowed_customers ?? []).join("|");

  const scoped = useMemo(() => {
    const allowed = new Set(allowedKey ? allowedKey.split("|") : []);
    return loads.filter((r) => isAdmin || allowed.has(r.customer));
  }, [loads, isAdmin, allowedKey]);

  return { loads: scoped, loading, error, refetch };
}
