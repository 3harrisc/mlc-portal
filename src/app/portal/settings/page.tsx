"use client";

import { useEffect, useState, useTransition } from "react";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import { useToast } from "@/components/portal/ToastContext";
import {
  inviteUser,
  listUsers,
  updateUserRole,
  toggleUserActive,
  resendInvite,
  deleteUser,
} from "@/app/admin/users/actions";
import {
  listCustomers,
  updateCustomerContacts,
} from "@/app/admin/customers/actions";

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "customer" | "driver";
  active: boolean;
  invite_accepted: boolean;
  allowed_customers: string[];
  assigned_vehicle: string | null;
}

interface CustomerRow {
  id: string;
  name: string;
  notification_emails: string[];
  primary_contact_name: string | null;
  auto_created: boolean;
  run_count?: number;
}

const ROLES: Array<UserRow["role"]> = ["admin", "customer", "driver"];

export default function SettingsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isAdmin = profile?.role === "admin";

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Account &amp; users</h1>
          <div className="page-subtitle">
            {isAdmin
              ? "Manage who has access to the portal and how customers are notified"
              : "Your profile and access"}
          </div>
        </div>
      </div>

      <ProfileCard />

      {isAdmin && (
        <>
          <div style={{ marginTop: 16 }}>
            <UsersCard onToast={showToast} currentUserId={profile?.id} />
          </div>
          <div style={{ marginTop: 16 }}>
            <CustomersCard onToast={showToast} />
          </div>
        </>
      )}
    </>
  );
}

function ProfileCard() {
  const { profile, user } = useAuth();
  if (!profile) return null;
  return (
    <div className="card">
      <div className="card-header">
        <h3>Your profile</h3>
      </div>
      <div className="card-body">
        <div className="row gap-12">
          <div
            className="avatar"
            style={{ width: 48, height: 48, fontSize: 16 }}
          >
            {(profile.full_name ?? profile.email)
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase() ?? "")
              .join("") || "··"}
          </div>
          <div style={{ flex: 1 }}>
            <div className="bold" style={{ fontSize: 14 }}>
              {profile.full_name || profile.email}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {profile.email}
            </div>
          </div>
          <div className="col" style={{ alignItems: "flex-end", gap: 4 }}>
            <span className="pill in-transit">
              <span className="dot" />
              {profile.role}
            </span>
            <span className="muted mono" style={{ fontSize: 10.5 }}>
              {user?.id?.slice(0, 8)}
            </span>
          </div>
        </div>
        {profile.allowed_customers.length > 0 && (
          <>
            <div className="divider" />
            <div style={{ fontSize: 11.5 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                Allowed customers
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {profile.allowed_customers.map((c) => (
                  <span key={c} className="filter-chip" style={{ cursor: "default" }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UsersCard({
  onToast,
  currentUserId,
}: {
  onToast: (msg: string, kind?: "ok" | "err") => void;
  currentUserId: string | undefined;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRow["role"]>("customer");
  const [isPending, startTransition] = useTransition();

  const reload = () => {
    void (async () => {
      const res = await listUsers();
      if (!res.error) setUsers(res.users as UserRow[]);
      setLoading(false);
    })();
  };

  useEffect(reload, []);

  const handleInvite = () => {
    if (!inviteEmail.trim()) {
      onToast("Enter an email address.", "err");
      return;
    }
    startTransition(async () => {
      const res = await inviteUser(inviteEmail.trim(), inviteRole);
      if (res.error) {
        onToast(`Invite failed: ${res.error}`, "err");
        return;
      }
      onToast(`Invite sent to ${inviteEmail}.`);
      setInviteEmail("");
      reload();
    });
  };

  const handleRoleChange = (id: string, role: UserRow["role"]) => {
    startTransition(async () => {
      const res = await updateUserRole(id, role);
      if (res.error) onToast(`Update failed: ${res.error}`, "err");
      else {
        onToast("Role updated.");
        reload();
      }
    });
  };

  const handleToggle = (id: string, active: boolean) => {
    startTransition(async () => {
      const res = await toggleUserActive(id, active);
      if (res.error) onToast(`Update failed: ${res.error}`, "err");
      else {
        onToast(active ? "User reactivated." : "User deactivated.");
        reload();
      }
    });
  };

  const handleResend = (id: string, email: string) => {
    startTransition(async () => {
      const res = await resendInvite(id, email);
      if (res.error) onToast(`Resend failed: ${res.error}`, "err");
      else onToast(`Invite re-sent to ${email}.`);
    });
  };

  const handleDelete = (id: string, email: string) => {
    if (!window.confirm(`Delete user ${email}? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteUser(id);
      if (res.error) onToast(`Delete failed: ${res.error}`, "err");
      else {
        onToast(`User ${email} deleted.`);
        reload();
      }
    });
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>Users</h3>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {users.length}
        </span>
      </div>
      <div
        className="card-body"
        style={{
          padding: 12,
          borderBottom: "1px solid var(--line)",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>Invite by email</label>
          <input
            className="input"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select
            className="select"
            value={inviteRole}
            onChange={(e) =>
              setInviteRole(e.target.value as UserRow["role"])
            }
          >
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <button
          className="btn primary"
          type="button"
          onClick={handleInvite}
          disabled={isPending}
        >
          <Icon name="plus" size={13} /> Invite
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Allowed customers</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="bold" style={{ fontSize: 12.5 }}>
                    {u.full_name || u.email}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {u.email}
                  </div>
                </td>
                <td>
                  <select
                    className="select"
                    value={u.role}
                    onChange={(e) =>
                      handleRoleChange(u.id, e.target.value as UserRow["role"])
                    }
                    disabled={isPending}
                    style={{ height: 28, fontSize: 12 }}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {!u.active ? (
                    <span className="pill scheduled">
                      <span className="dot" />
                      Inactive
                    </span>
                  ) : !u.invite_accepted ? (
                    <span className="pill delayed">
                      <span className="dot" />
                      Pending
                    </span>
                  ) : (
                    <span className="pill delivered">
                      <span className="dot" />
                      Active
                    </span>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {u.allowed_customers.length === 0
                    ? "All / unrestricted"
                    : u.allowed_customers.join(", ")}
                </td>
                <td>
                  <div className="row gap-4">
                    {!u.invite_accepted && (
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => handleResend(u.id, u.email)}
                        disabled={isPending}
                      >
                        Resend
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => handleToggle(u.id, !u.active)}
                      disabled={isPending}
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                    {u.id !== currentUserId && (
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => handleDelete(u.id, u.email)}
                        disabled={isPending}
                        style={{ color: "var(--err)" }}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--ink-500)",
                    fontSize: 12.5,
                  }}
                >
                  No users yet. Invite the first one above.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--ink-500)",
                    fontSize: 12.5,
                  }}
                >
                  Loading users…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersCard({
  onToast,
}: {
  onToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmails, setEditEmails] = useState("");
  const [editName, setEditName] = useState("");
  const [isPending, startTransition] = useTransition();

  const reload = () => {
    void (async () => {
      const res = await listCustomers();
      if (!res.error) setCustomers(res.customers as CustomerRow[]);
      setLoading(false);
    })();
  };

  useEffect(reload, []);

  const startEdit = (c: CustomerRow) => {
    setEditingId(c.id);
    setEditEmails(c.notification_emails.join(", "));
    setEditName(c.primary_contact_name ?? "");
  };

  const saveEdit = (id: string) => {
    const emails = editEmails
      .split(/[,\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await updateCustomerContacts(id, {
        notification_emails: emails,
        primary_contact_name: editName,
      });
      if (res.error) {
        onToast(`Update failed: ${res.error}`, "err");
        return;
      }
      onToast("Customer contacts updated.");
      setEditingId(null);
      reload();
    });
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>Customer notification contacts</h3>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {customers.length}
        </span>
        <div className="actions">
          <span className="muted" style={{ fontSize: 11 }}>
            Auto-created on first booking
          </span>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Notification emails</th>
              <th>Primary contact</th>
              <th>Loads</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const isEditing = editingId === c.id;
              return (
                <tr key={c.id}>
                  <td>
                    <div className="bold" style={{ fontSize: 12.5 }}>
                      {c.name}
                    </div>
                    {c.auto_created && (
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        Auto-created · review and confirm
                      </div>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        className="input mono"
                        value={editEmails}
                        onChange={(e) => setEditEmails(e.target.value)}
                        placeholder="ops@cust.com, dispatch@cust.com"
                        style={{ height: 28, fontSize: 11 }}
                      />
                    ) : c.notification_emails.length > 0 ? (
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-700)" }}
                      >
                        {c.notification_emails.join(", ")}
                      </div>
                    ) : (
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        None
                      </span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        className="input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Contact name"
                        style={{ height: 28, fontSize: 11.5 }}
                      />
                    ) : (
                      <div style={{ fontSize: 12 }}>
                        {c.primary_contact_name || (
                          <span className="muted">—</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="mono tnum" style={{ fontSize: 11.5 }}>
                    {c.run_count ?? 0}
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="row gap-4">
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() => saveEdit(c.id)}
                          disabled={isPending}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => setEditingId(null)}
                          disabled={isPending}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => startEdit(c)}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && customers.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--ink-500)",
                    fontSize: 12.5,
                  }}
                >
                  No customers yet. They&apos;ll appear here automatically as
                  bookings come in.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--ink-500)",
                    fontSize: 12.5,
                  }}
                >
                  Loading customers…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
