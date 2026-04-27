"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import PlannerGrid from "@/components/planner/PlannerGrid";
import Icon from "@/components/portal/Icon";
import { useAuth } from "@/components/AuthProvider";
import { listRunsForIsoWeek, copyWeekForward } from "@/app/actions/planner";
import { listTrailers, listVehicles } from "@/app/actions/fleet";
import { fetchCustomerNames } from "@/lib/customers";
import { isoWeekMonday, isoWeekNum, isoYear } from "@/lib/iso-week";
import { sortRunsForPlanner } from "@/lib/planner/customer-order";
import type { PlannedRun } from "@/types/runs";
import { aggregateWeek } from "@/lib/figures/aggregate";
import { emptyWeeklyExtras } from "@/types/figures";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type DayKey = typeof DAY_LABELS[number];

function parseWeekParam(raw: string): { year: number; week: number } {
  if (raw === "current") {
    const now = new Date();
    return { year: isoYear(now), week: isoWeekNum(now) };
  }
  const ymatch = raw.match(/^(\d{1,2})-(\d{4})$/);
  if (ymatch) return { week: Number(ymatch[1]), year: Number(ymatch[2]) };
  const isomatch = raw.match(/^(\d{4})-W(\d{1,2})$/i);
  if (isomatch) return { year: Number(isomatch[1]), week: Number(isomatch[2]) };
  const now = new Date();
  return { year: isoYear(now), week: isoWeekNum(now) };
}

function dateForDayOfWeek(year: number, week: number, dayIdx: number): string {
  const monday = isoWeekMonday(year, week);
  const [y, m, d] = monday.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dayIdx));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function WeeklyPlannerPage() {
  const params = useParams<{ week: string }>();
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";

  const { year, week } = useMemo(
    () => parseWeekParam(String(params?.week ?? "current")),
    [params?.week]
  );

  const [allRuns, setAllRuns] = useState<PlannedRun[]>([]);
  const [customers, setCustomers] = useState<string[]>([]);
  const [trailers, setTrailers] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const [activeDay, setActiveDay] = useState<DayKey>(() => {
    const today = new Date();
    if (isoYear(today) === year && isoWeekNum(today) === week) {
      const idx = (today.getUTCDay() + 6) % 7; // make Mon=0
      return DAY_LABELS[idx];
    }
    return "Mon";
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const [runsRes, vehiclesRes, trailersRes, customerNames] = await Promise.all([
        listRunsForIsoWeek(year, week),
        listVehicles(),
        listTrailers(),
        fetchCustomerNames(),
      ]);
      if (cancelled) return;
      if (runsRes.error) setError(runsRes.error);
      setAllRuns(runsRes.runs ?? []);
      setVehicles((vehiclesRes.vehicles ?? []).filter((v) => v.active).map((v) => v.id));
      setTrailers((trailersRes.trailers ?? []).filter((t) => t.active).map((t) => t.id));
      setCustomers(customerNames ?? []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [year, week]);

  const dayDates = useMemo(
    () => DAY_LABELS.map((label, idx) => ({ label, date: dateForDayOfWeek(year, week, idx) })),
    [year, week]
  );

  const runsByDay = useMemo(() => {
    const map = new Map<string, PlannedRun[]>();
    for (const d of dayDates) map.set(d.date, []);
    for (const r of allRuns) {
      const list = map.get(r.date);
      if (list) list.push(r);
    }
    // Customer-priority sort within each day, so the active-day grid below
    // shows CONSOLID8 → ASHWOOD → MONTPELLIER → others.
    for (const [k, list] of map) {
      map.set(k, sortRunsForPlanner(list));
    }
    return map;
  }, [allRuns, dayDates]);

  const aggregate = useMemo(() => {
    return aggregateWeek({
      runs: allRuns,
      vehicleCosts: [],
      extras: emptyWeeklyExtras(year, week),
    });
  }, [allRuns, year, week]);

  if (authLoading) {
    return <div className="muted">Loading…</div>;
  }

  const activeIdx = DAY_LABELS.indexOf(activeDay);
  const activeDate = dayDates[activeIdx]?.date ?? "";
  const activeRuns = runsByDay.get(activeDate) ?? [];

  function changeWeek(newWeek: number, newYear: number) {
    router.push(`/portal/planner/week/${newWeek}-${newYear}`);
  }

  // Last 12 weeks
  const weekOptions: Array<{ label: string; value: string }> = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i * 7));
    const w = isoWeekNum(d);
    const y = isoYear(d);
    weekOptions.push({ label: `WK${String(w).padStart(2, "0")}_${String(y).slice(2)}`, value: `${w}-${y}` });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Week {week}, {year}</h1>
          <div className="page-subtitle">
            Mon {dayDates[0].date} · Sun {dayDates[6].date}
          </div>
        </div>
        <div className="row gap-8">
          <Link href={`/portal/figures/${week}-${year}`} className="btn sm">
            <Icon name="chart" size={11} /> Figures
          </Link>
          <Link href={`/portal/invoicing/${week}-${year}`} className="btn sm">
            <Icon name="doc" size={11} /> Invoicing
          </Link>
          <select
            value={`${week}-${year}`}
            onChange={(e) => {
              const [w, y] = e.target.value.split("-").map(Number);
              changeWeek(w, y);
            }}
            className="select"
            style={{ height: 32, fontSize: 12.5, padding: "0 10px" }}
          >
            {weekOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {isAdmin && allRuns.length === 0 && (
            <button
              type="button"
              className="btn sm primary"
              disabled={copying}
              onClick={async () => {
                if (!confirm(`Copy every leg from week ${week === 1 ? 52 : week - 1} into week ${week}? Each day in week ${week} must currently be empty.`)) return;
                setCopying(true);
                setError("");
                const fromWeek = week === 1 ? 52 : week - 1;
                const fromYear = week === 1 ? year - 1 : year;
                const res = await copyWeekForward(fromYear, fromWeek, year, week);
                setCopying(false);
                if (res.error) {
                  setError(res.error);
                } else {
                  // Reload week.
                  router.refresh();
                  const reload = await listRunsForIsoWeek(year, week);
                  setAllRuns(reload.runs ?? []);
                }
              }}
              title="Bring last week's planner forward as a starting point"
            >
              <Icon name="refresh" size={11} /> {copying ? "Copying…" : "Copy from last week"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {/* Day tabs — segmented control */}
      <div className="seg" style={{ marginBottom: 16 }}>
        {dayDates.map(({ label, date }) => {
          const dayRuns = runsByDay.get(date) ?? [];
          const dayRevenue = dayRuns.reduce((s, r) => s + (r.revenue ?? 0), 0);
          const isActive = activeDay === label;
          return (
            <button
              key={label}
              type="button"
              className={isActive ? "active" : ""}
              onClick={() => setActiveDay(label)}
              style={{ flexDirection: "column", padding: "8px 14px", lineHeight: 1.2 }}
            >
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span className="muted" style={{ fontSize: 10, fontWeight: 400 }}>
                {date.slice(5)} · {dayRuns.length} · £{dayRevenue.toFixed(0)}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="muted">Loading week…</div>
      ) : (
        <>
          <PlannerGrid
            key={activeDate}
            date={activeDate}
            initialRuns={activeRuns}
            customers={customers}
            trailers={trailers}
            vehicles={vehicles}
            editable={!!isAdmin}
          />

          {aggregate.earningsByVehicle.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">
                <h3>Weekly earnings — vehicle × day</h3>
                <span className="muted" style={{ fontSize: 11 }}>
                  Sum of revenue across the week
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data" style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      {DAY_LABELS.map((d) => (
                        <th key={d} className="right">{d}</th>
                      ))}
                      <th className="right" style={{ borderLeft: "1px solid var(--line)" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregate.earningsByVehicle.map((e) => (
                      <tr key={e.vehicle} style={{ cursor: "default" }}>
                        <td className="bold mono">{e.vehicle}</td>
                        <td className="right mono tnum">{e.byDay.mon ? `£${e.byDay.mon.toFixed(0)}` : <span className="muted">—</span>}</td>
                        <td className="right mono tnum">{e.byDay.tue ? `£${e.byDay.tue.toFixed(0)}` : <span className="muted">—</span>}</td>
                        <td className="right mono tnum">{e.byDay.wed ? `£${e.byDay.wed.toFixed(0)}` : <span className="muted">—</span>}</td>
                        <td className="right mono tnum">{e.byDay.thu ? `£${e.byDay.thu.toFixed(0)}` : <span className="muted">—</span>}</td>
                        <td className="right mono tnum">{e.byDay.fri ? `£${e.byDay.fri.toFixed(0)}` : <span className="muted">—</span>}</td>
                        <td className="right mono tnum">{e.byDay.sat ? `£${e.byDay.sat.toFixed(0)}` : <span className="muted">—</span>}</td>
                        <td className="right mono tnum">{e.byDay.sun ? `£${e.byDay.sun.toFixed(0)}` : <span className="muted">—</span>}</td>
                        <td className="right mono tnum bold" style={{ borderLeft: "1px solid var(--line)" }}>£{e.total.toFixed(0)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--surface-alt)", cursor: "default" }}>
                      <td className="bold">Total</td>
                      <td className="right mono tnum bold">£{aggregate.totalsByDay.mon.toFixed(0)}</td>
                      <td className="right mono tnum bold">£{aggregate.totalsByDay.tue.toFixed(0)}</td>
                      <td className="right mono tnum bold">£{aggregate.totalsByDay.wed.toFixed(0)}</td>
                      <td className="right mono tnum bold">£{aggregate.totalsByDay.thu.toFixed(0)}</td>
                      <td className="right mono tnum bold">£{aggregate.totalsByDay.fri.toFixed(0)}</td>
                      <td className="right mono tnum bold">£{aggregate.totalsByDay.sat.toFixed(0)}</td>
                      <td className="right mono tnum bold">£{aggregate.totalsByDay.sun.toFixed(0)}</td>
                      <td className="right mono tnum bold" style={{ borderLeft: "1px solid var(--line)" }}>
                        £{aggregate.grossEarnings.toFixed(0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
