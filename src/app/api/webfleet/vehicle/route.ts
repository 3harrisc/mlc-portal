import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { normVehicle } from "@/lib/webfleet";

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
        timestamp: fuzzyData.pos_time || fuzzyData.collected_at || undefined,
        cachedAt: fuzzyData.collected_at,
      });
    }

    return NextResponse.json({
      vehicle: data.vehicle,
      lat: data.lat,
      lng: data.lng,
      speedKph: data.speed_kph ?? undefined,
      heading: data.heading ?? undefined,
      timestamp: data.pos_time || data.collected_at || undefined,
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
