"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normVehicle } from "@/lib/webfleet";

export interface VehiclePosition {
  vehicle: string; // normalised reg
  lat: number;
  lng: number;
  speedKph: number | null;
  heading: number | null;
  posTime: string | null; // raw timestamp from Webfleet
  collectedAt: string; // ISO when collector ran
}

const REFRESH_MS = 30_000; // poll every 30s — collector runs every ~2 min

/**
 * Fetches the latest position for every vehicle from `vehicle_positions`.
 * Polls every 30 seconds. Returns a map keyed by normalised reg.
 */
export function useVehiclePositions(): {
  positions: Record<string, VehiclePosition>;
  loading: boolean;
} {
  const [positions, setPositions] = useState<Record<string, VehiclePosition>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("vehicle_positions")
        .select("vehicle, lat, lng, speed_kph, heading, pos_time, collected_at");
      if (cancelled) return;
      const map: Record<string, VehiclePosition> = {};
      for (const row of (data ?? []) as Array<{
        vehicle: string;
        lat: number;
        lng: number;
        speed_kph: number | null;
        heading: number | null;
        pos_time: string | null;
        collected_at: string;
      }>) {
        const reg = normVehicle(row.vehicle);
        if (!reg) continue;
        map[reg] = {
          vehicle: reg,
          lat: row.lat,
          lng: row.lng,
          speedKph: row.speed_kph,
          heading: row.heading,
          posTime: row.pos_time,
          collectedAt: row.collected_at,
        };
      }
      setPositions(map);
      setLoading(false);
    };

    void load();
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return { positions, loading };
}

/**
 * Approximate UK lat/lng → (x%, y%) projection for the placeholder map.
 * Works on a UK-wide bounding box. Real Mapbox lands in phase 4.
 */
export function projectToMap(
  lat: number,
  lng: number,
): { xPct: number; yPct: number } {
  const xPct = clamp(((lng - -6) / 8) * 100, 0, 100);
  const yPct = clamp(((58 - lat) / 8) * 100, 0, 100);
  return { xPct, yPct };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
