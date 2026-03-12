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

    // Also fetch cross-day backloads where collection_date is today/yesterday
    const { data: runs, error: runsErr } = await sb
      .from("runs")
      .select("*")
      .or(`date.in.(${today},${yesterday}),collection_date.in.(${today},${yesterday})`)
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
      // Skip vehicles with no tracker — these are manually managed
      if (normVehicle(r.vehicle) === "NOTRACKER") return false;
      if (r.date === today) return true;
      // Cross-day backload: collection is today — keep for collection tracking
      if (r.collection_date === today) return true;
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
      // Include fromPostcode for backload collection tracking
      if (run.run_type === "backload" && run.from_postcode) {
        allPostcodes.add(normalizePostcode(run.from_postcode));
      }
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

    // 4. For chained runs (same vehicle + date), only track the first incomplete run.
    //    This prevents auto-completing a later run when it shares a stop postcode
    //    with an earlier run (e.g. two Tamworth loads on the same vehicle).
    const skippedRunIds = new Set<string>();
    // Runs that are NOT first on their vehicle+date chain — need departure gate
    const chainedNonFirstIds = new Set<string>();
    {
      // Group runs by vehicle + date
      const groups = new Map<string, typeof activeRuns>();
      for (const run of activeRuns) {
        const key = `${normVehicle(run.vehicle)}|${run.date}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(run);
      }
      for (const [, group] of groups) {
        if (group.length < 2) continue;
        // Sort by run_order (nulls last), then by start_time
        group.sort((a: any, b: any) => {
          const oa = a.run_order ?? 999;
          const ob = b.run_order ?? 999;
          if (oa !== ob) return oa - ob;
          return (a.start_time || "").localeCompare(b.start_time || "");
        });
        // Mark all non-first runs as chained
        for (let i = 1; i < group.length; i++) {
          chainedNonFirstIds.add(group[i].id);
        }
        // Find the first run that still has uncompleted stops
        let foundActive = false;
        for (const run of group) {
          const stops = runStopsMap.get(run.id) ?? [];
          const completed = run.completed_stop_indexes ?? [];
          const isComplete = stops.length > 0 && completed.length >= stops.length;
          if (!isComplete && !foundActive) {
            foundActive = true; // This is the active run — allow tracking
          } else if (!isComplete && foundActive) {
            skippedRunIds.add(run.id); // Later incomplete run — skip tracking
          }
        }
      }
    }

    // 5. Run progress engine for each run
    let updated = 0;
    const results: { runId: string; vehicle: string; status: string }[] = [];

    for (const run of activeRuns) {
      // Skip runs waiting for a prior chained run to finish
      if (skippedRunIds.has(run.id)) {
        results.push({ runId: run.id, vehicle: run.vehicle, status: "waiting_for_prior_run" });
        continue;
      }
      try {
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

      const vehicleLL: LngLat = { lng: pos.lng, lat: pos.lat };
      const nowMs = Date.now();

      // ── Backload collection tracking (at fromPostcode) ──
      // Keep tracking until both collected AND departed (need to detect departure)
      if (run.run_type === "backload" && (!p.collected || !p.collectDepartedISO)) {
        const collPc = normalizePostcode(run.from_postcode ?? "");
        const collLL = collPc ? coordsMap.get(collPc) : null;

        if (collLL) {
          const collDist = haversineMeters(vehicleLL, collLL);
          const nearCollection = collDist <= COMPLETION_RADIUS_METERS;

          if (nearCollection) {
            if (p.collectArrivedMs == null) {
              p.collectArrivedMs = nowMs;
            }
            // Mark collected after dwell threshold
            if (minutesBetween(p.collectArrivedMs, nowMs) >= MIN_STANDSTILL_MINS) {
              p.collected = true;
              // Don't stamp departure yet — wait until vehicle leaves
            }
          } else if (p.collectArrivedMs != null) {
            // Vehicle has left the collection point
            if (minutesBetween(p.collectArrivedMs, nowMs) >= MIN_STANDSTILL_MINS) {
              p.collected = true;
            }
            if (p.collected && !p.collectDepartedISO) {
              p.collectDepartedISO = new Date().toISOString();
            }
          }
        }
      }

      // ── Find ALL uncompleted stops and check proximity to each ──
      const uncompletedIdxs: number[] = [];
      for (let i = 0; i < stops.length; i++) {
        if (!p.completedIdx.includes(i)) uncompletedIdxs.push(i);
      }

      // All stops completed — but check if we still need to detect departure
      // from the last completed stop
      if (!uncompletedIdxs.length) {
        if (p.onSiteIdx != null) {
          const trackedPc = normalizePostcode(stops[p.onSiteIdx]);
          const trackedLL = coordsMap.get(trackedPc);
          const nearTracked = trackedLL
            ? haversineMeters(vehicleLL, trackedLL) <= COMPLETION_RADIUS_METERS
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

        // Patch any completed stops still missing atISO (e.g. client cleared
        // onSiteIdx on departure but didn't write completedMeta)
        const allDoneMeta: Record<number, any> = { ...(run.completed_meta ?? {}) };
        let allDonePatched = false;
        for (const idx of (run.completed_stop_indexes ?? [])) {
          const entry = allDoneMeta[idx];
          if (entry && !entry.atISO) {
            allDoneMeta[idx] = { ...entry, atISO: new Date().toISOString() };
            allDonePatched = true;
          }
          if (!entry) {
            allDoneMeta[idx] = { by: "auto" as const, atISO: new Date().toISOString() };
            allDonePatched = true;
          }
        }
        if (allDonePatched) {
          await sb.from("runs").update({ completed_meta: allDoneMeta }).eq("id", run.id);
          updated++;
          results.push({ runId: run.id, vehicle: run.vehicle, status: "patched_departure_times" });
        } else {
          results.push({ runId: run.id, vehicle: run.vehicle, status: "all_done" });
        }
        continue;
      }

      // Find the closest uncompleted stop the vehicle is inside
      let insideIdx: number | null = null;
      let insideDist = Infinity;
      for (const idx of uncompletedIdxs) {
        const pc = normalizePostcode(stops[idx]);
        const ll = coordsMap.get(pc);
        if (!ll) continue;
        const dist = haversineMeters(vehicleLL, ll);
        if (dist <= COMPLETION_RADIUS_METERS && dist < insideDist) {
          insideIdx = idx;
          insideDist = dist;
        }
      }

      let inside = insideIdx != null;
      // The target stop index: whichever uncompleted stop we're near, or the first uncompleted
      const nsi = insideIdx ?? uncompletedIdxs[0];

      // ── Chained run departure gate ──
      // For non-first runs on a vehicle+date chain: require the vehicle to
      // leave all stop radii before tracking begins. This prevents run 2
      // from auto-completing at the same postcode as run 1 (e.g. two
      // Tamworth loads — vehicle must return to Newark for trailer 2 first).
      if (chainedNonFirstIds.has(run.id)) {
        if (p.pendingDeparture == null) {
          // First time this run is processed — determine initial state
          p.pendingDeparture = inside; // true if vehicle is already at a stop
        }
        if (p.pendingDeparture) {
          if (!inside) {
            // Vehicle has left all stop radii — clear the gate
            p.pendingDeparture = false;
          } else {
            // Still at a stop from the previous run — skip tracking this cycle
            p.lastInside = true;

            // Still persist the pendingDeparture flag
            const { error: pdErr } = await sb
              .from("runs")
              .update({ progress: p })
              .eq("id", run.id);
            if (!pdErr) updated++;
            results.push({ runId: run.id, vehicle: run.vehicle, status: "pending_departure" });
            continue;
          }
        }
      }

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

      // 2. Handle the target stop (closest uncompleted stop within radius, or first uncompleted)
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
        // Vehicle is NOT inside any uncompleted stop's radius
        if (p.onSiteIdx != null && uncompletedIdxs.includes(p.onSiteIdx)) {
          // Was tracking an uncompleted stop, now left
          const trackedIdx = p.onSiteIdx;
          const arrivedMs = p.onSiteSinceMs;
          if (
            arrivedMs != null &&
            minutesBetween(arrivedMs, nowMs) >= MIN_STANDSTILL_MINS
          ) {
            if (!p.completedIdx.includes(trackedIdx)) p.completedIdx.push(trackedIdx);
            p.completedIdx.sort((a, b) => a - b);
          }

          if (p.completedIdx.includes(trackedIdx)) {
            departureIdx = trackedIdx;
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
      } catch (runErr: unknown) {
        const msg = runErr instanceof Error ? runErr.message : String(runErr);
        console.error(`[update-progress] Error processing run ${run.id}:`, msg);
        results.push({ runId: run.id, vehicle: run.vehicle, status: `error: ${msg}` });
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
