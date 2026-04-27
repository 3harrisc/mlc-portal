"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import {
  inviteUser,
  createUserWithPassword,
  updateUserRole,
  toggleUserActive,
  updateAllowedCustomers,
  updateAssignedVehicle,
  listUsers,
  resendInvite,
  deleteUser,
} from "./actions";
import { fetchCustomerNames } from "@/lib/customers";
import { listVehicles } from "@/app/actions/fleet";

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
  allowed_customers: string[];
  created_at: string;
  invite_accepted: boolean;
  assigned_vehicle: string | null;
}

export default function AdminUsersPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [createMode, setCreateMode] = useState<"invite" | "manual">("invite");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("customer");
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    const result = await listUsers();
    if (result.error) setError(result.error);
    else setUsers(result.users);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    queueMicrotask(async () => {
      await loadUsers();
      const [cns, vs] = await Promise.all([fetchCustomerNames(), listVehicles()]);
      setCustomerNames(cns);
      setVehicleIds((vs.vehicles ?? []).filter((v) => v.active).map((v) => v.id));
    });
  }, [profile, loadUsers]);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setFormLoading(true);
    let result;
    if (createMode === "manual") {
      if (newPassword.length < 6) {
        setFormError("Password must be at least 6 characters.");
        setFormLoading(false);
        return;
      }
      result = await createUserWithPassword(newEmail, newPassword, newRole);
    } else {
      result = await inviteUser(newEmail, newRole);
    }
    setFormLoading(false);
    if (result.error) { setFormError(result.error); return; }
    setNewEmail(""); setNewPassword(""); setNewRole("customer"); setShowForm(false);
    await loadUsers();
  }

  async function handleRoleChange(userId: string, role: string) {
    const result = await updateUserRole(userId, role);
    if (result.error) { setError(result.error); return; }
    await loadUsers();
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    const result = await toggleUserActive(userId, !currentActive);
    if (result.error) { setError(result.error); return; }
    await loadUsers();
  }

  async function handleResendInvite(userId: string, email: string) {
    const result = await resendInvite(userId, email);
    if (result.error) { setError(result.error); return; }
    setError("");
    alert("Invite email resent to " + email);
  }

  async function handleDeleteUser(userId: string, email: string) {
    if (!confirm(`Permanently delete ${email}? This cannot be undone.`)) return;
    const result = await deleteUser(userId);
    if (result.error) { setError(result.error); return; }
    await loadUsers();
  }

  const vehicleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function handleVehicleChange(userId: string, vehicle: string) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, assigned_vehicle: vehicle } : u)));
    if (vehicleTimers.current[userId]) clearTimeout(vehicleTimers.current[userId]);
    vehicleTimers.current[userId] = setTimeout(() => {
      updateAssignedVehicle(userId, vehicle.trim() || null);
    }, 400);
  }

  async function handleCustomerToggle(userId: string, customer: string, current: string[]) {
    const updated = current.includes(customer)
      ? current.filter((c) => c !== customer)
      : [...current, customer];
    const result = await updateAllowedCustomers(userId, updated);
    if (result.error) { setError(result.error); return; }
    await loadUsers();
  }

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <div className="page-subtitle">Manage portal access, roles, customer scopes, and driver vehicle assignments.</div>
        </div>
        <button type="button" className="btn primary sm" onClick={() => setShowForm((v) => !v)}>
          <Icon name={showForm ? "x" : "plus"} size={11} />
          {showForm ? "Cancel" : "New user"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleAddUser} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>New user</h3></div>
          <div className="card-body">
            <div className="seg" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={createMode === "invite" ? "active" : ""}
                onClick={() => setCreateMode("invite")}
              >
                Send invite email
              </button>
              <button
                type="button"
                className={createMode === "manual" ? "active" : ""}
                onClick={() => setCreateMode("manual")}
              >
                Set login manually
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <div className="field">
                <label>Email</label>
                <input type="email" required value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="input" placeholder="user@example.com" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="select">
                  <option value="customer">Customer</option>
                  <option value="driver">Driver</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {createMode === "manual" && (
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Password</label>
                  <input type="text" required minLength={6} value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input" placeholder="Min 6 characters" />
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Share these credentials — the user can log in straight away.
                  </div>
                </div>
              )}
              {formError && (
                <div style={{ gridColumn: "span 2", color: "var(--err)", fontSize: 12.5 }}>{formError}</div>
              )}
              <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="btn primary sm" disabled={formLoading}>
                  <Icon name="check" size={11} />{" "}
                  {formLoading
                    ? createMode === "manual" ? "Creating…" : "Sending invite…"
                    : createMode === "manual" ? "Create user" : "Send invite"}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div className="muted">Loading users…</div>
      ) : users.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
            No users yet.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {users.map((u) => (
            <div key={u.id} className="card">
              <div className="card-header">
                <h3>{u.full_name || u.email}</h3>
                {u.full_name && <span className="muted" style={{ fontSize: 11 }}>{u.email}</span>}
                <div className="actions">
                  {!u.invite_accepted && (
                    <span className="pill loading"><span className="dot" />Invite pending</span>
                  )}
                  <span className={`pill ${u.active ? "delivered" : "exception"}`}>
                    <span className="dot" />{u.active ? "Active" : "Disabled"}
                  </span>
                </div>
              </div>
              <div className="card-body">
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div className="field">
                    <label>Role</label>
                    <select
                      value={u.role}
                      onChange={(e) => void handleRoleChange(u.id, e.target.value)}
                      className="select"
                      style={{ width: 120 }}
                    >
                      <option value="customer">Customer</option>
                      <option value="driver">Driver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    style={{ color: u.active ? "var(--err)" : "var(--ok)" }}
                    onClick={() => void handleToggleActive(u.id, u.active)}
                  >
                    {u.active ? "Disable" : "Enable"}
                  </button>
                  <button type="button" className="btn sm" onClick={() => void handleResendInvite(u.id, u.email)}>
                    <Icon name="refresh" size={11} /> Resend invite
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ color: "var(--err)" }}
                    onClick={() => void handleDeleteUser(u.id, u.email)}
                  >
                    <Icon name="x" size={11} /> Delete
                  </button>
                  <span className="spacer" />
                  <span className="muted" style={{ fontSize: 11 }}>
                    {u.invite_accepted
                      ? `Joined ${new Date(u.created_at).toLocaleDateString()}`
                      : `Invited ${new Date(u.created_at).toLocaleDateString()}`}
                  </span>
                </div>

                {u.role !== "admin" && (
                  <div className="divider" />
                )}

                {u.role !== "admin" && (
                  <div>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 6, fontWeight: 600 }}>
                      ALLOWED CUSTOMERS
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {customerNames.map((c) => {
                        const allowed = u.allowed_customers ?? [];
                        const isSelected = allowed.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            className={`filter-chip ${isSelected ? "active" : ""}`}
                            onClick={() => void handleCustomerToggle(u.id, c, allowed)}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                    {(!u.allowed_customers || u.allowed_customers.length === 0) && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                        No customers assigned — user will see nothing.
                      </div>
                    )}
                  </div>
                )}

                {u.role === "driver" && (
                  <>
                    <div className="divider" />
                    <div className="field" style={{ maxWidth: 280 }}>
                      <label>Assigned vehicle</label>
                      <input
                        list={`vehicles-${u.id}`}
                        value={u.assigned_vehicle ?? ""}
                        onChange={(e) => handleVehicleChange(u.id, e.target.value)}
                        placeholder="Pick from fleet or type"
                        className="input mono"
                      />
                      <datalist id={`vehicles-${u.id}`}>
                        {vehicleIds.map((v) => <option key={v} value={v} />)}
                      </datalist>
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                        Must match the vehicle code on runs (case-insensitive).
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
