"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import { listDriverRecords } from "@/app/actions/hr-drivers";
import { listHrOverview, type HrOverview } from "@/app/actions/hr";
import { driverDocumentViews } from "@/lib/hr/status";
import { hasFullCategory, licenceFlags } from "@/lib/hr/licence";
import { ukDate } from "@/lib/hr/format";
import { driverName, type DriverRecord } from "@/types/hr-drivers";

const STATUS = { starter: ["New starter", "scheduled"], active: ["Active", "delivered"], left: ["Left", "loading"] } as const;

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
}

export default function DriverRecordsPage() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [drivers, setDrivers] = useState<DriverRecord[] | null>(null);
  const [overview, setOverview] = useState<HrOverview | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && profile?.role !== "admin") router.push("/");
  }, [loading, profile, router]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    Promise.all([listDriverRecords(), listHrOverview()]).then(([d, o]) => {
      if (d.error) setError(d.error);
      setDrivers(d.drivers ?? []);
      setOverview(o.data ?? null);
    });
  }, [profile]);

  const rows = useMemo(() => {
    const now = new Date();
    return (drivers ?? [])
      .filter((d) => showLeft || d.status !== "left")
      .map((d) => {
        const views = d.profileId && overview
          ? driverDocumentViews(d.profileId, overview.documents, overview.assignments, overview.signatures, now)
          : [];
        const todo = views.filter((v) => v.status !== "signed").length;
        const flags = d.licence ? licenceFlags(d.licence) : [];
        return { d, views, todo, flags };
      });
  }, [drivers, overview, showLeft]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Driver records</h1>
          <div className="page-subtitle">Each driver&apos;s details, licence, files and documents in one place</div>
        </div>
        <Link className="btn primary" href="/admin/hr/drivers/new">
          <Icon name="plus" size={13} /> Add driver
        </Link>
      </div>
      {error && <div className="card" style={{ marginBottom: 12, color: "var(--err)" }}><div className="card-body">{error}</div></div>}
      <div className="table-wrap">
        <div className="table-toolbar">
          <label className="row gap-4" style={{ fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> Show leavers
          </label>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 11.5 }}>{rows.length} driver{rows.length === 1 ? "" : "s"}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr><th>Driver</th><th>Status</th><th>Start date</th><th>Licence</th><th>Last licence check</th><th>Documents</th></tr>
            </thead>
            <tbody>
              {rows.map(({ d, views, todo, flags }) => {
                const [label, cls] = STATUS[d.status];
                const worst = flags.find((f) => f.level === "danger") ?? flags.find((f) => f.level === "warn");
                return (
                  <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/admin/hr/drivers/${d.id}`)}>
                    <td>
                      <div className="bold" style={{ fontSize: 12.5 }}>{driverName(d)}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{d.profileId ? "Portal login linked" : "No portal login"}</div>
                    </td>
                    <td><span className={`pill ${cls}`}><span className="dot" />{label}</span></td>
                    <td className="mono tnum" style={{ fontSize: 11.5 }}>{d.startDate ? ukDate(d.startDate) : "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {d.licence ? (
                        <>
                          <span>{hasFullCategory(d.licence, "CE") ? "C+E" : hasFullCategory(d.licence, "C") ? "C only" : "No HGV"} · {d.licence.total_points} pts</span>
                          {worst && <div style={{ fontSize: 10.5, color: worst.level === "danger" ? "var(--err)" : "var(--warn)" }}>{worst.message}</div>}
                        </>
                      ) : <span className="muted">No check yet</span>}
                    </td>
                    <td className="mono tnum" style={{ fontSize: 11.5 }}>
                      {d.licenceCheckedOn ? `${ukDate(d.licenceCheckedOn)} (${daysAgo(d.licenceCheckedOn)}d ago)` : "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {!d.profileId ? <span className="muted">Link a login</span>
                        : views.length === 0 ? <span className="muted">None sent</span>
                        : todo === 0 ? <span style={{ color: "var(--ok)" }}>All signed ({views.length})</span>
                        : <span style={{ color: "var(--warn)" }}>{todo} of {views.length} outstanding</span>}
                    </td>
                  </tr>
                );
              })}
              {drivers && rows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)", fontSize: 12.5 }}>
                  No driver records yet. Click <b>Add driver</b> and drop in their AssetGo licence check.
                </td></tr>
              )}
              {!drivers && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)", fontSize: 12.5 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
