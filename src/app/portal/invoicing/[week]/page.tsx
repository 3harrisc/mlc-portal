"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Icon from "@/components/portal/Icon";
import { useAuth } from "@/components/AuthProvider";
import {
  listRunsForWeek,
  setRunBillingFields,
  unexportRun,
} from "@/app/actions/invoicing";
import type { PlannedRun, InvoiceStatus } from "@/types/runs";
import { isoWeekNum, isoYear } from "@/lib/iso-week";
import { compareByCustomer } from "@/lib/planner/customer-order";

interface RouteParams {
  week: string;
}

// ── Sortable columns (matches the table headers below). ─────────────
type SortColumn =
  | "date"
  | "jobNumber"
  | "customer"
  | "fromTo"
  | "vehicle"
  | "loadRef"
  | "revenue"
  | "status"
  | "invoice";

type SortDir = "asc" | "desc";

interface SortState {
  column: SortColumn | null;
  dir: SortDir;
}

function columnValue(r: PlannedRun, col: SortColumn): string | number {
  switch (col) {
    case "date":      return r.date;
    case "jobNumber": return r.jobNumber ?? "";
    case "customer":  return r.customer ?? "";
    case "fromTo":    return `${r.fromPostcode ?? ""} ${r.toPostcode ?? ""}`;
    case "vehicle":   return r.vehicle ?? "";
    case "loadRef":   return r.loadRef ?? "";
    case "revenue":   return r.revenue ?? 0;
    case "status":    return r.invoiceStatus ?? "open";
    case "invoice":   return r.xeroInvoiceId ?? "";
  }
}

/** Default sort: customer priority → date → vehicle. */
function defaultCompare(a: PlannedRun, b: PlannedRun): number {
  const c = compareByCustomer(a.customer ?? "", b.customer ?? "");
  if (c !== 0) return c;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.vehicle ?? "").localeCompare(b.vehicle ?? "");
}

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

function statusToPillClass(s: InvoiceStatus): string {
  switch (s) {
    case "sent": return "in-transit";
    case "paid": return "delivered";
    case "billable": return "loading";
    case "cancelled": return "scheduled";
    default: return "scheduled";
  }
}

export default function InvoicingWeekPage() {
  const params = useParams<RouteParams & Record<string, string>>();
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";

  const { year, week } = useMemo(
    () => parseWeekParam(String(params?.week ?? "current")),
    [params?.week]
  );

  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<"template" | "lite">("template");
  const [customerFilter, setCustomerFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | InvoiceStatus>("All");
  const [sort, setSort] = useState<SortState>({ column: null, dir: "asc" });

  /** Toggle / cycle sort on a column header click. */
  function onSortClick(col: SortColumn) {
    setSort((prev) => {
      if (prev.column !== col) return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: col, dir: "desc" };
      return { column: null, dir: "asc" };   // 3rd click clears
    });
  }

  useEffect(() => {
    if (!authLoading && !isAdmin) router.push("/");
  }, [authLoading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, year, week]);

  async function loadRuns() {
    setLoading(true);
    setError("");
    const result = await listRunsForWeek(year, week);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setRuns(result.runs ?? []);
    setLoading(false);
  }

  async function toggleBillable(run: PlannedRun) {
    const next = !(run.billable ?? false);
    setRuns((curr) => curr.map((r) => (r.id === run.id ? { ...r, billable: next } : r)));
    const res = await setRunBillingFields(run.id, {
      billable: next,
      invoiceStatus:
        next && (run.invoiceStatus ?? "open") === "open" ? "billable" : run.invoiceStatus,
    });
    if (res.error) {
      setError(res.error);
      void loadRuns();
    }
  }

  async function setRevenue(run: PlannedRun, revenue: number) {
    setRuns((curr) => curr.map((r) => (r.id === run.id ? { ...r, revenue } : r)));
    const res = await setRunBillingFields(run.id, { revenue });
    if (res.error) {
      setError(res.error);
      void loadRuns();
    }
  }

  async function setLoadRef(run: PlannedRun, loadRef: string) {
    setRuns((curr) => curr.map((r) => (r.id === run.id ? { ...r, loadRef } : r)));
    const res = await setRunBillingFields(run.id, { loadRef });
    if (res.error) {
      setError(res.error);
      void loadRuns();
    }
  }

  async function handleUnexport(run: PlannedRun) {
    if (!confirm(`Un-export ${run.jobNumber}? It will become billable again and the Xero invoice ID will be cleared.`)) return;
    const res = await unexportRun(run.id);
    if (res.error) {
      setError(res.error);
      return;
    }
    void loadRuns();
  }

  async function downloadCsv(commit: boolean) {
    setBusy(true);
    setError("");
    try {
      const url = `/api/xero/export?week=${week}&year=${year}&layout=${layout}&commit=${commit}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const filename =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        `Xero_W${week}_${year}.csv`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      if (commit) void loadRuns();
    } finally {
      setBusy(false);
    }
  }

  // Unique customer list for the filter dropdown (alpha + priority order
  // already enforced via compareByCustomer at sort time).
  const uniqueCustomers = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) if (r.customer?.trim()) set.add(r.customer.trim());
    return Array.from(set).sort(compareByCustomer);
  }, [runs]);

  // Filtered + sorted display set.
  const displayedRuns = useMemo(() => {
    let out = runs;
    if (customerFilter !== "All") {
      out = out.filter((r) => r.customer === customerFilter);
    }
    if (statusFilter !== "All") {
      out = out.filter((r) => (r.invoiceStatus ?? "open") === statusFilter);
    }
    const compare = sort.column
      ? (a: PlannedRun, b: PlannedRun) => {
          const av = columnValue(a, sort.column!);
          const bv = columnValue(b, sort.column!);
          if (typeof av === "number" && typeof bv === "number") {
            return sort.dir === "asc" ? av - bv : bv - av;
          }
          const cmp = String(av).localeCompare(String(bv));
          return sort.dir === "asc" ? cmp : -cmp;
        }
      : defaultCompare;
    return [...out].sort(compare);
  }, [runs, customerFilter, statusFilter, sort]);

  const billableRuns = runs.filter((r) => r.billable === true);
  const sentRuns = runs.filter((r) => r.invoiceStatus === "sent");
  const totalBillable = billableRuns
    .filter((r) => r.invoiceStatus !== "sent" && r.invoiceStatus !== "paid" && r.invoiceStatus !== "cancelled")
    .reduce((sum, r) => sum + (r.revenue ?? 0), 0);
  const totalSent = sentRuns.reduce((sum, r) => sum + (r.revenue ?? 0), 0);

  if (authLoading || !isAdmin) {
    return <div className="muted">Loading…</div>;
  }

  // Last 12 weeks
  const weekOptions: Array<{ label: string; value: string }> = [];
  const today = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i * 7));
    const w = isoWeekNum(d);
    const y = isoYear(d);
    weekOptions.push({
      label: `WK${String(w).padStart(2, "0")}_${String(y).slice(2)}`,
      value: `${w}-${y}`,
    });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoicing · Week {week}, {year}</h1>
          <div className="page-subtitle">
            Mark legs as billable, set the £ amount, then generate a Xero CSV.
          </div>
        </div>
        <div className="row gap-8">
          <Link href={`/portal/planner/week/${week}-${year}`} className="btn sm">
            <Icon name="chevL" size={11} /> Planner
          </Link>
          <Link href={`/portal/figures/${week}-${year}`} className="btn sm">
            <Icon name="chart" size={11} /> Figures
          </Link>
          <select
            value={`${week}-${year}`}
            onChange={(e) => router.push(`/portal/invoicing/${e.target.value}`)}
            className="select"
            style={{ height: 32, fontSize: 12.5, padding: "0 10px" }}
          >
            {weekOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={layout}
            onChange={(e) => setLayout(e.target.value as "template" | "lite")}
            className="select"
            style={{ height: 32, fontSize: 12.5, padding: "0 10px" }}
          >
            <option value="template">Template (29 cols)</option>
            <option value="lite">Lite (10 cols)</option>
          </select>
          <button
            type="button"
            className="btn sm"
            disabled={busy || billableRuns.length === 0}
            onClick={() => downloadCsv(false)}
          >
            <Icon name="eye" size={11} /> Preview
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || billableRuns.length === 0}
            onClick={() => {
              if (confirm(`Generate Xero CSV for ${billableRuns.length} billable rows? Invoice numbers will be reserved and rows marked as Sent.`)) {
                void downloadCsv(true);
              }
            }}
          >
            <Icon name="download" size={11} /> Generate CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat-cell">
          <div className="l">Total runs</div>
          <div className="v">{runs.length}</div>
        </div>
        <div className="stat-cell">
          <div className="l">Billable (open)</div>
          <div className="v mono tnum">£{totalBillable.toFixed(2)}</div>
        </div>
        <div className="stat-cell">
          <div className="l">Already sent</div>
          <div className="v mono tnum">£{totalSent.toFixed(2)}</div>
        </div>
        <div className="stat-cell">
          <div className="l">Last invoice #</div>
          <div className="v mono">{sentRuns[0]?.xeroInvoiceId ?? "—"}</div>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading runs…</div>
      ) : runs.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
            No runs in this week.{" "}
            <Link href="/portal/planner" style={{ color: "var(--mlc-blue)" }}>Add some on the planner →</Link>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-toolbar">
            <div className="row gap-8">
              <span className="muted" style={{ fontSize: 11 }}>Customer</span>
              <select
                className="select"
                style={{ height: 30, fontSize: 12 }}
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
              >
                <option value="All">All ({runs.length})</option>
                {uniqueCustomers.map((c) => {
                  const n = runs.filter((r) => r.customer === c).length;
                  return <option key={c} value={c}>{c} ({n})</option>;
                })}
              </select>
              <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Status</span>
              <select
                className="select"
                style={{ height: 30, fontSize: 12 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "All" | InvoiceStatus)}
              >
                <option value="All">All</option>
                <option value="open">Open</option>
                <option value="billable">Billable</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
              {(customerFilter !== "All" || statusFilter !== "All" || sort.column) && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => {
                    setCustomerFilter("All");
                    setStatusFilter("All");
                    setSort({ column: null, dir: "asc" });
                  }}
                >
                  <Icon name="x" size={11} /> Reset
                </button>
              )}
            </div>
            <span className="spacer" />
            <span className="muted mono" style={{ fontSize: 11 }}>
              {displayedRuns.length} of {runs.length}
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ minWidth: 1200 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "center" }}>Bill?</th>
                  <SortHeader col="date"      label="Date"        sort={sort} onClick={onSortClick} />
                  <SortHeader col="jobNumber" label="Job"         sort={sort} onClick={onSortClick} />
                  <SortHeader col="customer"  label="Customer"    sort={sort} onClick={onSortClick} />
                  <SortHeader col="fromTo"    label="From → To"   sort={sort} onClick={onSortClick} />
                  <SortHeader col="vehicle"   label="Vehicle"     sort={sort} onClick={onSortClick} />
                  <SortHeader col="loadRef"   label="Load Ref"    sort={sort} onClick={onSortClick} />
                  <SortHeader col="revenue"   label="Revenue"     align="right" sort={sort} onClick={onSortClick} />
                  <SortHeader col="status"    label="Status"      sort={sort} onClick={onSortClick} />
                  <SortHeader col="invoice"   label="Invoice #"   sort={sort} onClick={onSortClick} />
                  <th />
                </tr>
              </thead>
              <tbody>
                {displayedRuns.map((r) => {
                  const status = r.invoiceStatus ?? "open";
                  const isLocked = status === "sent" || status === "paid";
                  return (
                    <tr key={r.id} style={{ cursor: "default" }}>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className={`cb ${r.billable ? "checked" : ""}`}
                          disabled={isLocked}
                          onClick={() => void toggleBillable(r)}
                          style={{ opacity: isLocked ? 0.4 : 1, cursor: isLocked ? "not-allowed" : "pointer" }}
                        >
                          {r.billable && <Icon name="check" size={10} />}
                        </button>
                      </td>
                      <td className="mono">{r.date}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{r.jobNumber}</td>
                      <td>{r.customer}</td>
                      <td>
                        <span className="mono" style={{ fontSize: 11.5 }}>{r.fromPostcode}</span>
                        <Icon name="arrowR" size={10} className="muted" style={{ margin: "0 6px" }} />
                        <span className="mono" style={{ fontSize: 11.5 }}>{r.toPostcode || "—"}</span>
                      </td>
                      <td className="mono bold">{r.vehicle || "—"}</td>
                      <td>
                        <input
                          type="text"
                          defaultValue={r.loadRef ?? ""}
                          disabled={isLocked}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (r.loadRef ?? "")) void setLoadRef(r, v);
                          }}
                          placeholder="—"
                          className="input mono"
                          style={{ height: 26, padding: "0 8px", fontSize: 11.5, width: 100 }}
                        />
                      </td>
                      <td className="right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={(r.revenue ?? 0).toFixed(2)}
                          disabled={isLocked}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n !== (r.revenue ?? 0)) void setRevenue(r, n);
                          }}
                          className="input mono tnum"
                          style={{ height: 26, padding: "0 8px", fontSize: 11.5, textAlign: "right", width: 90 }}
                        />
                      </td>
                      <td>
                        <span className={`pill ${statusToPillClass(status)}`}>
                          <span className="dot" />{status}
                        </span>
                      </td>
                      <td className="mono muted" style={{ fontSize: 11 }}>
                        {r.xeroInvoiceId ?? ""}
                      </td>
                      <td>
                        {status === "sent" && (
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => void handleUnexport(r)}
                            style={{ color: "var(--warn)" }}
                          >
                            <Icon name="refresh" size={11} /> Un-export
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

interface SortHeaderProps {
  col: SortColumn;
  label: string;
  align?: "left" | "right";
  sort: SortState;
  onClick: (col: SortColumn) => void;
}

function SortHeader({ col, label, align = "left", sort, onClick }: SortHeaderProps) {
  const isActive = sort.column === col;
  const arrow = !isActive ? "↕" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <th
      className={`sortable ${align === "right" ? "right" : ""}`}
      onClick={() => onClick(col)}
      title={`Sort by ${label}`}
    >
      {label}
      <span
        className="sort-arrow"
        style={{ opacity: isActive ? 1 : 0.4, fontWeight: isActive ? 700 : 400 }}
      >
        {arrow}
      </span>
    </th>
  );
}
