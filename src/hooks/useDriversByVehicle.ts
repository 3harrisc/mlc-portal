"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normVehicle } from "@/lib/webfleet";

interface DriverProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  assigned_vehicle: string | null;
}

export type DriverByVehicle = Record<
  string,
  { name: string; email: string; id: string }
>;

/**
 * Fetches active driver profiles once and returns a map keyed by normalised
 * vehicle reg → driver display info. Use to resolve `run.vehicle` to a name
 * on the loads list, detail page, and tracking page.
 */
export function useDriversByVehicle(): {
  byVehicle: DriverByVehicle;
  loading: boolean;
} {
  const [byVehicle, setByVehicle] = useState<DriverByVehicle>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, assigned_vehicle")
        .eq("role", "driver")
        .eq("active", true);
      if (cancelled) return;
      const map: DriverByVehicle = {};
      for (const row of (data ?? []) as DriverProfileRow[]) {
        const reg = normVehicle(row.assigned_vehicle ?? "");
        if (!reg) continue;
        map[reg] = {
          name: row.full_name?.trim() || row.email,
          email: row.email,
          id: row.id,
        };
      }
      setByVehicle(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { byVehicle, loading };
}

export function lookupDriver(
  byVehicle: DriverByVehicle,
  vehicleReg: string,
): { name: string; email: string; id: string } | null {
  const reg = normVehicle(vehicleReg);
  return byVehicle[reg] ?? null;
}
