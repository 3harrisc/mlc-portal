"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import {
  listNicknames,
  upsertNickname,
  deleteNickname,
} from "@/app/actions/nicknames";

type NicknameRow = { postcode: string; nickname: string };

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
    if (!authLoading && profile?.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, profile, router]);

  async function load() {
    setLoading(true);
    const result = await listNicknames();
    if (result.error) {
      setError(result.error);
    } else {
      setNicknames(result.nicknames);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (profile?.role === "admin") load();
  }, [profile]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newPostcode.trim() || !newNickname.trim()) return;
    setFormLoading(true);
    setError("");

    const result = await upsertNickname(newPostcode, newNickname);
    if (result.error) {
      setError(result.error);
    } else {
      setNewPostcode("");
      setNewNickname("");
      await load();
    }
    setFormLoading(false);
  }

  async function handleSaveEdit(postcode: string) {
    if (!editNickname.trim()) return;
    const result = await upsertNickname(postcode, editNickname);
    if (result.error) {
      setError(result.error);
    } else {
      setEditingPc(null);
      await load();
    }
  }

  async function handleDelete(postcode: string) {
    if (!confirm(`Delete nickname for ${postcode}?`)) return;
    const result = await deleteNickname(postcode);
    if (result.error) {
      setError(result.error);
    } else {
      await load();
    }
  }

  if (authLoading || profile?.role !== "admin") {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navigation />
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <h1 className="text-xl md:text-3xl font-bold mb-2">
          Postcode Nicknames
        </h1>
        <p className="text-sm text-gray-400 mb-6">
          Add friendly names to postcodes. These show alongside postcodes on
          runs, driver pages, and reports.
        </p>

        {error && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {/* Add form */}
        <form
          onSubmit={handleAdd}
          className="flex items-end gap-3 mb-6 flex-wrap"
        >
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Postcode
            </label>
            <input
              type="text"
              value={newPostcode}
              onChange={(e) => setNewPostcode(e.target.value)}
              placeholder="e.g. NG22 8TX"
              required
              className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-400 mb-1">
              Nickname
            </label>
            <input
              type="text"
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              placeholder="e.g. Brakes Newark"
              required
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={formLoading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {formLoading ? "Adding..." : "Add"}
          </button>
        </form>

        {/* List */}
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : nicknames.length === 0 ? (
          <div className="text-gray-400 py-8 text-center">
            No nicknames yet. Add one above.
          </div>
        ) : (
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-4 py-2 text-gray-400 font-medium">
                    Postcode
                  </th>
                  <th className="text-left px-4 py-2 text-gray-400 font-medium">
                    Nickname
                  </th>
                  <th className="text-right px-4 py-2 text-gray-400 font-medium w-32">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {nicknames.map((n) => (
                  <tr key={n.postcode}>
                    <td className="px-4 py-2.5 font-mono text-gray-300">
                      {n.postcode}
                    </td>
                    <td className="px-4 py-2.5">
                      {editingPc === n.postcode ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editNickname}
                            onChange={(e) => setEditNickname(e.target.value)}
                            className="px-2 py-1 bg-white/5 border border-white/10 rounded text-white flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(n.postcode);
                              if (e.key === "Escape") setEditingPc(null);
                            }}
                          />
                          <button
                            onClick={() => handleSaveEdit(n.postcode)}
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingPc(null)}
                            className="text-xs text-gray-400 hover:text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        n.nickname
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {editingPc !== n.postcode && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditingPc(n.postcode);
                              setEditNickname(n.nickname);
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(n.postcode)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
