"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { inviteUser, updateUserRole, toggleUserActive, updateAllowedCustomers, listUsers } from "./actions";

const ALL_CUSTOMERS = ["Montpellier", "Customer A", "Customer B", "Consolid8", "Ashwood"];

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
  allowed_customers: string[];
  created_at: string;
};

export default function AdminUsersPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New user form
  const [showForm, setShowForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("customer");
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, profile, router]);

  // Load users
  useEffect(() => {
    if (profile?.role === "admin") {
      loadUsers();
    }
  }, [profile]);

  async function loadUsers() {
    setLoading(true);
    const result = await listUsers();
    if (result.error) {
      setError(result.error);
    } else {
      setUsers(result.users);
    }
    setLoading(false);
  }

  async function handleInviteUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setFormLoading(true);

    const result = await inviteUser(newEmail, newRole);
    if (result.error) {
      setFormError(result.error);
      setFormLoading(false);
      return;
    }

    setNewEmail("");
    setNewRole("customer");
    setShowForm(false);
    setFormLoading(false);
    await loadUsers();
  }

  async function handleRoleChange(userId: string, role: string) {
    const result = await updateUserRole(userId, role);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadUsers();
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    const result = await toggleUserActive(userId, !currentActive);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadUsers();
  }

  async function handleCustomerToggle(userId: string, customer: string, current: string[]) {
    const updated = current.includes(customer)
      ? current.filter((c) => c !== customer)
      : [...current, customer];
    const result = await updateAllowedCustomers(userId, updated);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadUsers();
  }

  if (authLoading || profile?.role !== "admin") {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navigation />
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-xl md:text-3xl font-bold">User Management</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            {showForm ? "Cancel" : "Add User"}
          </button>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {/* Add User Form */}
        {showForm && (
          <form
            onSubmit={handleInviteUser}
            className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6 space-y-3"
          >
            <h2 className="text-lg font-semibold mb-2">Invite User</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="customer">Customer</option>
                  <option value="driver">Driver</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {formError && (
              <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={formLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {formLoading ? "Sending invite..." : "Send Invite"}
            </button>
          </form>
        )}

        {/* Users List */}
        {loading ? (
          <p className="text-gray-400">Loading users...</p>
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <div key={u.id} className="border border-white/10 rounded-xl bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-sm">{u.email}</div>
                    {u.full_name && <div className="text-xs text-gray-400">{u.full_name}</div>}
                    <div className="text-xs text-gray-500 mt-0.5">
                      Joined {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded ${
                        u.active
                          ? "bg-emerald-400/10 text-emerald-400"
                          : "bg-red-400/10 text-red-400"
                      }`}
                    >
                      {u.active ? "Active" : "Disabled"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Role</label>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="customer">Customer</option>
                      <option value="driver">Driver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <button
                    onClick={() => handleToggleActive(u.id, u.active)}
                    className={`mt-5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      u.active
                        ? "border-red-400/30 text-red-400 hover:bg-red-400/10"
                        : "border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10"
                    }`}
                  >
                    {u.active ? "Disable" : "Enable"}
                  </button>
                </div>

                {/* Customer access (only shown for non-admin roles) */}
                {u.role !== "admin" && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <div className="text-xs text-gray-400 mb-2">Allowed customers</div>
                    <div className="flex flex-wrap gap-2">
                      {ALL_CUSTOMERS.map((c) => {
                        const allowed = u.allowed_customers ?? [];
                        const isSelected = allowed.includes(c);
                        return (
                          <button
                            key={c}
                            onClick={() => handleCustomerToggle(u.id, c, allowed)}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                              isSelected
                                ? "bg-blue-500/20 text-blue-400 border-blue-400/30"
                                : "bg-white/5 text-gray-500 border-white/10 hover:text-gray-300"
                            }`}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                    {(!u.allowed_customers || u.allowed_customers.length === 0) && (
                      <div className="text-xs text-gray-600 mt-1">No customers assigned — user will see nothing.</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {users.length === 0 && (
              <div className="py-8 text-center text-gray-500">No users found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
