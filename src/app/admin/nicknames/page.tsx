"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import {
  listNicknames,
  upsertNickname,
  deleteNickname,
} from "@/app/actions/nicknames";

interface NicknameRow { postcode: string; nickname: string }

export default function AdminNicknamesPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [nicknames, setNicknames] = useState<NicknameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newPostcode, setNewPostcode] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  const [editingPc, setEditingPc] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState("");

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await listNicknames();
    if (result.error) setError(result.error);
    else setNicknames(result.nicknames);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    queueMicrotask(() => { load(); });
  }, [profile, load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newPostcode.trim() || !newNickname.trim()) return;
    setFormLoading(true);
    setError("");
    const result = await upsertNickname(newPostcode, newNickname);
    setFormLoading(false);
    if (result.error) { setError(result.error); return; }
    setNewPostcode(""); setNewNickname("");
    await load();
  }

  async function handleSaveEdit(postcode: string) {
    if (!editNickname.trim()) return;
    const result = await upsertNickname(postcode, editNickname);
    if (result.error) { setError(result.error); return; }
    setEditingPc(null);
    await load();
  }

  async function handleDelete(postcode: string) {
    if (!confirm(`Delete nickname for ${postcode}?`)) return;
    const result = await deleteNickname(postcode);
    if (result.error) { setError(result.error); return; }
    await load();
  }

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Postcode nicknames</h1>
          <div className="page-subtitle">
            Friendly names for postcodes. Shown alongside postcodes on runs, the planner, and reports.
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      <form onSubmit={handleAdd} className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3>Add nickname</h3></div>
        <div className="card-body" style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", gap: 12, alignItems: "end" }}>
          <div className="field">
            <label>Postcode</label>
            <input type="text" required value={newPostcode}
              onChange={(e) => setNewPostcode(e.target.value)}
              placeholder="e.g. NG22 8TX" className="input mono" />
          </div>
          <div className="field">
            <label>Nickname</label>
            <input type="text" required value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              placeholder="e.g. Brakes Newark" className="input" />
          </div>
          <button type="submit" className="btn primary sm" disabled={formLoading}>
            <Icon name="plus" size={11} /> {formLoading ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : nicknames.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
            No nicknames yet. Add one above.
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Postcode</th>
                <th>Nickname</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nicknames.map((n) =>
                editingPc === n.postcode ? (
                  <tr key={n.postcode} style={{ cursor: "default", background: "var(--surface-alt)" }}>
                    <td className="mono bold">{n.postcode}</td>
                    <td>
                      <input
                        type="text"
                        autoFocus
                        value={editNickname}
                        onChange={(e) => setEditNickname(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveEdit(n.postcode);
                          if (e.key === "Escape") setEditingPc(null);
                        }}
                        className="input"
                        style={{ height: 28, fontSize: 12.5 }}
                      />
                    </td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn primary sm" onClick={() => void handleSaveEdit(n.postcode)}>
                        <Icon name="check" size={11} /> Save
                      </button>
                      <button type="button" className="btn sm ghost" onClick={() => setEditingPc(null)} style={{ marginLeft: 4 }}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={n.postcode} style={{ cursor: "default" }}>
                    <td className="mono bold">{n.postcode}</td>
                    <td>{n.nickname}</td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => { setEditingPc(n.postcode); setEditNickname(n.nickname); }}
                      >
                        <Icon name="settings" size={11} /> Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={{ color: "var(--err)" }}
                        onClick={() => void handleDelete(n.postcode)}
                      >
                        <Icon name="x" size={11} /> Delete
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
