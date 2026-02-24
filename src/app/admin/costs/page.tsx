"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { listAllCosts } from "@/app/actions/costs";
import { COST_CATEGORIES, formatPence } from "@/types/costs";
import type { CostCategory } from "@/types/costs";
import { createClient } from "@/lib/supabase/client";

type CostRow = {
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
};

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
    if (!authLoading && profile?.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, profile, router]);

  async function loadCosts() {
    setLoading(true);
    const result = await listAllCosts(dateFrom, dateTo);
    if (!result.error) {
      setCosts(result.costs as CostRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (profile?.role === "admin") {
      loadCosts();
    }
  }, [profile, dateFrom, dateTo]);

  // Unique drivers for filter dropdown
  const drivers = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of costs) {
      if (c.profiles) {
        map.set(c.driver_id, c.profiles.full_name || c.profiles.email);
      }
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1])
    );
  }, [costs]);

  // Filter costs
  const filtered = useMemo(() => {
    return costs
      .filter((c) => (!driverFilter ? true : c.driver_id === driverFilter))
      .filter((c) => (!categoryFilter ? true : c.category === categoryFilter));
  }, [costs, driverFilter, categoryFilter]);

  // Summary totals by category
  const totals = useMemo(() => {
    const map: Record<string, number> = {};
    let grand = 0;
    for (const c of filtered) {
      map[c.category] = (map[c.category] ?? 0) + c.amount;
      grand += c.amount;
    }
    return { byCategory: map, grand };
  }, [filtered]);

  // Group by driver
  const groupedByDriver = useMemo(() => {
    const map = new Map<
      string,
      {
        driverName: string;
        vehicle: string;
        costs: CostRow[];
        total: number;
      }
    >();

    for (const c of filtered) {
      const key = c.driver_id;
      if (!map.has(key)) {
        map.set(key, {
          driverName:
            c.profiles?.full_name || c.profiles?.email || "Unknown",
          vehicle: c.profiles?.assigned_vehicle || c.vehicle || "",
          costs: [],
          total: 0,
        });
      }
      const group = map.get(key)!;
      group.costs.push(c);
      group.total += c.amount;
    }

    return Array.from(map.values()).sort((a, b) =>
      a.driverName.localeCompare(b.driverName)
    );
  }, [filtered]);

  async function viewReceipt(path: string) {
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("receipts")
      .createSignedUrl(path, 300);
    if (data?.signedUrl) {
      setReceiptUrl(data.signedUrl);
    }
  }

  if (authLoading || profile?.role !== "admin") {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navigation />
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-xl md:text-3xl font-bold">Cost Overview</h1>
            <p className="text-sm text-gray-400 mt-1">
              {dateFrom} &mdash; {dateTo}
            </p>
          </div>
          <button
            onClick={loadCosts}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          {COST_CATEGORIES.map((cat) => (
            <div
              key={cat.value}
              className="border border-white/10 bg-white/5 rounded-xl p-3 text-center"
            >
              <div className="text-lg font-bold text-white">
                {formatPence(totals.byCategory[cat.value] ?? 0)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{cat.label}</div>
            </div>
          ))}
          <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-emerald-400">
              {formatPence(totals.grand)}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">Total</div>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Driver</label>
            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" className="bg-black">
                All Drivers
              </option>
              {drivers.map(([id, name]) => (
                <option key={id} value={id} className="bg-black">
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Category
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" className="bg-black">
                All Categories
              </option>
              {COST_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value} className="bg-black">
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Costs grouped by driver */}
        {loading && costs.length === 0 ? (
          <p className="text-gray-400">Loading costs...</p>
        ) : groupedByDriver.length === 0 ? (
          <div className="text-gray-400 py-8 text-center">
            No costs found for this period.
          </div>
        ) : (
          <div className="space-y-4">
            {groupedByDriver.map((group) => (
              <div
                key={group.driverName}
                className="border border-white/10 rounded-xl bg-white/5 overflow-hidden"
              >
                {/* Driver header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                  <div>
                    <span className="font-semibold">{group.driverName}</span>
                    {group.vehicle && (
                      <span className="ml-2 text-xs font-mono px-2 py-0.5 rounded bg-white/10 text-gray-300">
                        {group.vehicle}
                      </span>
                    )}
                  </div>
                  <span className="font-semibold text-emerald-400">
                    {formatPence(group.total)}
                  </span>
                </div>

                {/* Cost rows */}
                <div className="divide-y divide-white/5">
                  {group.costs.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-gray-500 w-14 shrink-0">
                          {new Date(c.date + "T00:00:00").toLocaleDateString(
                            "en-GB",
                            { day: "numeric", month: "short" }
                          )}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white/10 text-gray-300 uppercase w-16 text-center shrink-0">
                          {c.category}
                        </span>
                        <span className="font-semibold w-16 text-right shrink-0">
                          {formatPence(c.amount)}
                        </span>
                        {c.note && (
                          <span className="text-gray-500 truncate">
                            {c.note}
                          </span>
                        )}
                      </div>
                      {c.receipt_url && (
                        <button
                          onClick={() => viewReceipt(c.receipt_url!)}
                          className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
                        >
                          View Receipt
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Receipt modal */}
      {receiptUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setReceiptUrl(null)}
        >
          <div className="relative max-w-lg max-h-[80vh]">
            <button
              onClick={() => setReceiptUrl(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white/20 text-white flex items-center justify-center text-lg hover:bg-white/30"
            >
              &times;
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptUrl}
              alt="Receipt"
              className="max-w-full max-h-[80vh] rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
