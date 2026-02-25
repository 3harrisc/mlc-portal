"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { deleteRun as deleteRunAction, updateRunOrders } from "@/app/actions/runs";
import type { PlannedRun, CustomerKey } from "@/types/runs";
import { rowToRun } from "@/types/runs";
import { todayISO } from "@/lib/time-utils";
import { fetchCustomerNames } from "@/lib/customers";
import { parseStops } from "@/lib/postcode-utils";
import { useNicknames } from "@/hooks/useNicknames";
import { withNickname } from "@/lib/postcode-nicknames";
import { computeChainedStarts } from "@/lib/runDuration";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function norm(s: string) {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isRunComplete(r: PlannedRun): boolean {
  const stops = parseStops(r.rawText);
  if (!stops.length) return false;
  const fromIndexes = (r.completedStopIndexes ?? []).length;
  const fromProgress = (r.progress?.completedIdx ?? []).length;
  return Math.max(fromIndexes, fromProgress) >= stops.length;
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

function getInitialDate(): string {
  if (typeof window === "undefined") return todayISO();
  const params = new URLSearchParams(window.location.search);
  return params.get("date") || todayISO();
}

// ── Sortable run card for drag-and-drop within a vehicle group ───────

function SortableRunCard({
  run,
  index,
  groupSize,
  isAdmin,
  nicknames,
  chainedStartTime,
  onDelete,
}: {
  run: PlannedRun;
  index: number;
  groupSize: number;
  isAdmin: boolean;
  nicknames: Record<string, string>;
  chainedStartTime?: string;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: run.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const complete = isRunComplete(run);
  const stops = parseStops(run.rawText);
  const completedCount = Math.max(
    (run.completedStopIndexes ?? []).length,
    (run.progress?.completedIdx ?? []).length
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap ${
        complete ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {isAdmin && groupSize > 1 && (
          <button
            className="w-8 h-8 rounded-lg border border-white/10 bg-black/30 flex items-center justify-center cursor-grab shrink-0 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            ☰
          </button>
        )}
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center font-semibold text-sm shrink-0">
          {index + 1}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-lg">
            {run.jobNumber} • {run.customer}
            {run.runType === "backload" && (
              <span className="ml-2 text-purple-400 text-sm font-semibold">BACKLOAD</span>
            )}
            {complete && (
              <span className="ml-2 text-emerald-400 text-sm font-semibold">COMPLETE</span>
            )}
            {run.loadRef && (
              <span className="ml-2 text-blue-300 text-sm font-medium">Ref: {run.loadRef}</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {run.runType === "backload" ? (
              <>Collection: {withNickname(run.fromPostcode, nicknames)}{run.collectionTime && ` @ ${run.collectionTime}`}</>
            ) : (
              <>From {withNickname(run.fromPostcode, nicknames)} • {run.returnToBase ? "Return to base" : "End at last drop"}</>
            )}
            {" "}• Start {chainedStartTime || run.startTime}
            {chainedStartTime && chainedStartTime !== run.startTime && (
              <span className="text-yellow-300 ml-1">(chained)</span>
            )}
            {" "}• {stops.length} stop{stops.length === 1 ? "" : "s"}
            {completedCount > 0 && !complete && (
              <span className="text-emerald-400"> • {completedCount}/{stops.length} done</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Link href={`/runs/${run.id}`} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm">
          Open
        </Link>
        {isAdmin && (
          <button onClick={() => onDelete(run.id)} className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ── Simple run card (for unassigned runs / carry-over) ───────────────

function RunCard({
  run,
  isAdmin,
  nicknames,
  onDelete,
  variant = "default",
}: {
  run: PlannedRun;
  isAdmin: boolean;
  nicknames: Record<string, string>;
  onDelete: (id: string) => void;
  variant?: "default" | "carryover";
}) {
  const complete = isRunComplete(run);
  const stops = parseStops(run.rawText);
  const completedCount = Math.max(
    (run.completedStopIndexes ?? []).length,
    (run.progress?.completedIdx ?? []).length
  );
  const remaining = stops.length - completedCount;

  const borderClass =
    variant === "carryover"
      ? "border-amber-500/40 bg-amber-500/5"
      : complete
      ? "border-emerald-500/40 bg-emerald-500/5"
      : "border-white/10";

  return (
    <div className={`border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap ${borderClass}`}>
      <div className="min-w-0">
        <div className="font-semibold text-lg">
          {run.jobNumber} • {variant === "carryover" ? `${run.date} • ` : ""}{run.customer}
          {run.runType === "backload" && (
            <span className="ml-2 text-purple-400 text-sm font-semibold">BACKLOAD</span>
          )}
          {run.vehicle?.trim() && <span className="ml-2 text-gray-300 text-sm">{run.vehicle}</span>}
          {!run.vehicle?.trim() && (
            <span className="ml-2 text-yellow-300 text-sm font-semibold">UNASSIGNED</span>
          )}
          {complete && (
            <span className="ml-2 text-emerald-400 text-sm font-semibold">COMPLETE</span>
          )}
          {variant === "carryover" && remaining > 0 && (
            <span className="ml-2 text-amber-400 text-sm font-semibold">{remaining} DROP{remaining === 1 ? "" : "S"} REMAINING</span>
          )}
          {run.loadRef && (
            <span className="ml-2 text-blue-300 text-sm font-medium">Ref: {run.loadRef}</span>
          )}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {run.runType === "backload" ? (
            <>Collection: {withNickname(run.fromPostcode, nicknames)}{run.collectionTime && ` @ ${run.collectionTime}`}</>
          ) : (
            <>From {withNickname(run.fromPostcode, nicknames)} • {run.returnToBase ? "Return to base" : "End at last drop"}</>
          )}
          {" "}• Start {run.startTime} • {stops.length} stop{stops.length === 1 ? "" : "s"}
          {completedCount > 0 && !complete && ` • ${completedCount}/${stops.length} done`}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Link href={`/runs/${run.id}`} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm">
          Open
        </Link>
        {isAdmin && variant !== "carryover" && (
          <button onClick={() => onDelete(run.id)} className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/10 text-sm">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function RunsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const allowedCustomers = profile?.allowed_customers ?? [];
  const nicknames = useNicknames();
  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [date, setDate] = useState<string>(getInitialDate);
  const [customer, setCustomer] = useState<CustomerKey | "All">("All");
  const [vehicle, setVehicle] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [customerNames, setCustomerNames] = useState<string[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

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

  const prevDate = useMemo(() => {
    if (!date) return "";
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, [date]);

  const filtered = useMemo(() => {
    return runs
      .filter((r) => isAdmin || allowedCustomers.includes(r.customer))
      .filter((r) => (date ? r.date === date : true))
      .filter((r) => (customer === "All" ? true : r.customer === customer))
      .filter((r) => (vehicle ? r.vehicle?.trim() === vehicle.trim() : true))
      .filter((r) => runMatchesSearch(r, search))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [runs, date, customer, vehicle, search, isAdmin, allowedCustomers]);

  const carryOver = useMemo(() => {
    if (!date || !prevDate) return [];
    return runs
      .filter((r) => isAdmin || allowedCustomers.includes(r.customer))
      .filter((r) => r.date === prevDate)
      .filter((r) => !isRunComplete(r) && parseStops(r.rawText).length > 0)
      .filter((r) => (customer === "All" ? true : r.customer === customer))
      .filter((r) => (vehicle ? r.vehicle?.trim() === vehicle.trim() : true))
      .filter((r) => runMatchesSearch(r, search));
  }, [runs, date, prevDate, customer, vehicle, search, isAdmin, allowedCustomers]);

  const unassignedCount = useMemo(
    () => filtered.filter((r) => !r.vehicle?.trim()).length,
    [filtered]
  );

  // Group runs by vehicle for drag-and-drop ordering
  const vehicleGroups = useMemo(() => {
    if (!date) return null;

    const withVehicle = filtered.filter((r) => r.vehicle?.trim());
    const noVehicle = filtered.filter((r) => !r.vehicle?.trim());

    const groups = new Map<string, PlannedRun[]>();
    for (const r of withVehicle) {
      const key = r.vehicle.trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    // Sort runs within each group by runOrder, then startTime
    for (const [, grp] of groups) {
      grp.sort((a, b) => {
        if (a.runOrder != null && b.runOrder != null) return a.runOrder - b.runOrder;
        if (a.runOrder != null) return -1;
        if (b.runOrder != null) return 1;
        return a.startTime.localeCompare(b.startTime);
      });
    }

    const sorted = Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([v, grp]) => ({ vehicle: v, runs: grp }));

    return { groups: sorted, unassigned: noVehicle };
  }, [filtered, date]);

  // Compute chained starts for multi-run vehicle groups
  const chainedStarts = useMemo(() => {
    if (!vehicleGroups) return new Map<string, { chainedStartTime: string; chainedFromPostcode: string }>();
    const allChains = new Map<string, { chainedStartTime: string; chainedFromPostcode: string }>();
    for (const group of vehicleGroups.groups) {
      if (group.runs.length <= 1) continue;
      const chains = computeChainedStarts(group.runs);
      for (const [id, val] of chains) {
        allChains.set(id, val);
      }
    }
    return allChains;
  }, [vehicleGroups]);

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this run?")) return;
    setRuns((prev) => prev.filter((r) => r.id !== id));
    await deleteRunAction(id);
  }

  async function handleRunDragEnd(event: DragEndEvent, vehicleKey: string) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setRuns((prev) => {
      const group = prev.filter(
        (r) => r.vehicle?.trim() === vehicleKey && r.date === date
      );
      const rest = prev.filter(
        (r) => !(r.vehicle?.trim() === vehicleKey && r.date === date)
      );

      const oldIdx = group.findIndex((r) => r.id === active.id);
      const newIdx = group.findIndex((r) => r.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;

      const reordered = arrayMove(group, oldIdx, newIdx);
      const updated = reordered.map((r, i) => ({ ...r, runOrder: i }));

      // Persist to database
      updateRunOrders(updated.map((r) => ({ id: r.id, runOrder: r.runOrder! })));

      return [...rest, ...updated];
    });
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
        <div className="mt-6 space-y-4">
          {loading ? (
            <div className="text-gray-400 border border-white/10 rounded-2xl p-4 bg-white/5">Loading runs...</div>
          ) : filtered.length === 0 && carryOver.length === 0 ? (
            <div className="text-gray-400 border border-white/10 rounded-2xl p-4 bg-white/5">
              No runs found. Create one in <Link className="text-blue-400 underline" href="/plan-route">Plan Route</Link>.
            </div>
          ) : (
            <>
              {/* Carry-over from previous day */}
              {carryOver.length > 0 && (
                <div className="border border-amber-500/30 rounded-2xl p-4 bg-amber-500/5">
                  <div className="text-xs text-amber-400 font-semibold uppercase tracking-wide mb-3">
                    Continued from {prevDate} ({carryOver.length} run{carryOver.length === 1 ? "" : "s"} with remaining drops)
                  </div>
                  <div className="space-y-2">
                    {carryOver.map((r) => (
                      <RunCard key={r.id} run={r} isAdmin={isAdmin} nicknames={nicknames} onDelete={handleDelete} variant="carryover" />
                    ))}
                  </div>
                </div>
              )}

              {/* Vehicle groups */}
              {vehicleGroups && vehicleGroups.groups.map((group) => (
                <div key={group.vehicle} className="border border-white/10 rounded-2xl p-4 bg-white/5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="text-lg font-semibold">{group.vehicle}</div>
                    <div className="text-sm text-gray-400">
                      {group.runs.length} run{group.runs.length === 1 ? "" : "s"}
                    </div>
                    {group.runs.length > 1 && isAdmin && (
                      <div className="text-xs text-gray-500">Drag to set order</div>
                    )}
                  </div>
                  {group.runs.length > 1 ? (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(event) => handleRunDragEnd(event, group.vehicle)}
                    >
                      <SortableContext
                        items={group.runs.map((r) => r.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2">
                          {group.runs.map((r, idx) => (
                            <SortableRunCard
                              key={r.id}
                              run={r}
                              index={idx}
                              groupSize={group.runs.length}
                              isAdmin={isAdmin}
                              nicknames={nicknames}
                              chainedStartTime={chainedStarts.get(r.id)?.chainedStartTime}
                              onDelete={handleDelete}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  ) : (
                    <div className="space-y-2">
                      {group.runs.map((r, idx) => (
                        <SortableRunCard
                          key={r.id}
                          run={r}
                          index={idx}
                          groupSize={1}
                          isAdmin={isAdmin}
                          nicknames={nicknames}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Unassigned runs */}
              {vehicleGroups && vehicleGroups.unassigned.length > 0 && (
                <div className="border border-yellow-500/20 rounded-2xl p-4 bg-yellow-500/5">
                  <div className="text-xs text-yellow-400 font-semibold uppercase tracking-wide mb-3">
                    Unassigned ({vehicleGroups.unassigned.length} run{vehicleGroups.unassigned.length === 1 ? "" : "s"})
                  </div>
                  <div className="space-y-2">
                    {vehicleGroups.unassigned.map((r) => (
                      <RunCard key={r.id} run={r} isAdmin={isAdmin} nicknames={nicknames} onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              )}

              {/* Flat list fallback when no date filter */}
              {!vehicleGroups && filtered.map((r) => (
                <RunCard key={r.id} run={r} isAdmin={isAdmin} nicknames={nicknames} onDelete={handleDelete} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
