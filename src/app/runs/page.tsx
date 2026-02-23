"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { deleteRun as deleteRunAction } from "@/app/actions/runs";
import type { PlannedRun, CustomerKey } from "@/types/runs";
import { rowToRun } from "@/types/runs";
import { todayISO } from "@/lib/time-utils";
import { fetchCustomerNames } from "@/lib/customers";
import { parseStops } from "@/lib/postcode-utils";

function norm(s: string) {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isRunComplete(r: PlannedRun): boolean {
  const stops = parseStops(r.rawText);
  if (!stops.length) return false;
  const completed = r.completedStopIndexes ?? [];
  return completed.length >= stops.length;
}

function runMatchesSearch(r: PlannedRun, q: string) {
  const query = norm(q);
  if (!query) return true;
  if (norm(r.jobNumber).includes(query)) return true;
  if (norm(r.loadRef || "").includes(query)) return true;
  if (norm(r.vehicle).includes(query)) return true;
  if (norm(r.fromPostcode).includes(query)) return true;
  if (norm(r.toPostcode || "").includes(query)) return true;
  if (norm(r.rawText).includes(query)) return true;
  return false;
}

export default function RunsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const allowedCustomers = profile?.allowed_customers ?? [];
  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [date, setDate] = useState<string>(todayISO());
  const [customer, setCustomer] = useState<CustomerKey | "All">("All");
  const [vehicle, setVehicle] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [customerNames, setCustomerNames] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("runs")
      .select("*")
      .order("date", { ascending: true })
      .then(({ data }) => {
        setRuns((data ?? []).map(rowToRun));
        setLoading(false);
      });
    fetchCustomerNames().then(setCustomerNames);
  }, []);

  const vehicles = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => {
      if (r.vehicle?.trim()) set.add(r.vehicle.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [runs]);

  const filtered = useMemo(() => {
    return runs
      .filter((r) => isAdmin || allowedCustomers.includes(r.customer))
      .filter((r) => (date ? r.date === date : true))
      .filter((r) => (customer === "All" ? true : r.customer === customer))
      .filter((r) => (vehicle ? r.vehicle?.trim() === vehicle.trim() : true))
      .filter((r) => runMatchesSearch(r, search))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [runs, date, customer, vehicle, search, isAdmin, allowedCustomers]);

  const unassignedCount = useMemo(
    () => filtered.filter((r) => !r.vehicle?.trim()).length,
    [filtered]
  );

  async function handleDelete(id: string) {
    setRuns((prev) => prev.filter((r) => r.id !== id));
    await deleteRunAction(id);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Runs</h1>
            <div className="text-sm text-gray-400 mt-1">
              {unassignedCount > 0 ? (
                <span className="text-yellow-300 font-semibold">
                  {unassignedCount} unassigned run{unassignedCount === 1 ? "" : "s"} in this view
                </span>
              ) : (
                <span>All runs assigned (in this view)</span>
              )}
            </div>
          </div>
          <Link href="/plan-route" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500">
            + Plan a route
          </Link>
        </div>

        {/* Filters */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Customer</label>
            <select
              value={customer}
              onChange={(e) => setCustomer(e.target.value as CustomerKey | "All")}
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
            >
              <option value="All" className="bg-black">All</option>
              {customerNames.map((c) => (
                <option key={c} value={c} className="bg-black">{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Vehicle</label>
            <select
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
            >
              <option value="" className="bg-black">All</option>
              {vehicles.map((v) => (
                <option key={v} value={v} className="bg-black">{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Job, ref, postcode..."
              className="w-full border border-white/15 rounded-lg px-3 py-2 bg-transparent"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={() => {
                setCustomer("All");
                setVehicle("");
                setDate(todayISO());
                setSearch("");
              }}
              className="w-full px-4 py-2 rounded-lg border border-white/15 hover:bg-white/10"
            >
              Reset filters
            </button>
          </div>
        </div>

        {/* Runs list */}
        <div className="mt-6 border border-white/10 rounded-2xl p-4 bg-white/5">
          {loading ? (
            <div className="text-gray-400">Loading runs...</div>
          ) : filtered.length === 0 ? (
            <div className="text-gray-400">
              No runs found. Create one in <Link className="text-blue-400 underline" href="/plan-route">Plan Route</Link>.
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((r) => {
                const complete = isRunComplete(r);
                return (
                <div key={r.id} className={`border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap ${complete ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10"}`}>
                  <div>
                    <div className="font-semibold text-lg">
                      {r.jobNumber} • {r.date} • {r.customer}
                      {complete ? (
                        <>
                          {r.vehicle?.trim() && <span className="ml-2 text-gray-300 text-sm">{r.vehicle}</span>}
                          <span className="ml-2 text-emerald-400 text-sm font-semibold">COMPLETE</span>
                        </>
                      ) : !r.vehicle?.trim() ? (
                        <span className="ml-2 text-yellow-300 text-sm font-semibold">UNASSIGNED</span>
                      ) : (
                        <span className="ml-2 text-gray-300 text-sm">{r.vehicle}</span>
                      )}
                      {r.loadRef && (
                        <span className="ml-2 text-blue-300 text-sm font-medium">Ref: {r.loadRef}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      From {r.fromPostcode} • {r.returnToBase ? "Return to base" : (r.toPostcode ? `To ${r.toPostcode}` : "End at last drop")} •
                      Start {r.startTime} • Service {r.serviceMins}m • Breaks {r.includeBreaks ? "On" : "Off"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/runs/${r.id}`} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500">
                      Open
                    </Link>
                    <button onClick={() => handleDelete(r.id)} className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10">
                      Delete
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
