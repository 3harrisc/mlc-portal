"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import {
  listTrailers,
  createTrailer,
  updateTrailer,
  deleteTrailer,
} from "@/app/actions/fleet";
import type { Trailer } from "@/types/invoicing";

export default function AdminTrailersPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newId, setNewId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await listTrailers();
    if (res.error) setError(res.error);
    else setTrailers(res.trailers ?? []);
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
    const res = await createTrailer({ id: newId, description: newDescription });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setNewId(""); setNewDescription(""); setShowNew(false);
    load();
  }

  async function patch(t: Trailer, fields: Partial<Trailer>) {
    setTrailers((curr) => curr.map((x) => (x.id === t.id ? { ...x, ...fields } : x)));
    const res = await updateTrailer(t.id, fields);
    if (res.error) { setError(res.error); load(); }
  }

  async function handleDelete(t: Trailer) {
    if (!confirm(`Delete trailer ${t.id}? Existing runs keep the value but it can't be re-assigned.`)) return;
    const res = await deleteTrailer(t.id);
    if (res.error) { setError(res.error); return; }
    load();
  }

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Trailers</h1>
          <div className="page-subtitle">
            Trailer fleet list (replaces the spreadsheet&apos;s TrailerList sheet).
          </div>
        </div>
        <button type="button" className="btn primary sm" onClick={() => setShowNew((v) => !v)}>
          <Icon name={showNew ? "x" : "plus"} size={11} />
          {showNew ? "Cancel" : "New trailer"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {showNew && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>New trailer</h3></div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div className="field">
              <label>ID (e.g. MLC036)</label>
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value.toUpperCase())}
                required
                placeholder="MLC036"
                className="input mono"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="input"
                placeholder="(optional)"
              />
            </div>
            <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end" }}>
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
                <th style={{ textAlign: "center" }}>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trailers.map((t) => (
                <tr key={t.id} style={{ cursor: "default" }}>
                  <td className="bold mono">{t.id}</td>
                  <td>
                    <input
                      type="text"
                      defaultValue={t.description}
                      onBlur={(e) => {
                        const v = e.target.value;
                        if (v !== t.description) void patch(t, { description: v });
                      }}
                      placeholder="(none)"
                      className="input"
                      style={{ height: 28, fontSize: 12.5 }}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      className={`cb ${t.active ? "checked" : ""}`}
                      onClick={() => void patch(t, { active: !t.active })}
                    >
                      {t.active && <Icon name="check" size={10} />}
                    </button>
                  </td>
                  <td className="right">
                    <button type="button" className="btn sm ghost" style={{ color: "var(--err)" }} onClick={() => void handleDelete(t)}>
                      <Icon name="x" size={11} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
              {trailers.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
                    No trailers yet.
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
