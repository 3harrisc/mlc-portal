"use client";

/**
 * Customer portal — daily view of stacked loads.
 *
 * Where /portal/loads is a flat 90-day list, this page mirrors the dispatch
 * /portal/planner/[date] UX: a single date with Mon-Sun nav across the ISO
 * week, all loads for that day grouped by assigned vehicle, with chained
 * start times for vehicles running multiple legs.
 *
 * Read-mostly. Admin keeps "Copy to planner" + delete + inline vehicle
 * assignment from the list view; this surface is for the customer to scan
 * what's happening on a given day.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Icon from "@/components/portal/Icon";
import StatusPill from "@/components/portal/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { useNicknames } from "@/hooks/useNicknames";
import { withNickname } from "@/lib/postcode-nicknames";
import { listLoadsForDate } from "@/app/actions/loads";
import {
  deriveStatus,
  progressTuple,
  shortDate,
} from "@/lib/portal/loads";
import { todayISO } from "@/lib/time-utils";
import { isoWeekMonday, isoWeekNum, isoYear } from "@/lib/iso-week";
import { chainedEta, computeLoadChains } from "@/lib/portal/load-chains";
import type { PlannedRun } from "@/types/runs";

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

export default function CustomerLoadsDayPage() {
  const params = useParams<{ date: string }>();
  const date = params?.date ?? "";
  const { profile, loading: authLoading } = useAuth();
  const nicknames = useNicknames();

  const [loads, setLoads] = useState<PlannedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** The 7 dates of the ISO week containing `date`, Monday first. */
  const weekDates = useMemo(() => {
    if (!date) return [] as Array<{ label: string; date: string }>;
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const yr = isoYear(dt);
    const wk = isoWeekNum(dt);
    const monday = isoWeekMonday(yr, wk);
    const [my, mm, md] = monday.split("-").map(Number);
    return WEEKDAY_SHORT.map((label, idx) => {
      const day = new Date(Date.UTC(my, mm - 1, md + idx));
      const yyyy = day.getUTCFullYear();
      const mmStr = String(day.getUTCMonth() + 1).padStart(2, "0");
      const ddStr = String(day.getUTCDate()).padStart(2, "0");
      return { label, date: `${yyyy}-${mmStr}-${ddStr}` };
    });
  }, [date]);

  useEffect(() => {
    if (authLoading || !date) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      const res = await listLoadsForDate(date);
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
        setLoads([]);
      } else {
        setLoads(res.loads ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, date]);

  // Group loads by vehicle for the day. Loads with no vehicle yet form a
  // separate "Awaiting reg" group so the customer can see what's still being
  // assigned.
  const vehicleGroups = useMemo(() => {
    const withVehicle: Record<string, PlannedRun[]> = {};
    const noVehicle: PlannedRun[] = [];
    for (const r of loads) {
      const v = r.vehicle?.trim();
      if (!v) {
        noVehicle.push(r);
        continue;
      }
      if (!withVehicle[v]) withVehicle[v] = [];
      withVehicle[v].push(r);
    }
    // Sort within each vehicle group by run_order then start_time.
    for (const v of Object.keys(withVehicle)) {
      withVehicle[v].sort((a, b) => {
        if (a.runOrder != null && b.runOrder != null) return a.runOrder - b.runOrder;
        if (a.runOrder != null) return -1;
        if (b.runOrder != null) return 1;
        return (a.startTime ?? "").localeCompare(b.startTime ?? "");
      });
    }
    return {
      groups: Object.entries(withVehicle)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([vehicle, rows]) => ({ vehicle, rows })),
      noVehicle,
    };
  }, [loads]);

  const chains = useMemo(() => computeLoadChains(loads), [loads]);

  const today = todayISO();
  const isToday = date === today;
  const totalLoads = loads.length;
  const stackedVehicles = vehicleGroups.groups.filter((g) => g.rows.length > 1).length;

  return (
    <>
      <div className="page-header">
        <div>
          <Link href="/portal/loads" className="btn sm ghost" style={{ marginBottom: 6 }}>
            <Icon name="chevL" size={12} /> Back to all loads
          </Link>
          <h1 className="page-title">
            {isToday ? "Today" : longDate(date)}
          </h1>
          <div className="page-subtitle">
            {totalLoads} load{totalLoads === 1 ? "" : "s"}
            {stackedVehicles > 0 && (
              <>
                {" · "}
                {stackedVehicles} vehicle{stackedVehicles === 1 ? "" : "s"} with
                stacked loads
              </>
            )}
          </div>
        </div>
        <div className="row gap-8">
          <Link
            href={`/portal/loads/day/${shiftDate(date, -1)}`}
            className="btn"
            aria-label="Previous day"
          >
            <Icon name="chevL" size={13} />
          </Link>
          <Link
            href={`/portal/loads/day/${shiftDate(date, 1)}`}
            className="btn"
            aria-label="Next day"
          >
            <Icon name="chevR" size={13} />
          </Link>
          {!isToday && (
            <Link href={`/portal/loads/day/${today}`} className="btn">
              <Icon name="cal" size={13} /> Today
            </Link>
          )}
        </div>
      </div>

      {/* Mon-Sun nav for the week containing `date` */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ padding: 8 }}>
          <div className="row gap-4" style={{ flexWrap: "wrap" }}>
            {weekDates.map(({ label, date: d }) => {
              const active = d === date;
              const isTodayBadge = d === today;
              return (
                <Link
                  key={d}
                  href={`/portal/loads/day/${d}`}
                  className={`btn sm ${active ? "primary" : "ghost"}`}
                  style={{ minWidth: 64, justifyContent: "center" }}
                >
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                    <span style={{ fontWeight: 700 }}>{label}</span>
                    <span style={{ fontSize: 10.5, opacity: 0.8 }}>
                      {shortDate(d)}
                      {isTodayBadge && !active ? " · today" : ""}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>
            {error}
          </div>
        </div>
      )}

      {loading && (
        <div className="card">
          <div
            className="card-body"
            style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}
          >
            Loading loads…
          </div>
        </div>
      )}

      {!loading && totalLoads === 0 && !error && (
        <div className="card">
          <div
            className="card-body"
            style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}
          >
            No loads scheduled for {shortDate(date)}.
            {profile?.role === "admin" && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Bookings forwarded by email or submitted through Bookings will
                land here automatically.
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && totalLoads > 0 && (
        <div className="col gap-12">
          {vehicleGroups.groups.map(({ vehicle, rows }) => (
            <VehicleGroupCard
              key={vehicle}
              vehicle={vehicle}
              rows={rows}
              chains={chains}
              nicknames={nicknames}
              today={today}
            />
          ))}
          {vehicleGroups.noVehicle.length > 0 && (
            <VehicleGroupCard
              vehicle=""
              rows={vehicleGroups.noVehicle}
              chains={chains}
              nicknames={nicknames}
              today={today}
            />
          )}
        </div>
      )}
    </>
  );
}

function VehicleGroupCard({
  vehicle,
  rows,
  chains,
  nicknames,
  today,
}: {
  vehicle: string;
  rows: PlannedRun[];
  chains: ReturnType<typeof computeLoadChains>;
  nicknames: Record<string, string>;
  today: string;
}) {
  const stacked = rows.length > 1;
  return (
    <div className="card">
      <div className="card-header">
        <h3>
          {vehicle ? (
            <span className="mono">{vehicle}</span>
          ) : (
            <span style={{ color: "var(--ink-500)" }}>Awaiting registration</span>
          )}
        </h3>
        <span className="muted" style={{ fontSize: 11 }}>
          · {rows.length} load{rows.length === 1 ? "" : "s"}
          {stacked && (
            <>
              {" · stacked"}
              <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>
                (chained start times)
              </span>
            </>
          )}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Load</th>
              <th>Customer</th>
              <th>Route</th>
              <th>Start</th>
              <th>ETA</th>
              <th>Progress</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const chained = chains.get(r.id);
              const status = deriveStatus(r, today);
              const prog = progressTuple(r);
              const eta = chainedEta(r, chained);
              const fromName = withNickname(r.fromPostcode, nicknames);
              const toName = withNickname(r.toPostcode, nicknames);
              return (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/portal/loads/${r.id}`}
                      style={{
                        color: "inherit",
                        textDecoration: "none",
                        display: "block",
                      }}
                    >
                      <div className="bold mono" style={{ fontSize: 12 }}>
                        {r.jobNumber || r.id}
                      </div>
                      <div className="muted mono" style={{ fontSize: 10.5 }}>
                        {r.loadRef || "—"}
                      </div>
                    </Link>
                  </td>
                  <td style={{ fontSize: 12 }}>{r.customer}</td>
                  <td>
                    <div className="row gap-4" style={{ fontSize: 11.5 }}>
                      <span className="mono">{r.fromPostcode}</span>
                      <Icon name="arrowR" size={10} className="muted" />
                      <span className="mono">{r.toPostcode || "—"}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      {fromName} → {toName}
                    </div>
                  </td>
                  <td>
                    <div className="mono tnum" style={{ fontSize: 11.5 }}>
                      {chained?.chainedStartTime ?? r.startTime ?? "—"}
                    </div>
                    {chained && (
                      <div className="muted" style={{ fontSize: 10 }}>
                        booked {r.startTime}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="mono tnum" style={{ fontSize: 11.5 }}>
                      {status === "delivered" ? "—" : eta}
                    </div>
                  </td>
                  <td>
                    <div className="mono tnum" style={{ fontSize: 11 }}>
                      {prog.completed}/{prog.total}
                    </div>
                  </td>
                  <td>
                    <StatusPill status={status} />
                  </td>
                  <td>
                    <Link
                      href={`/portal/loads/${r.id}`}
                      className="btn sm ghost"
                      aria-label="Open load"
                    >
                      <Icon name="chevR" size={12} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
