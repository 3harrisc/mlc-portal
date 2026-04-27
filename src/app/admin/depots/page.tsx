"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import {
  listDepots,
  createDepot,
  updateDepot,
  deleteDepot,
} from "@/app/actions/fleet";
import type { Depot } from "@/types/invoicing";

interface NewDepot {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  radiusM: string;
}

const EMPTY: NewDepot = { id: "", name: "", latitude: "", longitude: "", radiusM: "200" };

export default function AdminDepotsPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [newRow, setNewRow] = useState<NewDepot>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await listDepots();
    if (res.error) setError(res.error);
    else setDepots(res.depots ?? []);
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
    setError("");
    const lat = Number(newRow.latitude);
    const lng = Number(newRow.longitude);
    const radius = Number(newRow.radiusM || "200");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Latitude and longitude must be numeric");
      setBusy(false);
      return;
    }
    const res = await createDepot({
      id: newRow.id,
      name: newRow.name,
      latitude: lat,
      longitude: lng,
      radiusM: radius,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setNewRow(EMPTY);
    setShowNew(false);
    load();
  }

  async function patchDepot(d: Depot, fields: Partial<Depot>) {
    setDepots((curr) => curr.map((x) => (x.id === d.id ? { ...x, ...fields } : x)));
    const update: { name?: string; latitude?: number; longitude?: number; radiusM?: number } = {};
    if (fields.name !== undefined) update.name = fields.name;
    if (fields.latitude !== undefined) update.latitude = fields.latitude;
    if (fields.longitude !== undefined) update.longitude = fields.longitude;
    if (fields.radiusM !== undefined) update.radiusM = fields.radiusM;
    const res = await updateDepot(d.id, update);
    if (res.error) { setError(res.error); load(); }
  }

  async function handleDelete(d: Depot) {
    if (!confirm(`Delete depot "${d.name}"?`)) return;
    const res = await deleteDepot(d.id);
    if (res.error) { setError(res.error); return; }
    load();
  }

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Depots</h1>
          <div className="page-subtitle">
            Lat/lon + radius for the &ldquo;is this trailer at a depot?&rdquo; check used by the live tracker.
          </div>
        </div>
        <button type="button" className="btn primary sm" onClick={() => setShowNew((v) => !v)}>
          <Icon name={showNew ? "x" : "plus"} size={11} />
          {showNew ? "Cancel" : "New depot"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {showNew && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>New depot</h3></div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            <div className="field">
              <label>ID slug</label>
              <input
                type="text"
                value={newRow.id}
                onChange={(e) => setNewRow({ ...newRow, id: e.target.value.toLowerCase() })}
                required
                className="input mono"
                placeholder="newark"
              />
            </div>
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                value={newRow.name}
                onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
                required
                className="input"
                placeholder="Brakes Newark"
              />
            </div>
            <div className="field">
              <label>Latitude</label>
              <input
                type="number"
                step="0.000001"
                value={newRow.latitude}
                onChange={(e) => setNewRow({ ...newRow, latitude: e.target.value })}
                required
                className="input mono tnum"
                placeholder="53.126452"
              />
            </div>
            <div className="field">
              <label>Longitude</label>
              <input
                type="number"
                step="0.000001"
                value={newRow.longitude}
                onChange={(e) => setNewRow({ ...newRow, longitude: e.target.value })}
                required
                className="input mono tnum"
                placeholder="-1.011047"
              />
            </div>
            <div className="field">
              <label>Radius (m)</label>
              <input
                type="number"
                min="10"
                value={newRow.radiusM}
                onChange={(e) => setNewRow({ ...newRow, radiusM: e.target.value })}
                className="input mono tnum"
              />
            </div>
            <div style={{ gridColumn: "span 5", display: "flex", justifyContent: "flex-end" }}>
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
                <th>Name</th>
                <th className="right">Latitude</th>
                <th className="right">Longitude</th>
                <th className="right">Radius (m)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {depots.map((d) => (
                <tr key={d.id} style={{ cursor: "default" }}>
                  <td className="bold mono">{d.id}</td>
                  <td>
                    <input
                      type="text"
                      defaultValue={d.name}
                      onBlur={(e) => {
                        const v = e.target.value;
                        if (v && v !== d.name) void patchDepot(d, { name: v });
                      }}
                      className="input"
                      style={{ height: 28, fontSize: 12.5 }}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      step="0.000001"
                      defaultValue={d.latitude}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n !== d.latitude) void patchDepot(d, { latitude: n });
                      }}
                      className="input mono tnum"
                      style={{ height: 28, fontSize: 12.5, width: 130, textAlign: "right" }}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      step="0.000001"
                      defaultValue={d.longitude}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n !== d.longitude) void patchDepot(d, { longitude: n });
                      }}
                      className="input mono tnum"
                      style={{ height: 28, fontSize: 12.5, width: 130, textAlign: "right" }}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      min="10"
                      defaultValue={d.radiusM}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n > 0 && n !== d.radiusM) void patchDepot(d, { radiusM: n });
                      }}
                      className="input mono tnum"
                      style={{ height: 28, fontSize: 12.5, width: 90, textAlign: "right" }}
                    />
                  </td>
                  <td className="right">
                    <button type="button" className="btn sm ghost" style={{ color: "var(--err)" }} onClick={() => void handleDelete(d)}>
                      <Icon name="x" size={11} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
              {depots.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
                    No depots yet.
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
