"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePortalData } from "@/components/portal/PortalDataContext";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import {
  useDriversByVehicle,
  lookupDriver,
} from "@/hooks/useDriversByVehicle";
import { normVehicle } from "@/lib/webfleet";
import { quickEta } from "@/lib/portal/loads";
import Icon from "@/components/portal/Icon";
import StatusPill from "@/components/portal/StatusPill";
import PortalMap, { type MapPin } from "@/components/portal/PortalMap";

// Cheltenham depot (GL51 area). Origin pin on the tracking map.
const DEPOT: { lat: number; lng: number } = { lat: 51.9, lng: -2.07 };

const ACTIVE_STATUSES = new Set(["in-transit", "loading", "delayed", "exception"]);

export default function TrackingPage() {
  const { enriched, loading: runsLoading } = usePortalData();
  const { positions, loading: posLoading } = useVehiclePositions();
  const { byVehicle: drivers } = useDriversByVehicle();

  const active = useMemo(
    () => enriched.filter((r) => ACTIVE_STATUSES.has(r.status)),
    [enriched],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    active.find((r) => r.run.id === selectedId) ?? active[0] ?? null;

  const mapPins: MapPin[] = useMemo(() => {
    const pins: MapPin[] = [
      {
        id: "depot",
        kind: "origin",
        lat: DEPOT.lat,
        lng: DEPOT.lng,
        label: "Cheltenham depot",
      },
    ];
    for (const { run, status } of active) {
      const reg = normVehicle(run.vehicle);
      const pos = positions[reg];
      if (!pos) continue;
      const color =
        status === "exception"
          ? "#B91924"
          : status === "delayed"
            ? "#B7791F"
            : "#D81E2A";
      pins.push({
        id: run.id,
        kind: "truck",
        lat: pos.lat,
        lng: pos.lng,
        color,
        selected: selected?.run.id === run.id,
        label: `${run.vehicle} → ${run.toPostcode}`,
        onClick: () => setSelectedId(run.id),
      });
    }
    return pins;
  }, [active, positions, selected]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Live tracking</h1>
          <div className="page-subtitle">
            {active.length} vehicle{active.length === 1 ? "" : "s"} on the road ·
            positions refresh every 30s
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn" type="button">
            <Icon name="filter" size={13} /> Filter fleet
          </button>
          <button className="btn" type="button">
            <Icon name="refresh" size={13} /> Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 16,
          height: "calc(100vh - 220px)",
        }}
      >
        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          <div className="card-header">
            <h3>Active vehicles</h3>
            <span className="muted mono" style={{ fontSize: 11 }}>
              {active.length}
            </span>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {runsLoading && active.length === 0 && (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--ink-500)",
                  fontSize: 12.5,
                }}
              >
                Loading active vehicles…
              </div>
            )}
            {!runsLoading && active.length === 0 && (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--ink-500)",
                  fontSize: 12.5,
                }}
              >
                No vehicles are active right now.
              </div>
            )}
            {active.map(({ run, status }) => {
              const isSel = selected?.run.id === run.id;
              const driver = lookupDriver(drivers, run.vehicle);
              return (
                <div
                  key={run.id}
                  onClick={() => setSelectedId(run.id)}
                  style={{
                    padding: "12px 14px",
                    borderBottom: "1px solid var(--line)",
                    cursor: "pointer",
                    background: isSel ? "var(--info-bg)" : undefined,
                    borderLeft: isSel
                      ? "3px solid var(--mlc-blue)"
                      : "3px solid transparent",
                  }}
                >
                  <div
                    className="row"
                    style={{ justifyContent: "space-between", marginBottom: 4 }}
                  >
                    <span className="bold mono" style={{ fontSize: 12 }}>
                      {run.vehicle || "Unassigned"}
                    </span>
                    <StatusPill status={status} size="sm" />
                  </div>
                  <div className="row gap-4" style={{ fontSize: 11 }}>
                    <span className="mono">{run.fromPostcode}</span>
                    <Icon name="arrowR" size={9} className="muted" />
                    <span className="mono">{run.toPostcode || "—"}</span>
                  </div>
                  <div
                    className="muted"
                    style={{ fontSize: 10.5, marginTop: 2 }}
                  >
                    {driver?.name ?? "Driver TBC"} · ETA {quickEta(run)} ·{" "}
                    <span className="mono">{run.jobNumber || run.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="card"
          style={{
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          <PortalMap pins={mapPins} height="100%" />
          {selected && (
            <SelectedVehicleCard
              vehicleReg={selected.run.vehicle}
              runId={selected.run.id}
              jobNumber={selected.run.jobNumber || selected.run.id}
              toPostcode={selected.run.toPostcode || "—"}
              eta={quickEta(selected.run)}
              position={positions[normVehicle(selected.run.vehicle)] ?? null}
              driverName={
                lookupDriver(drivers, selected.run.vehicle)?.name ?? null
              }
              positionsLoading={posLoading}
            />
          )}
        </div>
      </div>
    </>
  );
}

function SelectedVehicleCard({
  vehicleReg,
  runId,
  jobNumber,
  toPostcode,
  eta,
  position,
  driverName,
  positionsLoading,
}: {
  vehicleReg: string;
  runId: string;
  jobNumber: string;
  toPostcode: string;
  eta: string;
  position: ReturnType<typeof useVehiclePositions>["positions"][string] | null;
  driverName: string | null;
  positionsLoading: boolean;
}) {
  const speedMph =
    position?.speedKph != null
      ? Math.round(position.speedKph * 0.621371)
      : null;
  const lastSeen = position?.collectedAt
    ? relativeTime(position.collectedAt)
    : null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        right: 16,
        background: "#fff",
        borderRadius: 8,
        padding: 14,
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div className="row gap-8">
          <span className="bold mono" style={{ fontSize: 14 }}>
            {vehicleReg || "Unassigned"}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {driverName ?? "Driver TBC"} ·{" "}
          {position
            ? lastSeen
              ? `Position ${lastSeen}`
              : "Position recent"
            : positionsLoading
              ? "Position loading…"
              : "No recent position"}
        </div>
      </div>
      <div
        className="divider"
        style={{ width: 1, height: 36, margin: 0, background: "var(--line)" }}
      />
      <div>
        <div
          className="muted"
          style={{
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            fontWeight: 600,
          }}
        >
          Heading to
        </div>
        <div className="bold mono" style={{ fontSize: 12.5 }}>
          {toPostcode}
        </div>
      </div>
      <div>
        <div
          className="muted"
          style={{
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            fontWeight: 600,
          }}
        >
          ETA
        </div>
        <div className="bold mono tnum" style={{ fontSize: 14 }}>
          {eta}
        </div>
      </div>
      <div>
        <div
          className="muted"
          style={{
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            fontWeight: 600,
          }}
        >
          Speed
        </div>
        <div className="bold mono tnum" style={{ fontSize: 14 }}>
          {speedMph != null ? `${speedMph} mph` : "—"}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <Link href={`/portal/loads/${runId}`} className="btn">
        Open {jobNumber} <Icon name="arrowR" size={12} />
      </Link>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recent";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}
