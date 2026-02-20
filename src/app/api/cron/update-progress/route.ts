import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normVehicle } from "@/lib/webfleet";
import type { ProgressState } from "@/types/runs";

// ── Constants (must match client-side page.tsx) ──────────────────────
const COMPLETION_RADIUS_METERS = 500;
const MIN_STANDSTILL_MINS = 3;
const STANDSTILL_SPEED_KPH = 3;

const DEFAULT_PROGRESS: ProgressState = {
  completedIdx: [],
  onSiteIdx: null,
  onSiteSinceMs: null,
  lastInside: false,
};

// ── Helpers (duplicated from page.tsx — pure functions) ──────────────

type LngLat = { lng: number; lat: number };

function normalizePostcode(input: string) {
  const s = (input || "").trim().toUpperCase();
  const noSpace = s.replace(/\s+/g, "");
  if (noSpace.length >= 5) {
    const head = noSpace.slice(0, -3);
    const tail = noSpace.slice(-3);
    return `${head} ${tail}`.trim();
  }
  return s;
}

function extractPostcode(line: string): string | null {
  const m = line
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/);
  if (!m) return null;
  return normalizePostcode(`${m[1]} ${m[2]}`);
}

function parseStops(rawText: string): string[] {
  const lines = (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    const pc = extractPostcode(line);
    if (pc) out.push(pc);
  }
  return out;
}

function haversineMeters(a: LngLat, b: LngLat) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(la1) * Math.cos(la2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

function minutesBetween(aMs: number, bMs: number) {
  return Math.max(0, Math.round((bMs - aMs) / 60000));
}

function nextStopIndex(stops: string[], completedIdx: number[]) {
  for (let i = 0; i < stops.length; i++) {
    if (!completedIdx.includes(i)) return i;
  }
  return null;
}

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
    // 1. Fetch today's runs that have a vehicle assigned
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const { data: runs, error: runsErr } = await sb
      .from("runs")
      .select("*")
      .eq("date", today)
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
        message: "No active runs today",
        updated: 0,
        durationMs: Date.now() - startMs,
      });
    }

    // 2. Collect all unique postcodes across all runs & geocode in one batch
    const allPostcodes = new Set<string>();
    const runStopsMap = new Map<string, string[]>();

    for (const run of runs) {
      const stops = parseStops(run.raw_text ?? "");
      runStopsMap.set(run.id, stops);
      for (const pc of stops) allPostcodes.add(normalizePostcode(pc));
    }

    const coordsMap = await geocodePostcodes([...allPostcodes]);

    // 3. Fetch all vehicle positions we need (batch)
    const vehicleNames = [
      ...new Set(
        runs
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

    for (const run of runs) {
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

      if (nsi == null) {
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
      const speedKph =
        typeof pos.speed_kph === "number" ? pos.speed_kph : undefined;
      const distM = haversineMeters(vehicleLL, nextLL);
      const inside = distM <= COMPLETION_RADIUS_METERS;
      const nowMs = Date.now();
      const stopped =
        speedKph == null ? false : speedKph <= STANDSTILL_SPEED_KPH;

      // ── Proximity / dwell logic (mirrors client) ──
      if (inside) {
        if (p.onSiteIdx !== nsi) {
          p.onSiteIdx = nsi;
          p.onSiteSinceMs = stopped ? nowMs : null;
          p.lastInside = true;
        } else {
          if (stopped) {
            if (!p.onSiteSinceMs) p.onSiteSinceMs = nowMs;
          } else {
            p.onSiteSinceMs = null;
          }
          p.lastInside = true;
        }

        // Complete while still inside if dwell threshold met
        // Keep onSiteIdx so UI still shows "ON SITE" until vehicle leaves
        if (
          p.onSiteSinceMs != null &&
          minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS
        ) {
          if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
          p.completedIdx.sort((a, b) => a - b);
        }
      } else {
        if (p.onSiteIdx === nsi && p.lastInside) {
          const hadDwell =
            p.onSiteSinceMs != null &&
            minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS;

          if (hadDwell) {
            if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
            p.completedIdx.sort((a, b) => a - b);
          }

          p.onSiteIdx = null;
          p.onSiteSinceMs = null;
        }

        // Clear stale on-site state when stop was completed while inside
        // but nextStopIndex has since advanced past it
        if (
          p.onSiteIdx != null &&
          p.completedIdx.includes(p.onSiteIdx)
        ) {
          p.onSiteIdx = null;
          p.onSiteSinceMs = null;
        }

        p.lastInside = false;
      }

      // ── Build update payload ──
      const updateRow: Record<string, any> = { progress: p };

      // Sync completed_stop_indexes & completed_meta when auto-completing
      const existingCompleted: number[] =
        run.completed_stop_indexes ?? [];
      const existingMeta: Record<
        number,
        { atISO: string; by: "auto" | "admin"; arrivedISO?: string }
      > = run.completed_meta ?? {};

      const newlyCompleted = p.completedIdx.filter(
        (idx) => !existingCompleted.includes(idx)
      );

      if (newlyCompleted.length) {
        const mergedCompleted = [
          ...new Set([...existingCompleted, ...p.completedIdx]),
        ].sort((a, b) => a - b);

        const mergedMeta = { ...existingMeta };
        for (const idx of newlyCompleted) {
          mergedMeta[idx] = {
            atISO: new Date().toISOString(),
            by: "auto",
            arrivedISO: p.onSiteSinceMs
              ? new Date(p.onSiteSinceMs).toISOString()
              : undefined,
          };
        }

        updateRow.completed_stop_indexes = mergedCompleted;
        updateRow.completed_meta = mergedMeta;
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
      total: runs.length,
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
