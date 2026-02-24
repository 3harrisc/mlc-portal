import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normVehicle } from "@/lib/webfleet";
import type { ProgressState } from "@/types/runs";
import { COMPLETION_RADIUS_METERS, MIN_STANDSTILL_MINS } from "@/lib/constants";
import { normalizePostcode, parseStops } from "@/lib/postcode-utils";
import { haversineMeters, nextStopIndex, minutesBetween, type LngLat } from "@/lib/geo-utils";

const DEFAULT_PROGRESS: ProgressState = {
  completedIdx: [],
  onSiteIdx: null,
  onSiteSinceMs: null,
  lastInside: false,
};

// ── Geocoding with Supabase cache ────────────────────────────────────

async function geocodePostcodes(
  postcodes: string[]
): Promise<Map<string, LngLat>> {
  const sb = getSupabaseAdmin();
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const coordsMap = new Map<string, LngLat>();

  if (!postcodes.length) return coordsMap;

  // 1. Batch-fetch cached coords
  const normalized = [...new Set(postcodes.map(normalizePostcode))];
  const { data: cached } = await sb
    .from("postcode_coords")
    .select("postcode, lat, lng")
    .in("postcode", normalized);

  for (const row of cached ?? []) {
    coordsMap.set(row.postcode, { lat: row.lat, lng: row.lng });
  }

  // 2. Geocode any misses via Mapbox
  const missing = normalized.filter((pc) => !coordsMap.has(pc));

  if (missing.length && mapboxToken) {
    const toInsert: { postcode: string; lat: number; lng: number }[] = [];

    for (const pc of missing) {
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          pc
        )}.json?access_token=${encodeURIComponent(
          mapboxToken
        )}&country=gb&types=postcode&limit=1`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        const c = data?.features?.[0]?.center;
        if (!c) continue;

        const ll: LngLat = { lng: c[0], lat: c[1] };
        coordsMap.set(pc, ll);
        toInsert.push({ postcode: pc, lat: ll.lat, lng: ll.lng });
      } catch {
        // skip this postcode
      }
    }

    // 3. Persist new geocodes to cache
    if (toInsert.length) {
      await sb
        .from("postcode_coords")
        .upsert(toInsert, { onConflict: "postcode" });
    }
  }

  return coordsMap;
}

// ── Main handler ─────────────────────────────────────────────────────

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startMs = Date.now();
  const sb = getSupabaseAdmin();

  try {
    // 1. Fetch runs that need tracking: today's runs + yesterday's incomplete runs
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

    const { data: runs, error: runsErr } = await sb
      .from("runs")
      .select("*")
      .in("date", [today, yesterday])
      .neq("vehicle", "");

    if (runsErr) {
      console.error("[update-progress] runs query error:", runsErr);
      return NextResponse.json(
        { ok: false, error: runsErr.message },
        { status: 500 }
      );
    }

    if (!runs?.length) {
      return NextResponse.json({
        ok: true,
        message: "No active runs",
        updated: 0,
        durationMs: Date.now() - startMs,
      });
    }

    // Filter out yesterday's runs that are already fully complete
    const activeRuns = runs.filter((r: any) => {
      if (r.date === today) return true;
      // Yesterday's run — only keep if it has uncompleted stops
      const stops = parseStops(r.raw_text ?? "");
      const completed = r.completed_stop_indexes ?? [];
      return stops.length > 0 && completed.length < stops.length;
    });

    if (!activeRuns.length) {
      return NextResponse.json({
        ok: true,
        message: "No active runs",
        updated: 0,
        durationMs: Date.now() - startMs,
      });
    }

    // 2. Collect all unique postcodes across all runs & geocode in one batch
    const allPostcodes = new Set<string>();
    const runStopsMap = new Map<string, string[]>();

    for (const run of activeRuns) {
      const stops = parseStops(run.raw_text ?? "");
      runStopsMap.set(run.id, stops);
      for (const pc of stops) allPostcodes.add(normalizePostcode(pc));
    }

    const coordsMap = await geocodePostcodes([...allPostcodes]);

    // 3. Fetch all vehicle positions we need (batch)
    const vehicleNames = [
      ...new Set(
        activeRuns
          .map((r: any) => normVehicle(r.vehicle))
          .filter(Boolean)
      ),
    ];

    const { data: positions } = await sb
      .from("vehicle_positions")
      .select("vehicle, lat, lng, speed_kph, heading, pos_time, collected_at")
      .in("vehicle", vehicleNames);

    const posMap = new Map<string, (typeof positions extends (infer T)[] | null ? T : never)>();
    for (const pos of positions ?? []) {
      posMap.set(pos.vehicle, pos);
    }

    // 4. Run progress engine for each run
    let updated = 0;
    const results: { runId: string; vehicle: string; status: string }[] = [];

    for (const run of activeRuns) {
      const stops = runStopsMap.get(run.id) ?? [];
      if (!stops.length) {
        results.push({ runId: run.id, vehicle: run.vehicle, status: "no_stops" });
        continue;
      }

      const vehKey = normVehicle(run.vehicle);
      const pos = posMap.get(vehKey);
      if (!pos) {
        results.push({ runId: run.id, vehicle: run.vehicle, status: "no_position" });
        continue;
      }

      const current: ProgressState = run.progress ?? { ...DEFAULT_PROGRESS };
      const p: ProgressState = {
        ...current,
        completedIdx: [...(current.completedIdx ?? [])],
      };

      const nsi = nextStopIndex(stops, p.completedIdx);

      // All stops completed — but check if we still need to detect departure
      // from the last completed stop
      if (nsi == null) {
        if (p.onSiteIdx != null) {
          const trackedPc = normalizePostcode(stops[p.onSiteIdx]);
          const trackedLL = coordsMap.get(trackedPc);
          const vehicleLLCheck: LngLat = { lng: pos.lng, lat: pos.lat };
          const nearTracked = trackedLL
            ? haversineMeters(vehicleLLCheck, trackedLL) <= COMPLETION_RADIUS_METERS
            : false;

          if (!nearTracked) {
            const existingMeta: Record<number, any> = run.completed_meta ?? {};
            const mergedMeta = { ...existingMeta };
            if (mergedMeta[p.onSiteIdx]) {
              mergedMeta[p.onSiteIdx] = {
                ...mergedMeta[p.onSiteIdx],
                atISO: new Date().toISOString(),
              };
            }
            p.onSiteIdx = null;
            p.onSiteSinceMs = null;

            await sb.from("runs").update({
              progress: p,
              completed_meta: mergedMeta,
            }).eq("id", run.id);

            updated++;
            results.push({ runId: run.id, vehicle: run.vehicle, status: "departure_stamped" });
            continue;
          }
        }

        results.push({ runId: run.id, vehicle: run.vehicle, status: "all_done" });
        continue;
      }

      const nextPc = normalizePostcode(stops[nsi]);
      const nextLL = coordsMap.get(nextPc);
      if (!nextLL) {
        results.push({ runId: run.id, vehicle: run.vehicle, status: "no_coords" });
        continue;
      }

      const vehicleLL: LngLat = { lng: pos.lng, lat: pos.lat };
      const distM = haversineMeters(vehicleLL, nextLL);
      const inside = distM <= COMPLETION_RADIUS_METERS;
      const nowMs = Date.now();

      // ── Proximity / dwell logic ──
      // Completion = within radius for >= MIN_STANDSTILL_MINS (speed irrelevant).
      // atISO (departure time) stamped only when vehicle actually leaves the radius.

      let departureIdx: number | null = null;
      let departureArrivedMs: number | null = null;

      // 1. If we're tracking a completed stop (onSiteIdx differs from nsi
      //    because nsi has advanced), check if vehicle is still near it.
      if (p.onSiteIdx != null && p.onSiteIdx !== nsi) {
        const trackedPc = normalizePostcode(stops[p.onSiteIdx]);
        const trackedLL = coordsMap.get(trackedPc);
        const nearTracked = trackedLL
          ? haversineMeters(vehicleLL, trackedLL) <= COMPLETION_RADIUS_METERS
          : false;

        if (!nearTracked) {
          // Vehicle has left the completed stop
          if (p.completedIdx.includes(p.onSiteIdx)) {
            departureIdx = p.onSiteIdx;
            departureArrivedMs = p.onSiteSinceMs;
          }
          p.onSiteIdx = null;
          p.onSiteSinceMs = null;
        }
        // else: still near the completed stop — keep tracking
      }

      // 2. Handle the next uncompleted stop
      if (inside) {
        if (p.onSiteIdx !== nsi) {
          // Just arrived at this stop
          p.onSiteIdx = nsi;
          p.onSiteSinceMs = nowMs;
        }
        // onSiteSinceMs never resets while inside (no speed check)
        p.lastInside = true;

        // Auto-complete if in radius for >= threshold
        if (
          p.onSiteSinceMs != null &&
          minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS
        ) {
          if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
          p.completedIdx.sort((a, b) => a - b);
        }
      } else {
        // Vehicle is NOT inside the next stop's radius
        if (p.onSiteIdx === nsi) {
          // Was tracking this stop, now left
          const arrivedMs = p.onSiteSinceMs;
          if (
            arrivedMs != null &&
            minutesBetween(arrivedMs, nowMs) >= MIN_STANDSTILL_MINS
          ) {
            if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
            p.completedIdx.sort((a, b) => a - b);
          }

          if (p.completedIdx.includes(nsi)) {
            departureIdx = nsi;
            departureArrivedMs = arrivedMs;
          }

          p.onSiteIdx = null;
          p.onSiteSinceMs = null;
        }

        p.lastInside = false;
      }

      // ── Build update payload ──
      const updateRow: Record<string, any> = { progress: p };

      // Sync completed_stop_indexes & completed_meta
      const existingCompleted: number[] =
        run.completed_stop_indexes ?? [];
      const existingMeta: Record<
        number,
        { atISO?: string; by: "auto" | "admin"; arrivedISO?: string }
      > = run.completed_meta ?? {};

      const newlyCompleted = p.completedIdx.filter(
        (idx) => !existingCompleted.includes(idx)
      );

      if (newlyCompleted.length || departureIdx != null) {
        const mergedCompleted = [
          ...new Set([...existingCompleted, ...p.completedIdx]),
        ].sort((a, b) => a - b);

        const mergedMeta = { ...existingMeta };

        // Record arrival for newly completed stops (no atISO yet — set on departure)
        for (const idx of newlyCompleted) {
          const arrivedMs =
            idx === departureIdx ? departureArrivedMs : p.onSiteSinceMs;
          mergedMeta[idx] = {
            by: "auto",
            arrivedISO: arrivedMs
              ? new Date(arrivedMs).toISOString()
              : new Date().toISOString(),
          };
        }

        // Stamp actual departure time
        if (departureIdx != null && mergedMeta[departureIdx]) {
          mergedMeta[departureIdx] = {
            ...mergedMeta[departureIdx],
            atISO: new Date().toISOString(),
          };
        }

        updateRow.completed_stop_indexes = mergedCompleted;
        updateRow.completed_meta = mergedMeta;
      }

      // ── Fallback: patch completed stops with missing atISO ──
      // The client-side progress engine can clear onSiteIdx (detecting
      // departure) but doesn't write completed_meta. This leaves stops
      // with arrivedISO but no atISO. Patch them here.
      {
        const metaToCheck: Record<number, any> =
          updateRow.completed_meta ?? existingMeta;
        const completedToCheck: number[] =
          updateRow.completed_stop_indexes ?? existingCompleted;
        let patched = false;
        const patchedMeta = { ...metaToCheck };

        for (const idx of completedToCheck) {
          const entry = patchedMeta[idx];
          // Stop is completed but has no departure time, and we're not
          // actively tracking it for departure
          if (entry && !entry.atISO && p.onSiteIdx !== idx) {
            patchedMeta[idx] = {
              ...entry,
              atISO: new Date().toISOString(),
            };
            patched = true;
          }
          // Stop is completed but has no meta at all
          if (!entry && p.onSiteIdx !== idx) {
            patchedMeta[idx] = {
              by: "auto" as const,
              atISO: new Date().toISOString(),
            };
            patched = true;
          }
        }

        if (patched) {
          updateRow.completed_meta = patchedMeta;
          if (!updateRow.completed_stop_indexes) {
            updateRow.completed_stop_indexes = completedToCheck;
          }
        }
      }

      // ── Write to Supabase ──
      const { error: updateErr } = await sb
        .from("runs")
        .update(updateRow)
        .eq("id", run.id);

      if (updateErr) {
        console.error(
          `[update-progress] update error for run ${run.id}:`,
          updateErr
        );
        results.push({
          runId: run.id,
          vehicle: run.vehicle,
          status: `error: ${updateErr.message}`,
        });
      } else {
        updated++;
        results.push({
          runId: run.id,
          vehicle: run.vehicle,
          status: newlyCompleted.length
            ? `completed_stops: [${newlyCompleted.join(",")}]`
            : "updated",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      updated,
      total: activeRuns.length,
      geocodedPostcodes: coordsMap.size,
      results,
      durationMs: Date.now() - startMs,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[update-progress] Unexpected error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
