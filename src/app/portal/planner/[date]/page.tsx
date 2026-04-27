"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import PlannerGrid, { type PlannerGridHandle } from "@/components/planner/PlannerGrid";
import VehicleAvailabilityStrip from "@/components/planner/VehicleAvailabilityStrip";
import Icon from "@/components/portal/Icon";
import { useAuth } from "@/components/AuthProvider";
import {
  copyDayForward,
  listRunsForDate,
  materializeFixedRuns,
} from "@/app/actions/planner";
import { listTrailers, listVehicles } from "@/app/actions/fleet";
import { fetchCustomerNames } from "@/lib/customers";
import { isoWeekMonday, isoWeekNum, isoYear } from "@/lib/iso-week";
import { sortRunsForPlanner } from "@/lib/planner/customer-order";
import type { PlannedRun } from "@/types/runs";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return DAY_NAMES[dt.getUTCDay()];
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function DailyPlannerPage() {
  const params = useParams<{ date: string }>();
  const date = params?.date ?? "";
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [customers, setCustomers] = useState<string[]>([]);
  const [trailers, setTrailers] = useState<string[]>([]);
  const [fleetVehicles, setFleetVehicles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copying, setCopying] = useState(false);
  const gridRef = useRef<PlannerGridHandle>(null);

  const { isoYr, isoWk } = useMemo(() => {
    if (!date) return { isoYr: 0, isoWk: 0 };
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return { isoYr: isoYear(dt), isoWk: isoWeekNum(dt) };
  }, [date]);

  /** The 7 dates of the ISO week containing `date`, Monday first. */
  const weekDates = useMemo(() => {
    if (!isoYr || !isoWk) return [] as Array<{ label: string; date: string }>;
    const monday = isoWeekMonday(isoYr, isoWk);
    const [y, m, d] = monday.split("-").map(Number);
    return WEEKDAY_SHORT.map((label, idx) => {
      const dt = new Date(Date.UTC(y, m - 1, d + idx));
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      return { label, date: `${yyyy}-${mm}-${dd}` };
    });
  }, [isoYr, isoWk]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      // First, ensure the standing weekday Consolid8 fixtures exist for
      // this date — idempotent, no-op on weekends or when already present.
      // Runs before the listing so the new rows show up on this same load.
      await materializeFixedRuns(date);
      const [runsRes, vehiclesRes, trailersRes, customerNames] = await Promise.all([
        listRunsForDate(date),
        listVehicles(),
        listTrailers(),
        fetchCustomerNames(),
      ]);
      if (cancelled) return;
      if (runsRes.error) setError(runsRes.error);
      // Customer-priority sort: CONSOLID8 → ASHWOOD → MONTPELLIER → others.
      setRuns(sortRunsForPlanner(runsRes.runs ?? []));
      setFleetVehicles(
        (vehiclesRes.vehicles ?? []).filter((v) => v.active).map((v) => v.id)
      );
      setTrailers((trailersRes.trailers ?? []).filter((t) => t.active).map((t) => t.id));
      setCustomers(customerNames ?? []);
      setLoading(false);
    }
    if (date) load();
    return () => { cancelled = true; };
  }, [date]);

  if (authLoading) return <div className="muted">Loading…</div>;

  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const totalRevenue = runs.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const billableCount = runs.filter((r) => r.billable).length;
  const assignedVehicles = Array.from(
    new Set(runs.map((r) => r.vehicle?.trim()).filter((v): v is string => !!v))
  );

  async function handleCopyFromLastWeek() {
    if (!confirm(`Copy every leg from the same day last week (${shiftDate(date, -7)}) into ${date}? Today must currently be empty.`)) return;
    setCopying(true);
    setError("");
    const res = await copyDayForward(shiftDate(date, -7), date);
    setCopying(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    // Reload the day.
    const reload = await listRunsForDate(date);
    setRuns(sortRunsForPlanner(reload.runs ?? []));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">DAILY TRANSPORT SHEET — {dayLabel(date)} {date}</h1>
          <div className="page-subtitle">
            {longDate(date)} · ISO Week {isoWk}, {isoYr}
          </div>
        </div>
        <div className="row gap-8">
          <Link href={`/portal/planner/${prev}`} className="btn sm">
            <Icon name="chevL" size={11} /> Prev day
          </Link>
          <Link href={`/portal/planner/week/${isoWk}-${isoYr}`} className="btn sm">
            <Icon name="cal" size={11} /> Week
          </Link>
          <Link href={`/portal/planner/${next}`} className="btn sm">
            Next day <Icon name="chevR" size={11} />
          </Link>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) window.location.href = `/portal/planner/${e.target.value}`;
            }}
            className="input"
            style={{ height: 32, fontSize: 12.5, padding: "0 10px" }}
          />
          {isAdmin && runs.length === 0 && (
            <button
              type="button"
              className="btn sm primary"
              disabled={copying}
              onClick={() => void handleCopyFromLastWeek()}
              title="Bring forward last week's same-day jobs as a starting point"
            >
              <Icon name="refresh" size={11} /> {copying ? "Copying…" : "Copy from last week"}
            </button>
          )}
        </div>
      </div>

      {/* Mon-Sun day strip — quick jump within this ISO week */}
      {weekDates.length === 7 && (
        <div className="seg" style={{ marginBottom: 16 }}>
          {weekDates.map(({ label, date: d }) => {
            const isActive = d === date;
            return (
              <Link
                key={label}
                href={`/portal/planner/${d}`}
                className={isActive ? "active" : ""}
                style={{
                  flexDirection: "column",
                  padding: "8px 16px",
                  lineHeight: 1.2,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  borderRight: "1px solid var(--line)",
                  fontSize: 11.5,
                  cursor: "pointer",
                  background: isActive ? "var(--mlc-blue, #0B2A6B)" : "transparent",
                  color: isActive ? "#fff" : "var(--ink-700)",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>
                  {d.slice(5)}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat-cell">
          <div className="l">Legs</div>
          <div className="v">{runs.length}</div>
        </div>
        <div className="stat-cell">
          <div className="l">Billable</div>
          <div className="v">{billableCount}</div>
        </div>
        <div className="stat-cell">
          <div className="l">Day revenue</div>
          <div className="v mono tnum">£{totalRevenue.toFixed(2)}</div>
        </div>
        <div className="stat-cell">
          <div className="l">ISO week</div>
          <div className="v">
            <Link href={`/portal/planner/week/${isoWk}-${isoYr}`}>{isoWk}, {isoYr}</Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      <VehicleAvailabilityStrip
        vehicles={fleetVehicles}
        assignedVehicles={assignedVehicles}
        onSelect={
          isAdmin
            ? (v) => {
                void gridRef.current?.addRowWithVehicle(v);
              }
            : undefined
        }
      />

      {loading ? (
        <div className="muted">Loading runs…</div>
      ) : (
        <PlannerGrid
          ref={gridRef}
          date={date}
          initialRuns={runs}
          customers={customers}
          trailers={trailers}
          vehicles={fleetVehicles}
          editable={!!isAdmin}
          onChanged={(next) => setRuns(next)}
        />
      )}
    </>
  );
}
