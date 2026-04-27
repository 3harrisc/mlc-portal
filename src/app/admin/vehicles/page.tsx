"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import {
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from "@/app/actions/fleet";
import type { Vehicle } from "@/types/invoicing";

export default function AdminVehiclesPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [newId, setNewId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSort, setNewSort] = useState("100");
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await listVehicles();
    if (res.error) setError(res.error);
    else setVehicles(res.vehicles ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    queueMicrotask(() => { load(); });
  }, [profile, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const sort = Number(newSort || "100");
    const res = await createVehicle({
      id: newId,
      description: newDescription,
      sortOrder: Number.isFinite(sort) ? sort : 100,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNewId("");
    setNewDescription("");
    setNewSort("100");
    setShowNew(false);
    load();
  }

  async function patch(v: Vehicle, fields: Partial<Vehicle>) {
    setVehicles((curr) => curr.map((x) => (x.id === v.id ? { ...x, ...fields } : x)));
    const update: { description?: string; active?: boolean; sortOrder?: number } = {};
    if (fields.description !== undefined) update.description = fields.description;
    if (fields.active !== undefined) update.active = fields.active;
    if (fields.sortOrder !== undefined) update.sortOrder = fields.sortOrder;
    const res = await updateVehicle(v.id, update);
    if (res.error) {
      setError(res.error);
      load();
    }
  }

  async function handleDelete(v: Vehicle) {
    if (!confirm(`Delete vehicle ${v.id}? Existing runs keep the value but it can't be re-assigned.`)) return;
    const res = await deleteVehicle(v.id);
    if (res.error) {
      setError(res.error);
      return;
    }
    load();
  }

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Vehicles</h1>
          <div className="page-subtitle">
            Canonical fleet list. Drives the Vehicle dropdown and Fleet
            availability strip on the planner.
          </div>
        </div>
        <button type="button" className="btn primary sm" onClick={() => setShowNew((v) => !v)}>
          <Icon name={showNew ? "x" : "plus"} size={11} />
          {showNew ? "Cancel" : "New vehicle"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {showNew && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>New vehicle</h3></div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 2fr 100px", gap: 12 }}>
            <div className="field">
              <label>ID (e.g. C12MLC)</label>
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value.toUpperCase())}
                required
                placeholder="C12MLC"
                className="input mono"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="(optional)"
                className="input"
              />
            </div>
            <div className="field">
              <label>Sort</label>
              <input
                type="number"
                value={newSort}
                onChange={(e) => setNewSort(e.target.value)}
                className="input mono tnum"
              />
            </div>
            <div style={{ gridColumn: "span 3", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="btn primary sm" disabled={busy}>
                <Icon name="check" size={11} /> {busy ? "Saving…" : "Add"}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th>
                <th>Description</th>
                <th className="right">Sort</th>
                <th style={{ textAlign: "center" }}>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} style={{ cursor: "default" }}>
                  <td className="bold mono">{v.id}</td>
                  <td>
                    <input
                      type="text"
                      defaultValue={v.description}
                      onBlur={(e) => {
                        const x = e.target.value;
                        if (x !== v.description) void patch(v, { description: x });
                      }}
                      placeholder="(none)"
                      className="input"
                      style={{ height: 28, fontSize: 12.5 }}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      defaultValue={v.sortOrder}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n !== v.sortOrder) void patch(v, { sortOrder: n });
                      }}
                      className="input mono tnum"
                      style={{ height: 28, fontSize: 12.5, width: 80, textAlign: "right" }}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      className={`cb ${v.active ? "checked" : ""}`}
                      onClick={() => void patch(v, { active: !v.active })}
                    >
                      {v.active && <Icon name="check" size={10} />}
                    </button>
                  </td>
                  <td className="right">
                    <button type="button" className="btn sm ghost" style={{ color: "var(--err)" }} onClick={() => void handleDelete(v)}>
                      <Icon name="x" size={11} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
              {vehicles.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
                    No vehicles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
