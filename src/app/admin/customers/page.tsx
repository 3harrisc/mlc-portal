"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { listCustomers, createCustomer, updateCustomer, deleteCustomer } from "./actions";

type CustomerRow = {
  id: string;
  name: string;
  base_postcode: string;
  open_time: string;
  close_time: string;
  run_count: number;
};

export default function AdminCustomersPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New customer form
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPostcode, setNewPostcode] = useState("");
  const [newOpen, setNewOpen] = useState("08:00");
  const [newClose, setNewClose] = useState("17:00");
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<{
    name: string;
    base_postcode: string;
    open_time: string;
    close_time: string;
  }>({ name: "", base_postcode: "", open_time: "", close_time: "" });

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, profile, router]);

  // Load customers
  useEffect(() => {
    if (profile?.role === "admin") {
      loadCustomers();
    }
  }, [profile]);

  async function loadCustomers() {
    setLoading(true);
    const result = await listCustomers();
    if (result.error) {
      setError(result.error);
    } else {
      setCustomers(result.customers);
    }
    setLoading(false);
  }

  async function handleAddCustomer(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setFormLoading(true);

    if (!newName.trim()) {
      setFormError("Name is required.");
      setFormLoading(false);
      return;
    }

    const result = await createCustomer(newName, newPostcode, newOpen, newClose);
    if (result.error) {
      setFormError(result.error);
      setFormLoading(false);
      return;
    }

    setNewName("");
    setNewPostcode("");
    setNewOpen("08:00");
    setNewClose("17:00");
    setShowForm(false);
    setFormLoading(false);
    await loadCustomers();
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
    await loadCustomers();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) {
      return;
    }
    const result = await deleteCustomer(id);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadCustomers();
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
          <div>
            <h1 className="text-xl md:text-3xl font-bold">Customer Management</h1>
            <Link href="/admin/nicknames" className="text-sm text-blue-400 hover:text-blue-300 mt-1 inline-block">
              Manage postcode nicknames &rarr;
            </Link>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            {showForm ? "Cancel" : "Add Customer"}
          </button>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {/* Add Customer Form */}
        {showForm && (
          <form
            onSubmit={handleAddCustomer}
            className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6 space-y-3"
          >
            <h2 className="text-lg font-semibold mb-2">Add Customer</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Acme Logistics"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Base Postcode</label>
                <input
                  type="text"
                  value={newPostcode}
                  onChange={(e) => setNewPostcode(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. GL2 7ND"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Opening Time</label>
                <input
                  type="time"
                  value={newOpen}
                  onChange={(e) => setNewOpen(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Closing Time</label>
                <input
                  type="time"
                  value={newClose}
                  onChange={(e) => setNewClose(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
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
              {formLoading ? "Creating..." : "Create Customer"}
            </button>
          </form>
        )}

        {/* Customers List */}
        {loading ? (
          <p className="text-gray-400">Loading customers...</p>
        ) : (
          <div className="space-y-3">
            {customers.map((c) => (
              <div key={c.id} className="border border-white/10 rounded-xl bg-white/5 p-4">
                {editingId === c.id ? (
                  /* Editing mode */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Name</label>
                        <input
                          type="text"
                          value={editFields.name}
                          onChange={(e) => setEditFields({ ...editFields, name: e.target.value })}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Base Postcode</label>
                        <input
                          type="text"
                          value={editFields.base_postcode}
                          onChange={(e) => setEditFields({ ...editFields, base_postcode: e.target.value })}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Opening Time</label>
                        <input
                          type="time"
                          value={editFields.open_time}
                          onChange={(e) => setEditFields({ ...editFields, open_time: e.target.value })}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Closing Time</label>
                        <input
                          type="time"
                          value={editFields.close_time}
                          onChange={(e) => setEditFields({ ...editFields, close_time: e.target.value })}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEditing}
                        className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-gray-400 hover:bg-white/10 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="font-semibold text-sm">{c.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {c.base_postcode ? `Base: ${c.base_postcode}` : "No base postcode"} &middot;{" "}
                          {c.open_time}&ndash;{c.close_time}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-400/10 text-blue-400">
                          {c.run_count} run{c.run_count === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => startEditing(c)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-blue-400/30 text-blue-400 hover:bg-blue-400/10 transition-colors"
                      >
                        Edit
                      </button>

                      {c.run_count > 0 ? (
                        <Link
                          href={`/runs?customer=${encodeURIComponent(c.name)}`}
                          className="text-xs px-3 py-1.5 rounded-lg border border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 transition-colors"
                        >
                          View runs
                        </Link>
                      ) : null}

                      <button
                        onClick={() => handleDelete(c.id, c.name)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {customers.length === 0 && (
              <div className="py-8 text-center text-gray-500">No customers found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
