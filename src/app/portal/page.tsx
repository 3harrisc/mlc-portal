"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";
import { todayISO } from "@/lib/time-utils";
import Icon from "@/components/portal/Icon";
import Sparkline from "@/components/portal/Sparkline";
import StatusPill from "@/components/portal/StatusPill";
import { usePortalData } from "@/components/portal/PortalDataContext";
import { quickEta } from "@/lib/portal/loads";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function todayLong(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const { enriched, counts, loading } = usePortalData();
  const today = todayISO();

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const account = profile?.allowed_customers?.[0] ?? "your account";

  const todays = useMemo(
    () => enriched.filter((r) => r.run.date === today).slice(0, 8),
    [enriched, today],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {greeting()}, {firstName}
          </h1>
          <div className="page-subtitle">
            Here&apos;s what&apos;s moving for {account} today · {todayLong()}
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn" type="button">
            <Icon name="cal" size={13} /> Last 7 days
          </button>
          <button className="btn" type="button">
            <Icon name="download" size={13} /> Export
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiTile
          icon="truck"
          label="In transit"
          value={loading ? "—" : String(counts.tracking)}
          unit="active"
        />
        <KpiTile
          icon="check"
          label="Delivered today"
          value={loading ? "—" : String(counts.deliveredToday)}
          unit={`/ ${counts.bookedToday} booked`}
          color="var(--ok)"
        />
        <KpiTile
          icon="clock"
          label="On-time rate"
          value="—"
          unit="%"
          color="var(--ok)"
          note="Needs ETA-vs-actual signal"
        />
        <KpiTile
          icon="bell"
          label="Exceptions"
          value={loading ? "—" : String(counts.exceptions)}
          unit="need action"
          color="var(--err)"
          danger
        />
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Today&apos;s loads</h3>
          <span className="muted" style={{ fontSize: 11 }}>
            {todays.length} of {counts.bookedToday} shown
          </span>
          <div className="actions">
            <Link href="/portal/loads" className="btn sm ghost">
              View all <Icon name="arrowR" size={11} />
            </Link>
          </div>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Load</th>
              <th>Route</th>
              <th>Vehicle</th>
              <th>ETA</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {todays.map(({ run, status }) => (
              <tr key={run.id}>
                <RowLink id={run.id}>
                  <div className="bold mono" style={{ fontSize: 12 }}>
                    {run.jobNumber || run.id}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {run.loadRef || "—"}
                  </div>
                </RowLink>
                <RowLink id={run.id}>
                  <div className="row gap-4">
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {run.fromPostcode}
                    </span>
                    <Icon name="arrowR" size={11} className="muted" />
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {run.toPostcode || "—"}
                    </span>
                  </div>
                </RowLink>
                <RowLink id={run.id}>
                  <div className="mono bold" style={{ fontSize: 11.5 }}>
                    {run.vehicle || "—"}
                  </div>
                </RowLink>
                <RowLink id={run.id}>
                  <span className="mono tnum">
                    {status === "delivered" ? "—" : quickEta(run)}
                  </span>
                </RowLink>
                <RowLink id={run.id}>
                  <StatusPill status={status} />
                </RowLink>
                <RowLink id={run.id}>
                  <Icon name="chevR" size={14} className="muted" />
                </RowLink>
              </tr>
            ))}
            {!loading && todays.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--ink-500)",
                    fontSize: 12.5,
                  }}
                >
                  No loads scheduled for today.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--ink-500)",
                    fontSize: 12.5,
                  }}
                >
                  Loading today&apos;s loads…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function KpiTile({
  icon,
  label,
  value,
  unit,
  color = "var(--mlc-blue)",
  danger,
  note,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
  unit?: string;
  color?: string;
  danger?: boolean;
  note?: string;
}) {
  return (
    <div className="kpi">
      <div
        className="kpi-label"
        style={danger ? { color: "var(--err)" } : undefined}
      >
        <Icon name={icon} size={12} /> {label}
      </div>
      <div className="kpi-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {note && (
        <div className="kpi-delta" style={{ color: "var(--ink-500)" }}>
          {note}
        </div>
      )}
      <Sparkline
        data={[12, 14, 13, 16, 15, 18, 16]}
        color={color}
      />
    </div>
  );
}

function RowLink({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <td>
      <Link
        href={`/portal/loads/${id}`}
        style={{
          color: "inherit",
          textDecoration: "none",
          display: "block",
        }}
      >
        {children}
      </Link>
    </td>
  );
}
