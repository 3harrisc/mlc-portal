"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Icon from "@/components/portal/Icon";
import { useAuth } from "@/components/AuthProvider";
import { listRunsForIsoWeek, listKnownVehicles } from "@/app/actions/planner";
import {
  listVehicleCosts,
  getWeeklyExtras,
  upsertVehicleCost,
  upsertWeeklyExtras,
  carryForwardRunningCosts,
} from "@/app/actions/figures";
import { aggregateWeek } from "@/lib/figures/aggregate";
import { isoWeekNum, isoYear } from "@/lib/iso-week";
import {
  emptyWeeklyVehicleCost,
  type WeeklyExtras,
  type WeeklyVehicleCost,
} from "@/types/figures";
import type { PlannedRun } from "@/types/runs";

function parseWeekParam(raw: string): { year: number; week: number } {
  const ymatch = raw.match(/^(\d{1,2})-(\d{4})$/);
  if (ymatch) return { week: Number(ymatch[1]), year: Number(ymatch[2]) };
  const isomatch = raw.match(/^(\d{4})-W(\d{1,2})$/i);
  if (isomatch) return { year: Number(isomatch[1]), week: Number(isomatch[2]) };
  const now = new Date();
  return { year: isoYear(now), week: isoWeekNum(now) };
}

const COST_FIELDS: ReadonlyArray<{
  key: keyof WeeklyVehicleCost;
  label: string;
}> = [
  { key: "runningCost",   label: "Running" },
  { key: "fuelUkLitres",  label: "Fuel UK (L)" },
  { key: "fuelUkAmount",  label: "Fuel UK (£)" },
  { key: "fuelLuxLitres", label: "Fuel Lux (L)" },
  { key: "fuelLuxAmount", label: "Fuel Lux (£)" },
  { key: "tollsEuro",     label: "Tolls (€)" },
  { key: "tollsGbp",      label: "Tolls (£)" },
  { key: "parking",       label: "Parking" },
  { key: "adblue",        label: "AdBlue" },
  { key: "otherCost",     label: "Other" },
];

export default function FiguresPage() {
  const params = useParams<{ week: string }>();
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";

  const { year, week } = useMemo(
    () => parseWeekParam(String(params?.week ?? "")),
    [params?.week]
  );

  const [runs, setRuns] = useState<PlannedRun[]>([]);
  const [costs, setCosts] = useState<WeeklyVehicleCost[]>([]);
  const [extras, setExtras] = useState<WeeklyExtras | null>(null);
  const [knownVehicles, setKnownVehicles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newDriverName, setNewDriverName] = useState("");
  /**
   * One-shot notice when running costs were auto-carried from a prior week.
   * Cleared on next week change.
   */
  const [carriedNote, setCarriedNote] = useState<string>("");
  const [carrying, setCarrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setCarriedNote("");
      const [runsRes, costsRes, extrasRes, vehiclesRes] = await Promise.all([
        listRunsForIsoWeek(year, week),
        listVehicleCosts(year, week),
        getWeeklyExtras(year, week),
        listKnownVehicles(),
      ]);
      if (cancelled) return;
      if (runsRes.error) setError(runsRes.error);
      if (costsRes.error) setError((e) => e || costsRes.error || "");
      if (extrasRes.error) setError((e) => e || extrasRes.error || "");
      setRuns(runsRes.runs ?? []);
      setExtras(extrasRes.extras ?? null);
      setKnownVehicles(vehiclesRes.vehicles ?? []);

      // Auto-carry running costs forward on first visit to a week (i.e. when
      // there are no cost rows yet). Only runs when the user is admin —
      // non-admins just see whatever's there.
      const initialCosts = costsRes.rows ?? [];
      if (initialCosts.length === 0 && profile?.role === "admin") {
        const carry = await carryForwardRunningCosts(year, week);
        if (cancelled) return;
        if (carry.error) {
          setError((e) => e || carry.error || "");
          setCosts(initialCosts);
        } else if ((carry.seededVehicles ?? []).length > 0) {
          // Re-fetch the costs we just inserted.
          const refresh = await listVehicleCosts(year, week);
          if (cancelled) return;
          setCosts(refresh.rows ?? initialCosts);
          setCarriedNote(
            `Running costs carried forward from ${carry.sourceLabel ?? "the previous week"} for ${carry.seededVehicles!.length} vehicle${carry.seededVehicles!.length === 1 ? "" : "s"}. Fuel, tolls, AdBlue and parking start at zero — fill in for this week.`
          );
        } else {
          setCosts(initialCosts);
        }
      } else {
        setCosts(initialCosts);
      }

      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [year, week, profile?.role]);

  const vehicles = useMemo(() => {
    const set = new Set<string>();
    for (const c of costs) set.add(c.vehicle);
    for (const r of runs) if (r.vehicle?.trim()) set.add(r.vehicle.trim());
    for (const v of knownVehicles) set.add(v);
    return Array.from(set).sort();
  }, [costs, runs, knownVehicles]);

  const costsByVehicle = useMemo(() => {
    const map = new Map<string, WeeklyVehicleCost>();
    for (const c of costs) map.set(c.vehicle, c);
    return map;
  }, [costs]);

  const aggregate = useMemo(() => {
    return aggregateWeek({
      runs,
      vehicleCosts: costs,
      extras: extras ?? {
        isoYear: year, isoWeek: week, office: 0, vans: 0, bbl: 0, subbyCost: 0, driverWages: {},
      },
      vehicles,
    });
  }, [runs, costs, extras, vehicles, year, week]);

  function patchCostLocal(vehicle: string, fields: Partial<WeeklyVehicleCost>) {
    setCosts((curr) => {
      const idx = curr.findIndex((c) => c.vehicle === vehicle);
      if (idx === -1) return [...curr, { ...emptyWeeklyVehicleCost(year, week, vehicle), ...fields }];
      return curr.map((c, i) => (i === idx ? { ...c, ...fields } : c));
    });
  }

  async function persistCost(vehicle: string, fields: Partial<WeeklyVehicleCost>) {
    const res = await upsertVehicleCost(year, week, vehicle, fields);
    if (res.error) setError(res.error);
  }

  function patchExtraLocal(fields: Partial<WeeklyExtras>) {
    setExtras((curr) => ({
      isoYear: year, isoWeek: week, office: 0, vans: 0, bbl: 0, subbyCost: 0, driverWages: {},
      ...curr,
      ...fields,
    }));
  }

  async function persistExtras(fields: Partial<WeeklyExtras>) {
    const res = await upsertWeeklyExtras(year, week, fields);
    if (res.error) setError(res.error);
  }

  async function setDriverWageLocal(name: string, amt: number) {
    if (!extras) return;
    const next = { ...extras.driverWages, [name]: amt };
    patchExtraLocal({ driverWages: next });
    await persistExtras({ driverWages: next });
  }

  async function addDriver() {
    const name = newDriverName.trim();
    if (!name || !extras) return;
    if (extras.driverWages[name] !== undefined) return;
    setNewDriverName("");
    const next = { ...extras.driverWages, [name]: 0 };
    patchExtraLocal({ driverWages: next });
    await persistExtras({ driverWages: next });
  }

  async function removeDriver(name: string) {
    if (!extras) return;
    const next = { ...extras.driverWages };
    delete next[name];
    patchExtraLocal({ driverWages: next });
    await persistExtras({ driverWages: next });
  }

  if (authLoading) return <div className="muted">Loading…</div>;

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
          <h1 className="page-title">Figures · Week {week}, {year}</h1>
          <div className="page-subtitle">
            Earnings come from the planner; costs are entered here.
          </div>
        </div>
        <div className="row gap-8">
          <Link href={`/portal/planner/week/${week}-${year}`} className="btn sm">
            <Icon name="chevL" size={11} /> Planner
          </Link>
          <Link href={`/portal/invoicing/${week}-${year}`} className="btn sm">
            <Icon name="doc" size={11} /> Invoicing
          </Link>
          <select
            value={`${week}-${year}`}
            onChange={(e) => router.push(`/portal/figures/${e.target.value}`)}
            className="select"
            style={{ height: 32, fontSize: 12.5, padding: "0 10px" }}
          >
            {weekOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {isAdmin && (
            <button
              type="button"
              className="btn sm"
              disabled={carrying}
              onClick={async () => {
                setCarrying(true);
                setError("");
                const res = await carryForwardRunningCosts(year, week);
                setCarrying(false);
                if (res.error) {
                  setError(res.error);
                  return;
                }
                if ((res.seededVehicles ?? []).length === 0) {
                  setCarriedNote("All vehicles already have running costs for this week — nothing to carry forward.");
                } else {
                  // Re-fetch
                  const refresh = await listVehicleCosts(year, week);
                  setCosts(refresh.rows ?? []);
                  setCarriedNote(
                    `Running costs carried forward from ${res.sourceLabel ?? "the previous week"} for ${res.seededVehicles!.length} vehicle${res.seededVehicles!.length === 1 ? "" : "s"}.`
                  );
                }
              }}
              title="Re-seed running costs from the most recent prior week (only fills empty vehicles; never overwrites)"
            >
              <Icon name="refresh" size={11} /> {carrying ? "Carrying…" : "Carry forward"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {carriedNote && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--info, #2A55B5)", background: "var(--info-bg, #EAEFF8)" }}>
          <div className="card-body" style={{ color: "var(--info, #2A55B5)", fontSize: 12.5 }}>
            <Icon name="refresh" size={11} style={{ marginRight: 6, verticalAlign: "middle" }} />
            {carriedNote}
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <Kpi label="Gross earnings" value={`£${aggregate.grossEarnings.toFixed(2)}`} icon="check" />
        <Kpi label="Vehicle costs" value={`£${aggregate.totalVehicleCosts.toFixed(2)}`} icon="truck" />
        <Kpi label="Extras + wages" value={`£${aggregate.totalExtras.toFixed(2)}`} icon="user" />
        <Kpi
          label="Profit / loss"
          value={`£${aggregate.totalProfitLoss.toFixed(2)}`}
          icon="chart"
          accent={aggregate.totalProfitLoss >= 0 ? "var(--ok)" : "var(--err)"}
        />
      </div>

      {loading ? (
        <div className="muted">Loading week…</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>Per-vehicle running costs</h3>
              <span className="muted" style={{ fontSize: 11 }}>
                {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data" style={{ minWidth: 1200 }}>
                <thead>
                  <tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--surface-alt)" }}>Vehicle</th>
                    {COST_FIELDS.map((f) => <th key={f.key} className="right">{f.label}</th>)}
                    <th className="right" style={{ borderLeft: "1px solid var(--line)" }}>Cost total</th>
                    <th className="right">Earnings</th>
                    <th className="right">P / L</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.length === 0 && (
                    <tr><td colSpan={COST_FIELDS.length + 4} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
                      No vehicles seen yet for this week. Assign vehicles to runs on the planner first.
                    </td></tr>
                  )}
                  {vehicles.map((v) => {
                    const c = costsByVehicle.get(v) ?? emptyWeeklyVehicleCost(year, week, v);
                    const pl = aggregate.profitLossByVehicle.find((p) => p.vehicle === v);
                    const plClass = (pl?.profitLoss ?? 0) >= 0 ? "" : "";
                    const plColour = (pl?.profitLoss ?? 0) >= 0 ? "var(--ok)" : "var(--err)";
                    return (
                      <tr key={v} style={{ cursor: "default" }}>
                        <td className="bold mono" style={{ position: "sticky", left: 0, zIndex: 1, background: "var(--surface)" }}>{v}</td>
                        {COST_FIELDS.map((f) => (
                          <td key={f.key} className="right">
                            <NumberInput
                              value={c[f.key] as number}
                              disabled={!isAdmin}
                              onCommit={(n) => {
                                patchCostLocal(v, { [f.key]: n });
                                void persistCost(v, { [f.key]: n });
                              }}
                            />
                          </td>
                        ))}
                        <td className="right mono tnum bold" style={{ borderLeft: "1px solid var(--line)" }}>
                          £{(pl?.costs ?? 0).toFixed(2)}
                        </td>
                        <td className="right mono tnum">£{(pl?.earnings ?? 0).toFixed(2)}</td>
                        <td className={`right mono tnum bold ${plClass}`} style={{ color: plColour }}>
                          £{(pl?.profitLoss ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>Weekly extras</h3>
            </div>
            <div className="card-body">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <ExtraField label="Office"        value={extras?.office ?? 0}    disabled={!isAdmin} onCommit={(n) => { patchExtraLocal({ office: n }); void persistExtras({ office: n }); }} />
                <ExtraField label="Vans"          value={extras?.vans ?? 0}      disabled={!isAdmin} onCommit={(n) => { patchExtraLocal({ vans: n }); void persistExtras({ vans: n }); }} />
                <ExtraField label="BBL"           value={extras?.bbl ?? 0}       disabled={!isAdmin} onCommit={(n) => { patchExtraLocal({ bbl: n }); void persistExtras({ bbl: n }); }} />
                <ExtraField label="Subby (extra)" value={extras?.subbyCost ?? 0} disabled={!isAdmin} onCommit={(n) => { patchExtraLocal({ subbyCost: n }); void persistExtras({ subbyCost: n }); }} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Driver wages</h3>
              <span className="muted" style={{ fontSize: 11 }}>
                Total this week: £{aggregate.totalDriverWages.toFixed(2)}
              </span>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="right">Amount</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {Object.entries(extras?.driverWages ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, amt]) => (
                  <tr key={name} style={{ cursor: "default" }}>
                    <td className="bold">{name}</td>
                    <td className="right">
                      <NumberInput value={amt} disabled={!isAdmin} onCommit={(n) => void setDriverWageLocal(name, n)} />
                    </td>
                    {isAdmin && (
                      <td className="right">
                        <button type="button" className="btn sm ghost" style={{ color: "var(--err)" }} onClick={() => void removeDriver(name)}>
                          <Icon name="x" size={11} /> Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {Object.keys(extras?.driverWages ?? {}).length === 0 && (
                  <tr><td colSpan={isAdmin ? 3 : 2} style={{ textAlign: "center", padding: 24, color: "var(--ink-500)" }}>
                    No driver wages recorded yet for this week.
                  </td></tr>
                )}
              </tbody>
            </table>
            {isAdmin && (
              <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
                <input
                  type="text"
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  placeholder="Driver name (e.g. Aussie)"
                  className="input"
                  style={{ height: 32, fontSize: 12.5, padding: "0 10px" }}
                />
                <button type="button" className="btn primary sm" onClick={() => void addDriver()}>
                  <Icon name="plus" size={11} /> Add driver
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; accent?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        <Icon name={icon} size={12} /> {label}
      </div>
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

function NumberInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      disabled={disabled}
      defaultValue={value > 0 ? value.toFixed(2) : ""}
      placeholder="0.00"
      key={value}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n !== value) onCommit(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="input mono tnum"
      style={{ height: 28, padding: "0 8px", fontSize: 12.5, textAlign: "right", width: 110 }}
    />
  );
}

function ExtraField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <NumberInput value={value} disabled={disabled} onCommit={onCommit} />
    </div>
  );
}
