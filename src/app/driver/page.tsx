"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { updateRun as updateRunAction } from "@/app/actions/runs";
import { createCost, deleteCost, listDriverCosts } from "@/app/actions/costs";
import type { CostCategory } from "@/types/costs";
import { COST_CATEGORIES, rowToCost, formatPence, type Cost } from "@/types/costs";
import type { PlannedRun, ProgressState } from "@/types/runs";
import { rowToRun } from "@/types/runs";
import { normalizePostcode, parseStops } from "@/lib/postcode-utils";
import {
  haversineMeters,
  nextStopIndex,
  minutesBetween,
  type LngLat,
} from "@/lib/geo-utils";
import { todayISO } from "@/lib/time-utils";
import { useNicknames } from "@/hooks/useNicknames";
import { withNickname } from "@/lib/postcode-nicknames";
import {
  COMPLETION_RADIUS_METERS,
  MIN_STANDSTILL_MINS,
  HGV_TIME_MULTIPLIER,
  MAX_SPEED_KPH,
} from "@/lib/constants";

type VehicleSnapshot = {
  vehicle: string;
  lat: number;
  lng: number;
  speedKph?: number;
  heading?: number;
  timestamp?: string;
};

type StopStatus = "completed" | "on_site" | "pending";

const DEFAULT_PROGRESS: ProgressState = {
  completedIdx: [],
  onSiteIdx: null,
  onSiteSinceMs: null,
  lastInside: false,
};

function progressChanged(a: ProgressState, b: ProgressState): boolean {
  if (a.completedIdx.length !== b.completedIdx.length) return true;
  if (a.completedIdx.some((v, i) => v !== b.completedIdx[i])) return true;
  if (a.onSiteIdx !== b.onSiteIdx) return true;
  if (a.onSiteSinceMs !== b.onSiteSinceMs) return true;
  if (a.lastInside !== b.lastInside) return true;
  return false;
}

async function geocodePostcode(
  postcode: string,
  mapboxToken: string
): Promise<LngLat> {
  const pc = normalizePostcode(postcode);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    pc
  )}.json?access_token=${encodeURIComponent(
    mapboxToken
  )}&country=gb&types=postcode&limit=1`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Geocode failed for ${pc}`);
  const data = await res.json();
  const c = data?.features?.[0]?.center;
  if (!Array.isArray(c) || c.length < 2) throw new Error(`No match for ${pc}`);
  return { lng: c[0], lat: c[1] };
}

async function getDirectionsLeg(
  from: LngLat,
  to: LngLat,
  mapboxToken: string
): Promise<{ mins: number; km: number }> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?access_token=${encodeURIComponent(
    mapboxToken
  )}&overview=false&steps=false`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Directions failed (${res.status})`);
  const data = await res.json();
  const route = data?.routes?.[0];
  const durationSec = Number(route?.duration);
  const distanceM = Number(route?.distance);
  if (!Number.isFinite(durationSec) || !Number.isFinite(distanceM))
    throw new Error("Missing duration/distance");
  const km = Math.max(0.1, distanceM / 1000);
  const minsFromMapbox = Math.max(
    1,
    Math.round((durationSec / 60) * HGV_TIME_MULTIPLIER)
  );
  const minsBySpeedCap = Math.ceil((km / MAX_SPEED_KPH) * 60);
  return {
    mins: Math.max(minsFromMapbox, minsBySpeedCap),
    km: Math.round(km * 10) / 10,
  };
}

export default function DriverPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
  const nicknames = useNicknames();

  const [run, setRun] = useState<PlannedRun | null>(null);
  const [runLoading, setRunLoading] = useState(true);
  const [noRun, setNoRun] = useState(false);

  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressRef = useRef<ProgressState | null>(null);
  const dbProgressRef = useRef<ProgressState | null>(null);
  const progressSaveTimer = useRef<any>(null);

  const [vehicleSnap, setVehicleSnap] = useState<VehicleSnapshot | null>(null);
  const [coordsByPostcode, setCoordsByPostcode] = useState<
    Record<string, LngLat>
  >({});
  const geoCacheRef = useRef<Map<string, LngLat>>(new Map());

  const [etaText, setEtaText] = useState("—");
  const [etaDetails, setEtaDetails] = useState<{
    mins: number;
    km: number;
  } | null>(null);

  // ── Cost tracking state ──
  const [costs, setCosts] = useState<Cost[]>([]);
  const [showCostForm, setShowCostForm] = useState(false);
  const [costCategory, setCostCategory] = useState<CostCategory>("fuel");
  const [costAmount, setCostAmount] = useState("");
  const [costNote, setCostNote] = useState("");
  const [costReceipt, setCostReceipt] = useState<File | null>(null);
  const [costSubmitting, setCostSubmitting] = useState(false);

  const stops = useMemo(() => {
    if (!run) return [];
    return parseStops(run.rawText);
  }, [run]);

  // Extract per-stop delivery refs from rawText lines (e.g. "BS1 4DJ 09:00 REF:ABC123")
  const stopRefs = useMemo(() => {
    if (!run) return new Map<number, string>();
    const refs = new Map<number, string>();
    const lines = (run.rawText || "").split(/\r?\n/).filter(Boolean);
    let stopIdx = 0;
    for (const line of lines) {
      const hasPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(line);
      if (hasPostcode) {
        const refMatch = line.match(/REF:(.+?)$/i);
        if (refMatch) refs.set(stopIdx, refMatch[1].trim());
        stopIdx++;
      }
    }
    return refs;
  }, [run]);

  // ── Register service worker for PWA ──
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // ── Load run for today matching driver's assigned vehicle ──
  useEffect(() => {
    if (authLoading) return;
    if (!profile?.assigned_vehicle) {
      setRunLoading(false);
      return;
    }

    const supabase = createClient();
    const vehicle = profile.assigned_vehicle.trim();
    const today = todayISO();

    supabase
      .from("runs")
      .select("*")
      .eq("date", today)
      .eq("vehicle", vehicle)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const r = rowToRun(data[0]);
          setRun(r);
          const p = r.progress ?? DEFAULT_PROGRESS;
          setProgress(p);
          progressRef.current = p;
        } else {
          setNoRun(true);
        }
        setRunLoading(false);
      });
  }, [authLoading, profile?.assigned_vehicle]);

  // ── Pre-geocode all postcodes ──
  useEffect(() => {
    if (!run || !mapboxToken) return;
    const pcs = [
      normalizePostcode(run.fromPostcode),
      ...stops.map((s) => normalizePostcode(s)),
    ].filter(Boolean);
    if (!pcs.length) return;

    (async () => {
      const next: Record<string, LngLat> = { ...coordsByPostcode };
      for (const pc of pcs) {
        if (next[pc]) continue;
        const cached = geoCacheRef.current.get(pc);
        if (cached) {
          next[pc] = cached;
          continue;
        }
        try {
          const ll = await geocodePostcode(pc, mapboxToken);
          geoCacheRef.current.set(pc, ll);
          next[pc] = ll;
        } catch {
          /* skip */
        }
      }
      setCoordsByPostcode(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, mapboxToken, stops.join("|")]);

  // ── Periodic DB sync (picks up cron completions) ──
  useEffect(() => {
    if (!run) return;
    const supabase = createClient();

    const sync = async () => {
      const { data } = await supabase
        .from("runs")
        .select("progress, completed_stop_indexes, completed_meta")
        .eq("id", run.id)
        .single();
      if (!data) return;

      const dbProgress: ProgressState = data.progress ?? DEFAULT_PROGRESS;
      dbProgressRef.current = dbProgress;

      const local = progressRef.current ?? DEFAULT_PROGRESS;
      const merged = [
        ...new Set([...local.completedIdx, ...dbProgress.completedIdx]),
      ].sort((a, b) => a - b);

      if (merged.length > local.completedIdx.length) {
        const updated: ProgressState = { ...local, completedIdx: merged };
        setProgress(updated);
        progressRef.current = updated;
      }

      const dbStops: number[] = data.completed_stop_indexes ?? [];
      const dbMeta = data.completed_meta ?? {};
      setRun((prev) => {
        if (!prev) return prev;
        const localStops = prev.completedStopIndexes ?? [];
        const mergedStops = [...new Set([...localStops, ...dbStops])].sort(
          (a, b) => a - b
        );
        if (
          mergedStops.length === localStops.length &&
          JSON.stringify(dbMeta) === JSON.stringify(prev.completedMeta)
        )
          return prev;
        return {
          ...prev,
          completedStopIndexes: mergedStops,
          completedMeta: { ...(prev.completedMeta ?? {}), ...dbMeta },
        };
      });
    };

    sync();
    const timer = setInterval(sync, 60_000);
    return () => clearInterval(timer);
  }, [run?.id]);

  // ── Save progress (debounced) ──
  function saveProgress(p: ProgressState) {
    setProgress(p);
    progressRef.current = p;
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(() => {
      if (!run) return;
      updateRunAction(run.id, { progress: p });
    }, 2000);
  }

  // ── Vehicle polling + proximity engine + next-stop ETA ──
  useEffect(() => {
    if (!run || !run.vehicle?.trim()) return;

    let cancelled = false;
    let timer: any;

    async function tick() {
      if (cancelled || !run) return;

      try {
        const res = await fetch(
          `/api/webfleet/vehicle?vehicle=${encodeURIComponent(run.vehicle)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as VehicleSnapshot;
        if (!data || typeof data.lat !== "number") return;
        if (cancelled) return;

        setVehicleSnap(data);

        // ── Proximity engine ──
        const current = progressRef.current ?? DEFAULT_PROGRESS;
        const dbSnap = dbProgressRef.current;
        let mergedCompleted = [...current.completedIdx];
        if (dbSnap) {
          for (const idx of dbSnap.completedIdx ?? []) {
            if (!mergedCompleted.includes(idx)) mergedCompleted.push(idx);
          }
          mergedCompleted.sort((a, b) => a - b);
        }
        const p: ProgressState = { ...current, completedIdx: mergedCompleted };

        const nsi = nextStopIndex(stops, p.completedIdx);
        if (nsi == null) {
          if (progressChanged(current, p)) saveProgress(p);
          setEtaText("Done");
          setEtaDetails(null);
          return;
        }

        const nextPc = stops[nsi];
        const nextLL = coordsByPostcode[nextPc];
        const vehicleLL: LngLat = { lng: data.lng, lat: data.lat };

        if (nextLL) {
          const distM = haversineMeters(vehicleLL, nextLL);
          const inside = distM <= COMPLETION_RADIUS_METERS;
          const nowMs = Date.now();

          if (p.onSiteIdx != null && p.onSiteIdx !== nsi) {
            const trackedPc = stops[p.onSiteIdx];
            const trackedLL = coordsByPostcode[trackedPc];
            const nearTracked = trackedLL
              ? haversineMeters(vehicleLL, trackedLL) <= COMPLETION_RADIUS_METERS
              : false;
            if (!nearTracked) {
              p.onSiteIdx = null;
              p.onSiteSinceMs = null;
            }
          }

          if (inside) {
            if (p.onSiteIdx !== nsi) {
              p.onSiteIdx = nsi;
              p.onSiteSinceMs = nowMs;
            }
            p.lastInside = true;
            if (
              p.onSiteSinceMs != null &&
              minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS
            ) {
              if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
              p.completedIdx.sort((a, b) => a - b);
            }
          } else {
            if (p.onSiteIdx === nsi) {
              if (
                p.onSiteSinceMs != null &&
                minutesBetween(p.onSiteSinceMs, nowMs) >= MIN_STANDSTILL_MINS
              ) {
                if (!p.completedIdx.includes(nsi)) p.completedIdx.push(nsi);
                p.completedIdx.sort((a, b) => a - b);
              }
              p.onSiteIdx = null;
              p.onSiteSinceMs = null;
            }
            p.lastInside = false;
          }
        }

        if (progressChanged(current, p)) {
          saveProgress(p);

          const newlyCompleted = p.completedIdx.filter(
            (idx) => !current.completedIdx.includes(idx)
          );
          if (newlyCompleted.length) {
            const arrivedISO = current.onSiteSinceMs
              ? new Date(current.onSiteSinceMs).toISOString()
              : new Date().toISOString();
            setRun((prev) => {
              if (!prev) return prev;
              const merged = [
                ...new Set([
                  ...(prev.completedStopIndexes ?? []),
                  ...newlyCompleted,
                ]),
              ].sort((a, b) => a - b);
              const meta: Record<number, any> = {
                ...(prev.completedMeta ?? {}),
              };
              for (const idx of newlyCompleted) {
                if (!meta[idx])
                  meta[idx] = { by: "auto" as const, arrivedISO };
              }
              updateRunAction(prev.id, {
                completedStopIndexes: merged,
                completedMeta: meta,
              });
              return {
                ...prev,
                completedStopIndexes: merged,
                completedMeta: meta,
              };
            });
          }
        }

        // ── Next-stop ETA ──
        const nsi2 = nextStopIndex(stops, p.completedIdx);
        if (nsi2 == null) {
          setEtaText("Done");
          setEtaDetails(null);
          return;
        }
        const nextLL2 = coordsByPostcode[stops[nsi2]];
        if (!nextLL2 || !mapboxToken) {
          setEtaText("—");
          setEtaDetails(null);
          return;
        }

        const { mins, km } = await getDirectionsLeg(
          vehicleLL,
          nextLL2,
          mapboxToken
        );
        const eta = new Date(Date.now() + mins * 60_000);
        const hh = String(eta.getHours()).padStart(2, "0");
        const mm = String(eta.getMinutes()).padStart(2, "0");
        setEtaText(`${hh}:${mm}`);
        setEtaDetails({ mins, km });
      } catch {
        /* swallow — will retry next tick */
      }
    }

    tick();
    timer = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.vehicle, coordsByPostcode, stops.join("|"), mapboxToken]);

  // ── Derived state ──
  const stopStatuses = useMemo(() => {
    const out: StopStatus[] = stops.map(() => "pending");
    const p = progress;
    if (!p) return out;
    for (const i of p.completedIdx) {
      if (i >= 0 && i < out.length) out[i] = "completed";
    }
    if (p.onSiteIdx != null && p.onSiteIdx >= 0 && p.onSiteIdx < out.length) {
      out[p.onSiteIdx] = "on_site";
    }
    return out;
  }, [stops, progress]);

  const nextIdx = useMemo(() => {
    const p = progress;
    return nextStopIndex(stops, p ? p.completedIdx : []);
  }, [stops, progress]);

  const completedCount = useMemo(() => {
    return stopStatuses.filter((s) => s === "completed").length;
  }, [stopStatuses]);

  // ── Driver mark complete ──
  function driverMarkComplete(idx: number) {
    if (!run) return;
    const current = progressRef.current ?? DEFAULT_PROGRESS;
    const p: ProgressState = {
      ...current,
      completedIdx: [...current.completedIdx],
    };

    if (!p.completedIdx.includes(idx)) {
      p.completedIdx.push(idx);
      p.completedIdx.sort((a, b) => a - b);
    }

    if (p.onSiteIdx === idx) {
      p.onSiteIdx = null;
      p.onSiteSinceMs = null;
      p.lastInside = false;
    }

    saveProgress(p);

    const nowISO = new Date().toISOString();
    setRun((prev) => {
      if (!prev) return prev;
      const newCompleted = [...(prev.completedStopIndexes ?? [])];
      if (!newCompleted.includes(idx)) {
        newCompleted.push(idx);
        newCompleted.sort((a, b) => a - b);
      }
      const newMeta = {
        ...(prev.completedMeta ?? {}),
        [idx]: { atISO: nowISO, by: "driver" as const },
      };
      updateRunAction(prev.id, {
        completedStopIndexes: newCompleted,
        completedMeta: newMeta,
      });
      return {
        ...prev,
        completedStopIndexes: newCompleted,
        completedMeta: newMeta,
      };
    });
  }

  // ── Load costs for today ──
  useEffect(() => {
    if (!run) return;
    listDriverCosts(todayISO()).then((res) => {
      if (!res.error) setCosts(res.costs.map(rowToCost));
    });
  }, [run]);

  async function handleSubmitCost(e: React.FormEvent) {
    e.preventDefault();
    if (!run || !user) return;
    setCostSubmitting(true);

    let receiptUrl: string | null = null;

    // Upload receipt if provided
    if (costReceipt) {
      const supabase = createClient();
      const ext = costReceipt.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("receipts")
        .upload(path, costReceipt, { upsert: false });
      if (!uploadErr) {
        receiptUrl = path;
      }
    }

    const amountPence = Math.round(parseFloat(costAmount) * 100);
    if (isNaN(amountPence) || amountPence <= 0) {
      setCostSubmitting(false);
      return;
    }

    const result = await createCost({
      runId: run.id,
      vehicle: profile?.assigned_vehicle ?? "",
      date: todayISO(),
      category: costCategory,
      amount: amountPence,
      note: costNote,
      receiptUrl,
    });

    if (!result.error) {
      // Reload costs
      const res = await listDriverCosts(todayISO());
      if (!res.error) setCosts(res.costs.map(rowToCost));
      setShowCostForm(false);
      setCostAmount("");
      setCostNote("");
      setCostReceipt(null);
      setCostCategory("fuel");
    }
    setCostSubmitting(false);
  }

  async function handleDeleteCost(id: string) {
    if (!confirm("Delete this cost entry?")) return;
    await deleteCost(id);
    setCosts((prev) => prev.filter((c) => c.id !== id));
  }

  // ── Sign out ──
  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  // ── Guard states ──
  if (authLoading || runLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (profile?.role !== "driver") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-xl font-semibold mb-2">Access Denied</div>
          <div className="text-gray-400">This page is for drivers only.</div>
        </div>
      </div>
    );
  }

  if (!profile.assigned_vehicle) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-xl font-semibold mb-2">No Vehicle Assigned</div>
          <div className="text-gray-400">
            Contact your admin to assign a vehicle to your account.
          </div>
        </div>
      </div>
    );
  }

  if (noRun || !run) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <Image
            src="/mlc-logo.jpg"
            alt="MLC"
            width={100}
            height={40}
            className="rounded"
          />
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 hover:text-white"
          >
            Sign Out
          </button>
        </div>
        <div className="flex items-center justify-center p-8" style={{ minHeight: "calc(100vh - 65px)" }}>
          <div className="text-center">
            <div className="text-xl font-semibold mb-2">No Run Today</div>
            <div className="text-gray-400">
              No run scheduled for {todayISO()} on vehicle{" "}
              {profile.assigned_vehicle}.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ──
  const nextPc = nextIdx != null ? stops[nextIdx] : null;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <Image
          src="/mlc-logo.jpg"
          alt="MLC"
          width={100}
          height={40}
          className="rounded"
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{profile.assigned_vehicle}</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Run info */}
        <div className="border border-white/10 rounded-xl p-4 bg-white/5">
          <div className="text-sm text-gray-400">
            {new Date(run.date + "T00:00:00").toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
          <div className="font-semibold text-lg mt-1">
            {run.jobNumber} &bull; {run.customer}
          </div>
          {run.loadRef && (
            <div className="text-sm text-gray-300 mt-1">Ref: {run.loadRef}</div>
          )}
          <div className="text-sm text-gray-400 mt-1">
            From {withNickname(run.fromPostcode, nicknames)}
            {run.toPostcode ? ` \u2192 ${run.toPostcode}` : ""}
          </div>
        </div>

        {/* Next stop banner */}
        {nextPc ? (
          <div className="border border-blue-500/30 rounded-xl p-4 bg-blue-500/10">
            <div className="text-xs text-blue-300 font-semibold uppercase tracking-wide">
              Next Stop
            </div>
            <div className="text-2xl font-bold mt-1">{withNickname(nextPc, nicknames)}</div>
            {nextIdx != null && stopRefs.get(nextIdx) && (
              <div className="text-sm text-blue-200/70 mt-0.5">Ref: {stopRefs.get(nextIdx)}</div>
            )}
            <div className="text-sm text-blue-200 mt-1">
              {etaText !== "—" && etaText !== "Done" ? (
                <>
                  ETA {etaText}
                  {etaDetails && (
                    <span className="text-blue-300/70">
                      {" "}
                      &mdash; {etaDetails.mins} mins, {etaDetails.km} km
                    </span>
                  )}
                </>
              ) : (
                "Calculating..."
              )}
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                nextPc
              )}`}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-3 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-base transition-colors"
            >
              Navigate
            </a>
          </div>
        ) : (
          <div className="border border-emerald-500/30 rounded-xl p-4 bg-emerald-500/10 text-center">
            <div className="text-2xl font-bold text-emerald-300">
              All Stops Complete
            </div>
          </div>
        )}

        {/* Stop list */}
        <div>
          <div className="text-sm font-semibold text-gray-400 mb-3">
            STOPS &nbsp;
            <span className="text-white">
              {completedCount}/{stops.length}
            </span>{" "}
            completed
          </div>

          <div className="space-y-2">
            {stops.map((pc, idx) => {
              const status = stopStatuses[idx] ?? "pending";
              const isNext = nextIdx === idx;

              const badge =
                status === "completed"
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-200"
                  : status === "on_site"
                  ? "bg-yellow-500/15 border-yellow-500/30 text-yellow-200"
                  : isNext
                  ? "bg-blue-500/15 border-blue-500/30 text-blue-200"
                  : "bg-white/5 border-white/10 text-gray-400";

              const badgeText =
                status === "completed"
                  ? "DONE"
                  : status === "on_site"
                  ? "ON SITE"
                  : isNext
                  ? "NEXT"
                  : "PENDING";

              return (
                <div
                  key={`${pc}-${idx}`}
                  className="border border-white/10 rounded-xl p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-semibold text-sm shrink-0">
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold">{withNickname(pc, nicknames)}</div>
                        {stopRefs.get(idx) && (
                          <div className="text-xs text-gray-400">Ref: {stopRefs.get(idx)}</div>
                        )}
                        {status === "completed" &&
                          run?.completedMeta?.[idx] && (
                            <div className="text-xs text-gray-500">
                              {run.completedMeta[idx].arrivedISO && (
                                <span>
                                  Arrived{" "}
                                  {new Date(
                                    run.completedMeta[idx].arrivedISO!
                                  ).toLocaleTimeString("en-GB", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                              {run.completedMeta[idx].arrivedISO &&
                                run.completedMeta[idx].atISO &&
                                " — "}
                              {run.completedMeta[idx].atISO && (
                                <span>
                                  Left{" "}
                                  {new Date(
                                    run.completedMeta[idx].atISO
                                  ).toLocaleTimeString("en-GB", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                          )}
                        {status === "on_site" && progress?.onSiteSinceMs && (
                          <div className="text-xs text-gray-500">
                            On site for{" "}
                            {minutesBetween(progress.onSiteSinceMs, Date.now())}{" "}
                            mins
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      className={`px-2 py-1 rounded-lg border text-xs font-semibold shrink-0 ${badge}`}
                    >
                      {badgeText}
                    </div>
                  </div>

                  {/* Action buttons */}
                  {status !== "completed" && (
                    <div className="flex gap-2 mt-3">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          pc
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 text-center px-4 py-3 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl text-sm font-medium transition-colors"
                      >
                        Navigate
                      </a>
                      <button
                        onClick={() => driverMarkComplete(idx)}
                        className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors"
                      >
                        Mark Complete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Costs section ── */}
        <div className="border border-white/10 rounded-xl p-4 bg-white/5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-400">
              COSTS TODAY &nbsp;
              {costs.length > 0 && (
                <span className="text-white">
                  ({costs.length} logged &mdash;{" "}
                  {formatPence(costs.reduce((sum, c) => sum + c.amount, 0))})
                </span>
              )}
            </div>
            <button
              onClick={() => setShowCostForm(!showCostForm)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              {showCostForm ? "Cancel" : "+ Log Cost"}
            </button>
          </div>

          {/* Cost form */}
          {showCostForm && (
            <form
              onSubmit={handleSubmitCost}
              className="border border-white/10 rounded-xl p-3 mb-3 space-y-3 bg-white/5"
            >
              {/* Category buttons */}
              <div>
                <div className="text-xs text-gray-400 mb-1.5">Category</div>
                <div className="flex flex-wrap gap-1.5">
                  {COST_CATEGORIES.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setCostCategory(cat.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        costCategory === cat.value
                          ? "bg-blue-500/20 text-blue-400 border-blue-400/30"
                          : "bg-white/5 text-gray-400 border-white/10"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div>
                <div className="text-xs text-gray-400 mb-1.5">Amount</div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 font-semibold">&pound;</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={costAmount}
                    onChange={(e) => setCostAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <div className="text-xs text-gray-400 mb-1.5">
                  Note <span className="text-gray-600">(optional)</span>
                </div>
                <input
                  type="text"
                  value={costNote}
                  onChange={(e) => setCostNote(e.target.value)}
                  placeholder="e.g. BP M1 Services"
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                />
              </div>

              {/* Receipt upload */}
              <div>
                <div className="text-xs text-gray-400 mb-1.5">
                  Receipt <span className="text-gray-600">(optional)</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) =>
                    setCostReceipt(e.target.files?.[0] ?? null)
                  }
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-white/10 file:text-white file:font-medium file:cursor-pointer"
                />
                {costReceipt && (
                  <div className="text-xs text-gray-500 mt-1">
                    {costReceipt.name}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={costSubmitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-base font-semibold transition-colors"
              >
                {costSubmitting ? "Saving..." : "Save Cost"}
              </button>
            </form>
          )}

          {/* Costs list */}
          {costs.length > 0 ? (
            <div className="space-y-2">
              {costs.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 border border-white/5 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white/10 text-gray-300 uppercase">
                        {c.category}
                      </span>
                      <span className="font-semibold text-sm">
                        {formatPence(c.amount)}
                      </span>
                    </div>
                    {c.note && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {c.note}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.receiptUrl && (
                      <span className="text-xs text-blue-400">Receipt</span>
                    )}
                    <button
                      onClick={() => handleDeleteCost(c.id)}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !showCostForm && (
              <div className="text-sm text-gray-600 text-center py-2">
                No costs logged today
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
