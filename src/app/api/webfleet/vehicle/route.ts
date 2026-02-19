import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { normVehicle } from "@/lib/webfleet";

/** Try to parse a Webfleet pos_time string into an ISO timestamp.
 *  Webfleet may return formats like "2024-02-19 10:30:45" or "20240219103045". */
function toISOTimestamp(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const s = raw.trim();

  // Already ISO-like (has "T")
  if (s.includes("T")) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // "YYYY-MM-DD HH:MM:SS" — replace space with T
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    const d = new Date(s.replace(" ", "T") + "Z");
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // "YYYYMMDDHHmmss" compact format
  if (/^\d{14}$/.test(s)) {
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Fallback: let Date try to parse it
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  return undefined;
}

/**
 * GET /api/webfleet/vehicle?vehicle=D1MLC
 *
 * Reads the latest cached vehicle position from Supabase.
 * No direct Webfleet calls — data is populated by the collector cron.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const vehicleQuery = searchParams.get("vehicle") || "";

    if (!vehicleQuery.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing ?vehicle= parameter" },
        { status: 400 }
      );
    }

    const normalized = normVehicle(vehicleQuery);

    // Read from cached vehicle_positions table
    const { data, error } = await getSupabase()
      .from("vehicle_positions")
      .select("vehicle, lat, lng, speed_kph, heading, pos_time, collected_at")
      .eq("vehicle", normalized)
      .single();

    if (error || !data) {
      // Try a looser match (LIKE) in case of partial registrations
      const { data: fuzzyData, error: fuzzyError } = await getSupabase()
        .from("vehicle_positions")
        .select("vehicle, lat, lng, speed_kph, heading, pos_time, collected_at")
        .ilike("vehicle", `%${normalized}%`)
        .limit(1)
        .single();

      if (fuzzyError || !fuzzyData) {
        return NextResponse.json(
          {
            ok: false,
            error: "No cached position found for this vehicle. The collector may not have run yet.",
            query: normalized,
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        vehicle: fuzzyData.vehicle,
        lat: fuzzyData.lat,
        lng: fuzzyData.lng,
        speedKph: fuzzyData.speed_kph ?? undefined,
        heading: fuzzyData.heading ?? undefined,
        timestamp: toISOTimestamp(fuzzyData.pos_time) || fuzzyData.collected_at || undefined,
        cachedAt: fuzzyData.collected_at,
      });
    }

    return NextResponse.json({
      vehicle: data.vehicle,
      lat: data.lat,
      lng: data.lng,
      speedKph: data.speed_kph ?? undefined,
      heading: data.heading ?? undefined,
      timestamp: toISOTimestamp(data.pos_time) || data.collected_at || undefined,
      cachedAt: data.collected_at,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
