"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { inviteUser, updateUserRole, toggleUserActive, listUsers } from "./actions";

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
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

    // Reset form and reload
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

  if (authLoading || profile?.role !== "admin") {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navigation />
        <div className="max-w-6xl mx-auto p-8">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">User Management</h1>
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

        {/* Users Table */}
        {loading ? (
          <p className="text-gray-400">Loading users...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-3 px-4 text-sm font-semibold text-gray-300">Email</th>
                  <th className="py-3 px-4 text-sm font-semibold text-gray-300">Role</th>
                  <th className="py-3 px-4 text-sm font-semibold text-gray-300">Status</th>
                  <th className="py-3 px-4 text-sm font-semibold text-gray-300">Created</th>
                  <th className="py-3 px-4 text-sm font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 px-4 text-sm text-white">
                      {u.email}
                      {u.full_name && (
                        <span className="ml-2 text-gray-400">({u.full_name})</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="px-2 py-1 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="customer">Customer</option>
                        <option value="driver">Driver</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded ${
                          u.active
                            ? "bg-emerald-400/10 text-emerald-400"
                            : "bg-red-400/10 text-red-400"
                        }`}
                      >
                        {u.active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-400">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggleActive(u.id, u.active)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          u.active
                            ? "border-red-400/30 text-red-400 hover:bg-red-400/10"
                            : "border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10"
                        }`}
                      >
                        {u.active ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
