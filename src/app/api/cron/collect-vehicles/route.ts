import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchAllVehiclesFromWebfleet, parseVehicleRow } from "@/lib/webfleet";

/**
 * Collector endpoint — called by Vercel Cron every 2 minutes.
 * Fetches ALL vehicles from Webfleet in a single API call,
 * then upserts each into the vehicle_positions table.
 *
 * Protected by CRON_SECRET to prevent unauthorized calls.
 */
export async function GET(req: Request) {
  // Verify cron secret to prevent public access
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startMs = Date.now();

  try {
    const { rows, error } = await fetchAllVehiclesFromWebfleet();

    if (error) {
      console.error("[collect-vehicles] Webfleet error:", error);
      return NextResponse.json({ ok: false, error }, { status: 500 });
    }

    if (!rows.length) {
      return NextResponse.json({ ok: true, message: "No vehicles returned from Webfleet", upserted: 0 });
    }

    // Parse all rows into vehicle position records, deduplicate by vehicle name
    // (Webfleet can return multiple rows for the same vehicle — keep the last one)
    const parsed = rows
      .map(parseVehicleRow)
      .filter((v): v is NonNullable<typeof v> => v !== null);

    const deduped = new Map<string, typeof parsed[number]>();
    for (const v of parsed) {
      deduped.set(v.vehicle, v); // last row wins
    }
    const vehicles = Array.from(deduped.values());

    if (!vehicles.length) {
      return NextResponse.json({ ok: true, message: "No vehicles with valid positions", upserted: 0 });
    }

    // Upsert all vehicles into vehicle_positions (one row per vehicle)
    const { error: upsertError } = await getSupabaseAdmin()
      .from("vehicle_positions")
      .upsert(
        vehicles.map((v) => ({
          vehicle: v.vehicle,
          lat: v.lat,
          lng: v.lng,
          speed_kph: v.speed_kph,
          heading: v.heading,
          pos_time: v.pos_time,
          raw: v.raw,
          collected_at: new Date().toISOString(),
        })),
        { onConflict: "vehicle" }
      );

    if (upsertError) {
      console.error("[collect-vehicles] Supabase upsert error:", upsertError);
      return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });
    }

    // Also append to history log
    const { error: logError } = await getSupabaseAdmin()
      .from("vehicle_position_log")
      .insert(
        vehicles.map((v) => ({
          vehicle: v.vehicle,
          lat: v.lat,
          lng: v.lng,
          speed_kph: v.speed_kph,
          heading: v.heading,
          pos_time: v.pos_time,
        }))
      );

    if (logError) {
      // Non-fatal: log it but don't fail the collection
      console.warn("[collect-vehicles] History log insert error:", logError.message);
    }

    const durationMs = Date.now() - startMs;

    return NextResponse.json({
      ok: true,
      upserted: vehicles.length,
      vehicleNames: vehicles.map((v) => v.vehicle),
      durationMs,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[collect-vehicles] Unexpected error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
