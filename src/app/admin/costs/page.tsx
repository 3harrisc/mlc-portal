"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import { listAllCosts } from "@/app/actions/costs";
import { COST_CATEGORIES, formatPence } from "@/types/costs";
import type { CostCategory } from "@/types/costs";
import { createClient } from "@/lib/supabase/client";

interface CostRow {
  id: string;
  driver_id: string;
  run_id: string | null;
  vehicle: string;
  date: string;
  category: CostCategory;
  amount: number;
  note: string;
  receipt_url: string | null;
  created_at: string;
  profiles: {
    email: string;
    full_name: string | null;
    assigned_vehicle: string | null;
  } | null;
}

function getMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function getSunday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export default function AdminCostsPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(getMonday);
  const [dateTo, setDateTo] = useState(getSunday);
  const [driverFilter, setDriverFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  const loadCosts = React.useCallback(async () => {
    setLoading(true);
    const result = await listAllCosts(dateFrom, dateTo);
    if (!result.error) setCosts(result.costs as CostRow[]);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    queueMicrotask(() => { loadCosts(); });
  }, [profile, loadCosts]);

  const drivers = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of costs) {
      if (c.profiles) map.set(c.driver_id, c.profiles.full_name || c.profiles.email);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [costs]);

  const filtered = useMemo(() => {
    return costs
      .filter((c) => (!driverFilter ? true : c.driver_id === driverFilter))
      .filter((c) => (!categoryFilter ? true : c.category === categoryFilter));
  }, [costs, driverFilter, categoryFilter]);

  const totals = useMemo(() => {
    const map: Record<string, number> = {};
    let grand = 0;
    for (const c of filtered) {
      map[c.category] = (map[c.category] ?? 0) + c.amount;
      grand += c.amount;
    }
    return { byCategory: map, grand };
  }, [filtered]);

  const groupedByDriver = useMemo(() => {
    const map = new Map<string, { driverName: string; vehicle: string; costs: CostRow[]; total: number }>();
    for (const c of filtered) {
      const key = c.driver_id;
      if (!map.has(key)) {
        map.set(key, {
          driverName: c.profiles?.full_name || c.profiles?.email || "Unknown",
          vehicle: c.profiles?.assigned_vehicle || c.vehicle || "",
          costs: [], total: 0,
        });
      }
      const group = map.get(key)!;
      group.costs.push(c);
      group.total += c.amount;
    }
    return Array.from(map.values()).sort((a, b) => a.driverName.localeCompare(b.driverName));
  }, [filtered]);

  async function viewReceipt(path: string) {
    const supabase = createClient();
    const { data } = await supabase.storage.from("receipts").createSignedUrl(path, 300);
    if (data?.signedUrl) setReceiptUrl(data.signedUrl);
  }

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Driver expenses</h1>
          <div className="page-subtitle">
            Per-driver receipts (fuel, parking, etc.). Fleet-level fixed costs live in{" "}
            <Link href="/portal/figures" style={{ color: "var(--mlc-blue)" }}>Figures</Link>.
          </div>
        </div>
        <button type="button" className="btn sm" onClick={() => void loadCosts()} disabled={loading}>
          <Icon name="refresh" size={11} /> {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Per-category totals */}
      <div className="kpi-grid" style={{ gridTemplateColumns: `repeat(${COST_CATEGORIES.length + 1}, 1fr)` }}>
        {COST_CATEGORIES.map((cat) => (
          <div key={cat.value} className="kpi">
            <div className="kpi-label">{cat.label}</div>
            <div className="kpi-value">{formatPence(totals.byCategory[cat.value] ?? 0)}</div>
          </div>
        ))}
        <div className="kpi" style={{ borderColor: "var(--ok)" }}>
          <div className="kpi-label" style={{ color: "var(--ok)" }}>Total</div>
          <div className="kpi-value" style={{ color: "var(--ok)" }}>{formatPence(totals.grand)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div className="field">
              <label>From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input" />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input" />
            </div>
            <div className="field">
              <label>Driver</label>
              <select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} className="select">
                <option value="">All drivers</option>
                {drivers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Category</label>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="select">
                <option value="">All categories</option>
                {COST_CATEGORIES.map((cat) => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {loading && costs.length === 0 ? (
        <div className="muted">Loading expenses…</div>
      ) : groupedByDriver.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
            No expenses found for this period.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groupedByDriver.map((group) => (
            <div key={group.driverName} className="card">
              <div className="card-header">
                <h3>{group.driverName}</h3>
                {group.vehicle && (
                  <span className="pill scheduled mono"><span className="dot" />{group.vehicle}</span>
                )}
                <span className="spacer" />
                <span className="bold mono tnum" style={{ color: "var(--ok)" }}>
                  {formatPence(group.total)}
                </span>
              </div>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Date</th>
                    <th style={{ width: 100 }}>Category</th>
                    <th className="right" style={{ width: 110 }}>Amount</th>
                    <th>Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.costs.map((c) => (
                    <tr key={c.id} style={{ cursor: "default" }}>
                      <td className="mono">
                        {new Date(c.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </td>
                      <td>
                        <span className="pill scheduled" style={{ textTransform: "uppercase" }}>{c.category}</span>
                      </td>
                      <td className="right mono tnum bold">{formatPence(c.amount)}</td>
                      <td className="muted">{c.note}</td>
                      <td className="right">
                        {c.receipt_url && (
                          <button type="button" className="btn sm ghost" onClick={() => void viewReceipt(c.receipt_url!)}>
                            <Icon name="eye" size={11} /> Receipt
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {receiptUrl && (
        <div
          className="receipt-modal"
          onClick={() => setReceiptUrl(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div style={{ position: "relative", maxWidth: 600, maxHeight: "85vh" }}>
            <button
              type="button"
              onClick={() => setReceiptUrl(null)}
              className="btn sm"
              style={{ position: "absolute", top: -16, right: -16 }}
            >
              <Icon name="x" size={11} /> Close
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptUrl}
              alt="Receipt"
              style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 8, objectFit: "contain", background: "#fff" }}
            />
          </div>
        </div>
      )}
    </>
  );
}
