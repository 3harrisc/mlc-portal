"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { rowToRun, type PlannedRun } from "@/types/runs";

interface ScopedRunsResult {
  runs: PlannedRun[];
  loading: boolean;
  error: Error | null;
}

/**
 * Fetches the runs visible to the current user. Customer users see only runs
 * whose customer is in their `allowed_customers`; admins see everything.
 *
 * Note: filtering is currently post-fetch in JS (matching the existing /runs
 * page behaviour). Replacing this with row-level security is tracked as a
 * phase 3 follow-up.
 */
export function useScopedRuns(): ScopedRunsResult {
  const { profile, loading: authLoading } = useAuth();
  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (authLoading) return;
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const { data, error: queryError } = await supabase
        .from("runs")
        .select("*")
        .order("date", { ascending: false });
      if (cancelled) return;
      if (queryError) {
        setError(new Error(queryError.message));
        setRuns([]);
      } else {
        setRuns((data ?? []).map(rowToRun));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading]);

  const isAdmin = profile?.role === "admin";
  const allowedKey = (profile?.allowed_customers ?? []).join("|");

  const scoped = useMemo(() => {
    const allowed = new Set(allowedKey ? allowedKey.split("|") : []);
    return runs.filter((r) => isAdmin || allowed.has(r.customer));
  }, [runs, isAdmin, allowedKey]);

  return { runs: scoped, loading, error };
}
