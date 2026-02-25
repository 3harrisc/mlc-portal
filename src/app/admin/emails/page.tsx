"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type EmailLog = {
  id: string;
  from_address: string | null;
  subject: string | null;
  body: string | null;
  parsed_data: {
    customer?: string;
    date?: string;
    postcodes?: { postcode: string; time?: string }[];
    vehicle?: string;
    loadRef?: string;
    notes?: string;
  } | null;
  run_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export default function AdminEmailsPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") {
      router.push("/");
    }
  }, [authLoading, profile, router]);

  async function loadLogs() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("email_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs((data as EmailLog[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (profile?.role === "admin") loadLogs();
  }, [profile]);

  async function handleRetry(log: EmailLog) {
    if (!log.body) return;

    const cronSecret = prompt(
      "Enter CRON_SECRET to re-process this email:"
    );
    if (!cronSecret) return;

    const res = await fetch("/api/email-to-run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        From: log.from_address || "",
        Subject: log.subject || "",
        TextBody: log.body,
      }),
    });

    const data = await res.json();
    if (data.ok) {
      alert(`Run created: ${data.jobNumber}`);
      await loadLogs();
    } else {
      alert(`Error: ${data.error || "Unknown error"}`);
    }
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
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-xl md:text-3xl font-bold">Email Imports</h1>
            <p className="text-sm text-gray-400 mt-1">
              Emails parsed by AI and converted to runs
            </p>
          </div>
          <button
            onClick={loadLogs}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {loading && logs.length === 0 ? (
          <p className="text-gray-400">Loading email logs...</p>
        ) : logs.length === 0 ? (
          <div className="text-gray-400 py-8 text-center">
            No emails received yet. Forward backload emails to your Postmark
            inbound address to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => {
              const isExpanded = expandedId === log.id;
              const isSuccess = log.status === "created";
              const isError = log.status === "error";
              const parsed = log.parsed_data;

              return (
                <div
                  key={log.id}
                  className={`border rounded-xl overflow-hidden ${
                    isSuccess
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : isError
                      ? "border-red-500/30 bg-red-500/5"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : log.id)
                    }
                    className="w-full text-left p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500">
                            {new Date(log.created_at).toLocaleDateString(
                              "en-GB",
                              {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </span>
                          {log.from_address && (
                            <span className="text-xs text-gray-400">
                              From: {log.from_address}
                            </span>
                          )}
                        </div>
                        <div className="font-semibold text-sm mt-1 truncate">
                          {log.subject || "(no subject)"}
                        </div>

                        {isSuccess && parsed && (
                          <div className="text-xs text-gray-400 mt-1">
                            {parsed.customer && (
                              <span>{parsed.customer} &middot; </span>
                            )}
                            {parsed.postcodes && (
                              <span>
                                {parsed.postcodes.length} stop
                                {parsed.postcodes.length !== 1 ? "s" : ""}{" "}
                                &middot;{" "}
                              </span>
                            )}
                            {parsed.vehicle && (
                              <span>Vehicle: {parsed.vehicle}</span>
                            )}
                          </div>
                        )}

                        {isError && log.error && (
                          <div className="text-xs text-red-400 mt-1">
                            {log.error}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {isSuccess && log.run_id && (
                          <Link
                            href={`/runs/${log.run_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium"
                          >
                            View Run
                          </Link>
                        )}
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded ${
                            isSuccess
                              ? "bg-emerald-400/10 text-emerald-400"
                              : isError
                              ? "bg-red-400/10 text-red-400"
                              : "bg-gray-400/10 text-gray-400"
                          }`}
                        >
                          {isSuccess
                            ? "Created"
                            : isError
                            ? "Error"
                            : log.status}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-white/10 px-4 py-3 space-y-3">
                      {/* Parsed data */}
                      {parsed && (
                        <div>
                          <div className="text-xs text-gray-400 font-semibold mb-1">
                            PARSED DATA
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-gray-500">Customer:</span>{" "}
                              {parsed.customer || "—"}
                            </div>
                            <div>
                              <span className="text-gray-500">Date:</span>{" "}
                              {parsed.date || "—"}
                            </div>
                            <div>
                              <span className="text-gray-500">Vehicle:</span>{" "}
                              {parsed.vehicle || "—"}
                            </div>
                            <div>
                              <span className="text-gray-500">Ref:</span>{" "}
                              {parsed.loadRef || "—"}
                            </div>
                          </div>
                          {parsed.postcodes &&
                            parsed.postcodes.length > 0 && (
                              <div className="mt-2">
                                <span className="text-xs text-gray-500">
                                  Postcodes:
                                </span>
                                <div className="text-xs font-mono text-gray-300 mt-0.5">
                                  {parsed.postcodes.map((p, i) => (
                                    <span key={i}>
                                      {p.postcode}
                                      {p.time ? ` ${p.time}` : ""}
                                      {i < parsed.postcodes!.length - 1
                                        ? " → "
                                        : ""}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          {parsed.notes && (
                            <div className="mt-1 text-xs text-gray-400">
                              Notes: {parsed.notes}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Raw email body */}
                      {log.body && (
                        <div>
                          <div className="text-xs text-gray-400 font-semibold mb-1">
                            RAW EMAIL
                          </div>
                          <pre className="text-xs text-gray-500 bg-black/30 rounded-lg p-3 max-h-48 overflow-auto whitespace-pre-wrap">
                            {log.body}
                          </pre>
                        </div>
                      )}

                      {/* Actions */}
                      {isError && log.body && (
                        <button
                          onClick={() => handleRetry(log)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-blue-400/30 text-blue-400 hover:bg-blue-400/10 transition-colors"
                        >
                          Retry Parsing
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
