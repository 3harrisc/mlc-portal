"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizePostcode } from "@/lib/postcode-utils";

export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * Resolve a list of postcodes to lat/lng using the existing `postcode_coords`
 * cache table. Postcodes that aren't cached are silently skipped; the
 * /api/cron/update-progress and /plan-route flows backfill the cache.
 */
export function usePostcodeCoords(postcodes: string[]): {
  coords: Record<string, LngLat>;
  loading: boolean;
} {
  const key = useMemo(
    () =>
      Array.from(
        new Set(
          postcodes
            .map((p) => normalizePostcode(p ?? ""))
            .filter(Boolean),
        ),
      )
        .sort()
        .join("|"),
    [postcodes],
  );
  const [coords, setCoords] = useState<Record<string, LngLat>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!key) return;
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const list = key.split("|");
      const { data } = await supabase
        .from("postcode_coords")
        .select("postcode, lat, lng")
        .in("postcode", list);
      if (cancelled) return;
      const map: Record<string, LngLat> = {};
      for (const row of (data ?? []) as Array<{
        postcode: string;
        lat: number;
        lng: number;
      }>) {
        map[normalizePostcode(row.postcode)] = { lat: row.lat, lng: row.lng };
      }
      setCoords(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  // No postcodes to fetch — surface the empty state synchronously in render.
  if (!key && (loading || Object.keys(coords).length > 0)) {
    return { coords: {}, loading: false };
  }
  return { coords, loading };
}
