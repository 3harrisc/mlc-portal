"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import {
  listXeroMap,
  createXeroMap,
  updateXeroMap,
  deleteXeroMap,
  type XeroMapInput,
} from "./actions";
import type { CustomerXeroMap } from "@/types/invoicing";

const EMPTY_NEW: XeroMapInput = {
  plannerName: "",
  xeroContactName: "",
  accountCode: "400",
  taxType: "OUTPUT2",
  dueDays: 30,
  emailAddress: "",
  brandingTheme: "",
  notes: "",
};

export default function AdminXeroMapPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [entries, setEntries] = useState<CustomerXeroMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [newRow, setNewRow] = useState<XeroMapInput>(EMPTY_NEW);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<XeroMapInput>(EMPTY_NEW);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await listXeroMap();
    if (res.error) setError(res.error);
    else setEntries(res.entries ?? []);
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
    const res = await createXeroMap(newRow);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setNewRow(EMPTY_NEW);
    setShowNew(false);
    load();
  }

  function startEdit(e: CustomerXeroMap) {
    setEditingId(e.id);
    setEditFields({
      plannerName: e.plannerName,
      xeroContactName: e.xeroContactName ?? "",
      accountCode: e.accountCode,
      taxType: e.taxType,
      dueDays: e.dueDays,
      emailAddress: e.emailAddress ?? "",
      brandingTheme: e.brandingTheme ?? "",
      notes: e.notes ?? "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    setError("");
    const res = await updateXeroMap(editingId, editFields);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setEditingId(null);
    load();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete the Xero mapping for "${name}"? Future exports will fall back to default.`)) return;
    setBusy(true);
    const res = await deleteXeroMap(id);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    load();
  }

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Xero customer map</h1>
          <div className="page-subtitle">
            Maps planner-side customer names to Xero contacts, account codes, tax codes, and payment terms.
          </div>
        </div>
        <button type="button" className="btn primary sm" onClick={() => setShowNew((v) => !v)}>
          <Icon name={showNew ? "x" : "plus"} size={11} />
          {showNew ? "Cancel" : "New mapping"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {showNew && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>New mapping</h3></div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <Field label="Planner name (required)">
              <input type="text" value={newRow.plannerName} required
                onChange={(e) => setNewRow({ ...newRow, plannerName: e.target.value })}
                placeholder="e.g. CONSOLID8" className="input" />
            </Field>
            <Field label="Xero contact name (optional)">
              <input type="text" value={newRow.xeroContactName ?? ""}
                onChange={(e) => setNewRow({ ...newRow, xeroContactName: e.target.value })}
                placeholder="If different from planner name" className="input" />
            </Field>
            <Field label="Account code">
              <input type="text" value={newRow.accountCode ?? ""}
                onChange={(e) => setNewRow({ ...newRow, accountCode: e.target.value })}
                className="input mono" />
            </Field>
            <Field label="Tax type">
              <input type="text" value={newRow.taxType ?? ""}
                onChange={(e) => setNewRow({ ...newRow, taxType: e.target.value })}
                className="input mono" />
            </Field>
            <Field label="Due days (after end-of-month)">
              <input type="number" min="0" value={newRow.dueDays ?? 30}
                onChange={(e) => setNewRow({ ...newRow, dueDays: Number(e.target.value) })}
                className="input mono tnum" />
            </Field>
            <Field label="Email address (optional)">
              <input type="email" value={newRow.emailAddress ?? ""}
                onChange={(e) => setNewRow({ ...newRow, emailAddress: e.target.value })}
                className="input" />
            </Field>
            <Field label="Branding theme (optional)">
              <input type="text" value={newRow.brandingTheme ?? ""}
                onChange={(e) => setNewRow({ ...newRow, brandingTheme: e.target.value })}
                className="input" />
            </Field>
            <Field label="Notes">
              <input type="text" value={newRow.notes ?? ""}
                onChange={(e) => setNewRow({ ...newRow, notes: e.target.value })}
                className="input" />
            </Field>
            <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="btn primary sm" disabled={busy}>
                <Icon name="check" size={11} /> {busy ? "Saving…" : "Add mapping"}
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
                <th>Planner name</th>
                <th>Xero contact</th>
                <th>Account</th>
                <th>Tax</th>
                <th className="right">Due days</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) =>
                editingId === e.id ? (
                  <tr key={e.id} style={{ cursor: "default", background: "var(--surface-alt)" }}>
                    <td>
                      <input type="text" value={editFields.plannerName}
                        onChange={(ev) => setEditFields({ ...editFields, plannerName: ev.target.value })}
                        className="input" style={{ height: 28, fontSize: 12.5 }} />
                    </td>
                    <td>
                      <input type="text" value={editFields.xeroContactName ?? ""}
                        onChange={(ev) => setEditFields({ ...editFields, xeroContactName: ev.target.value })}
                        className="input" style={{ height: 28, fontSize: 12.5 }} />
                    </td>
                    <td>
                      <input type="text" value={editFields.accountCode ?? ""}
                        onChange={(ev) => setEditFields({ ...editFields, accountCode: ev.target.value })}
                        className="input mono" style={{ height: 28, fontSize: 12.5, width: 70 }} />
                    </td>
                    <td>
                      <input type="text" value={editFields.taxType ?? ""}
                        onChange={(ev) => setEditFields({ ...editFields, taxType: ev.target.value })}
                        className="input mono" style={{ height: 28, fontSize: 12.5, width: 90 }} />
                    </td>
                    <td className="right">
                      <input type="number" min="0" value={editFields.dueDays ?? 30}
                        onChange={(ev) => setEditFields({ ...editFields, dueDays: Number(ev.target.value) })}
                        className="input mono tnum" style={{ height: 28, fontSize: 12.5, width: 70, textAlign: "right" }} />
                    </td>
                    <td>
                      <input type="email" value={editFields.emailAddress ?? ""}
                        onChange={(ev) => setEditFields({ ...editFields, emailAddress: ev.target.value })}
                        className="input" style={{ height: 28, fontSize: 12.5 }} />
                    </td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn primary sm" onClick={() => void saveEdit()} disabled={busy}>
                        <Icon name="check" size={11} /> Save
                      </button>
                      <button type="button" className="btn sm ghost" onClick={() => setEditingId(null)} style={{ marginLeft: 4 }}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} style={{ cursor: "default" }}>
                    <td className="bold">{e.plannerName}</td>
                    <td>
                      {e.xeroContactName ?? <span className="muted">(uses planner name)</span>}
                    </td>
                    <td className="mono">{e.accountCode}</td>
                    <td className="mono">{e.taxType}</td>
                    <td className="right mono tnum">{e.dueDays}</td>
                    <td className="muted">{e.emailAddress ?? ""}</td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn sm ghost" onClick={() => startEdit(e)}>
                        <Icon name="settings" size={11} /> Edit
                      </button>
                      {e.plannerName.toLowerCase() !== "default" && (
                        <button type="button" className="btn sm ghost" style={{ color: "var(--err)" }}
                          onClick={() => void handleDelete(e.id, e.plannerName)}>
                          <Icon name="x" size={11} /> Delete
                        </button>
                      )}
                    </td>
                  </tr>
                )
              )}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
                    No mappings yet.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
