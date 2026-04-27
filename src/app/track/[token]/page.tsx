import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rowToRun } from "@/types/runs";
import { todayISO } from "@/lib/time-utils";
import { parseStops, normalizePostcode } from "@/lib/postcode-utils";
import { normVehicle } from "@/lib/webfleet";
import { deriveStatus, quickEta } from "@/lib/portal/loads";
import StatusPill from "@/components/portal/StatusPill";
import BrandMark from "@/components/portal/BrandMark";
import PortalMap, {
  type MapPin,
  type MapRoute,
} from "@/components/portal/PortalMap";

// Re-render at most every 30 seconds so vehicle position stays fresh without
// hammering Supabase on every visit.
export const revalidate = 30;

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function PublicTrackPage({ params }: PageProps) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  const sb = getSupabaseAdmin();

  // Token lookup uses the admin client so the public RLS posture is unchanged.
  const { data: row } = await sb
    .from("runs")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();
  if (!row) notFound();

  const run = rowToRun(row);
  const status = deriveStatus(run, todayISO());
  const stops = parseStops(run.rawText);
  const completedIdx = new Set([
    ...(run.completedStopIndexes ?? []),
    ...(run.progress?.completedIdx ?? []),
  ]);

  // Driver name (no email, no phone — public surface)
  const reg = normVehicle(run.vehicle);
  const [{ data: driverRow }, { data: posRow }, { data: coordRows }] = await Promise.all([
    reg
      ? sb
          .from("profiles")
          .select("full_name")
          .eq("role", "driver")
          .eq("active", true)
          .ilike("assigned_vehicle", reg)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    reg
      ? sb
          .from("vehicle_positions")
          .select("lat, lng, speed_kph, collected_at")
          .eq("vehicle", reg)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from("postcode_coords")
      .select("postcode, lat, lng")
      .in("postcode", stops.map(normalizePostcode)),
  ]);

  const coords = new Map<string, { lat: number; lng: number }>();
  for (const c of (coordRows ?? []) as Array<{
    postcode: string;
    lat: number;
    lng: number;
  }>) {
    coords.set(normalizePostcode(c.postcode), { lat: c.lat, lng: c.lng });
  }
  const truckPos = posRow
    ? { lat: posRow.lat, lng: posRow.lng, speedKph: posRow.speed_kph }
    : null;

  const { mapPins, mapRoutes } = buildMapData(
    stops,
    coords,
    completedIdx,
    truckPos,
    status === "delivered",
  );

  const dateDisp = new Date(`${run.date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 18px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <BrandMark />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em" }}>
            MLC TRANSPORT
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-500)" }}>
            Shareable shipment tracker
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <StatusPill status={status} />
        </div>
      </header>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>
            <span className="mono">{run.jobNumber || run.id}</span>
            {run.loadRef && (
              <span
                className="muted"
                style={{ fontWeight: 400, fontSize: 12, marginLeft: 10 }}
              >
                {run.loadRef}
              </span>
            )}
          </h3>
        </div>
        <div className="card-body">
          <div
            style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 8 }}
          >
            {run.fromPostcode} → {run.toPostcode || "—"} · {dateDisp}
          </div>
          <div className="stat-row" style={{ marginTop: 8 }}>
            <div className="stat-cell">
              <div className="l">Progress</div>
              <div className="v">
                {completedIdx.size}
                <span
                  style={{
                    color: "var(--ink-500)",
                    fontWeight: 400,
                    fontSize: 13,
                  }}
                >
                  /{stops.length} stops
                </span>
              </div>
            </div>
            <div className="stat-cell">
              <div className="l">ETA</div>
              <div className="v mono">
                {status === "delivered" ? "Delivered" : quickEta(run)}
              </div>
            </div>
            <div className="stat-cell">
              <div className="l">Vehicle</div>
              <div className="v mono" style={{ fontSize: 14 }}>
                {run.vehicle || "TBC"}
              </div>
            </div>
            <div className="stat-cell">
              <div className="l">Driver</div>
              <div className="v" style={{ fontSize: 14 }}>
                {(driverRow as { full_name?: string } | null)?.full_name ?? "TBC"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Live position</h3>
          <div className="actions">
            <span className="muted mono" style={{ fontSize: 11 }}>
              {truckPos
                ? `Updated ${relTime(posRow?.collected_at as string | null)}`
                : "Position pending"}
            </span>
          </div>
        </div>
        <div style={{ height: 360 }}>
          <PortalMap pins={mapPins} routes={mapRoutes} height="100%" />
        </div>
      </div>

      <footer
        style={{
          textAlign: "center",
          fontSize: 11,
          color: "var(--ink-500)",
          padding: 16,
        }}
      >
        Powered by MLC Transport · This page refreshes automatically.
        <br />
        Need to speak to dispatch?{" "}
        <a
          href="tel:01452739001"
          style={{ color: "var(--mlc-blue)", textDecoration: "none" }}
        >
          01452 739 001
        </a>
      </footer>
    </main>
  );
}

function buildMapData(
  stops: string[],
  coords: Map<string, { lat: number; lng: number }>,
  completedIdx: Set<number>,
  truckPos: { lat: number; lng: number } | null,
  delivered: boolean,
): { mapPins: MapPin[]; mapRoutes: MapRoute[] } {
  const pins: MapPin[] = [];
  const stopPoints: Array<[number, number] | null> = stops.map((pc) => {
    const c = coords.get(normalizePostcode(pc));
    return c ? [c.lng, c.lat] : null;
  });

  stops.forEach((pc, i) => {
    const point = stopPoints[i];
    if (!point) return;
    const done = completedIdx.has(i);
    const nextIdx = stops.findIndex((_, idx) => !completedIdx.has(idx));
    const isCurrent = !delivered && i === nextIdx;
    pins.push({
      id: `stop-${i}`,
      kind: i === 0 ? "origin" : "stop",
      lng: point[0],
      lat: point[1],
      badge: i === 0 ? undefined : String(i),
      state: done ? "done" : isCurrent ? "current" : "pending",
      label: pc,
    });
  });

  if (truckPos && !delivered) {
    pins.push({
      id: "truck",
      kind: "truck",
      lng: truckPos.lng,
      lat: truckPos.lat,
      selected: true,
      label: "Vehicle position",
    });
  }

  const routes: MapRoute[] = [];
  let firstIncomplete = stops.findIndex((_, i) => !completedIdx.has(i));
  if (firstIncomplete === -1) firstIncomplete = stops.length;
  const donePoints = stopPoints
    .slice(0, firstIncomplete)
    .filter((p): p is [number, number] => p !== null);
  const remainingPoints = stopPoints
    .slice(Math.max(0, firstIncomplete - 1))
    .filter((p): p is [number, number] => p !== null);
  if (donePoints.length >= 2) {
    routes.push({ id: "done", points: donePoints, state: "done" });
  }
  if (remainingPoints.length >= 2) {
    routes.push({ id: "remaining", points: remainingPoints, state: "remaining" });
  }
  return { mapPins: pins, mapRoutes: routes };
}

function relTime(iso: string | null): string {
  if (!iso) return "now";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "now";
  const diff = Math.round((Date.now() - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  const m = Math.round(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
