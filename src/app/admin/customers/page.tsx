"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "./actions";

interface CustomerRow {
  id: string;
  name: string;
  base_postcode: string;
  open_time: string;
  close_time: string;
  run_count: number;
}

interface EditFields {
  name: string;
  base_postcode: string;
  open_time: string;
  close_time: string;
}

export default function AdminCustomersPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New customer
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPostcode, setNewPostcode] = useState("");
  const [newOpen, setNewOpen] = useState("08:00");
  const [newClose, setNewClose] = useState("17:00");
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({
    name: "",
    base_postcode: "",
    open_time: "",
    close_time: "",
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await listCustomers();
    if (result.error) setError(result.error);
    else setCustomers(result.customers);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    queueMicrotask(() => { load(); });
  }, [profile, load]);

  async function handleAddCustomer(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!newName.trim()) {
      setFormError("Name is required.");
      return;
    }
    setFormLoading(true);
    const result = await createCustomer(newName, newPostcode, newOpen, newClose);
    setFormLoading(false);
    if (result.error) {
      setFormError(result.error);
      return;
    }
    setNewName("");
    setNewPostcode("");
    setNewOpen("08:00");
    setNewClose("17:00");
    setShowForm(false);
    await load();
  }

  function startEditing(c: CustomerRow) {
    setEditingId(c.id);
    setEditFields({
      name: c.name,
      base_postcode: c.base_postcode,
      open_time: c.open_time,
      close_time: c.close_time,
    });
  }

  async function saveEditing() {
    if (!editingId) return;
    setError("");
    const result = await updateCustomer(editingId, editFields);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    await load();
  }

  async function handleDelete(c: CustomerRow) {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
    const result = await deleteCustomer(c.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    await load();
  }

  if (authLoading || profile?.role !== "admin") {
    return <div className="muted">Loading…</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <div className="page-subtitle">
            Manage customer accounts, opening hours, and base postcodes.{" "}
            <Link href="/admin/nicknames" style={{ color: "var(--mlc-blue)" }}>
              Manage postcode nicknames →
            </Link>
          </div>
        </div>
        <div className="row gap-8">
          <button
            type="button"
            className="btn primary sm"
            onClick={() => setShowForm((v) => !v)}
          >
            <Icon name={showForm ? "x" : "plus"} size={11} />
            {showForm ? "Cancel" : "New customer"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleAddCustomer}
          className="card"
          style={{ marginBottom: 16 }}
        >
          <div className="card-header"><h3>New customer</h3></div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme Logistics"
                className="input"
              />
            </div>
            <div className="field">
              <label>Base postcode</label>
              <input
                type="text"
                value={newPostcode}
                onChange={(e) => setNewPostcode(e.target.value)}
                placeholder="e.g. GL2 7ND"
                className="input"
              />
            </div>
            <div className="field">
              <label>Opening time</label>
              <input
                type="time"
                value={newOpen}
                onChange={(e) => setNewOpen(e.target.value)}
                className="input"
              />
            </div>
            <div className="field">
              <label>Closing time</label>
              <input
                type="time"
                value={newClose}
                onChange={(e) => setNewClose(e.target.value)}
                className="input"
              />
            </div>
            {formError && (
              <div style={{ gridColumn: "span 2", color: "var(--err)", fontSize: 12.5 }}>
                {formError}
              </div>
            )}
            <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="btn primary sm" disabled={formLoading}>
                <Icon name="check" size={11} /> {formLoading ? "Saving…" : "Add customer"}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div className="muted">Loading customers…</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Base postcode</th>
                <th>Hours</th>
                <th className="right">Runs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) =>
                editingId === c.id ? (
                  <tr key={c.id} style={{ cursor: "default", background: "var(--surface-alt)" }}>
                    <td>
                      <input
                        type="text"
                        value={editFields.name}
                        onChange={(e) => setEditFields({ ...editFields, name: e.target.value })}
                        className="input"
                        style={{ height: 28, fontSize: 12.5 }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={editFields.base_postcode}
                        onChange={(e) => setEditFields({ ...editFields, base_postcode: e.target.value })}
                        className="input"
                        style={{ height: 28, fontSize: 12.5 }}
                      />
                    </td>
                    <td>
                      <span className="row gap-4">
                        <input
                          type="time"
                          value={editFields.open_time}
                          onChange={(e) => setEditFields({ ...editFields, open_time: e.target.value })}
                          className="input"
                          style={{ height: 28, fontSize: 12.5, width: 100 }}
                        />
                        <span className="muted">–</span>
                        <input
                          type="time"
                          value={editFields.close_time}
                          onChange={(e) => setEditFields({ ...editFields, close_time: e.target.value })}
                          className="input"
                          style={{ height: 28, fontSize: 12.5, width: 100 }}
                        />
                      </span>
                    </td>
                    <td className="right mono tnum">{c.run_count}</td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn primary sm" onClick={() => void saveEditing()}>
                        <Icon name="check" size={11} /> Save
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => setEditingId(null)}
                        style={{ marginLeft: 4 }}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} style={{ cursor: "default" }}>
                    <td className="bold">{c.name}</td>
                    <td className="mono">
                      {c.base_postcode || <span className="muted">—</span>}
                    </td>
                    <td className="mono">
                      {c.open_time}–{c.close_time}
                    </td>
                    <td className="right">
                      {c.run_count > 0 ? (
                        <Link
                          href={`/runs?customer=${encodeURIComponent(c.name)}`}
                          className="mono tnum"
                          style={{ color: "var(--mlc-blue)" }}
                        >
                          {c.run_count}
                        </Link>
                      ) : (
                        <span className="muted mono tnum">0</span>
                      )}
                    </td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => startEditing(c)}
                      >
                        <Icon name="settings" size={11} /> Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={{ color: "var(--err)" }}
                        onClick={() => void handleDelete(c)}
                      >
                        <Icon name="x" size={11} /> Delete
                      </button>
                    </td>
                  </tr>
                )
              )}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
                    No customers yet. Click <strong>+ New customer</strong> to add one.
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
