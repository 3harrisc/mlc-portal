"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import Icon from "@/components/portal/Icon";

interface ParsedRunData {
  name?: string;
  type?: string;
  customer?: string;
  date?: string;
  destination?: string;
  destinationPostcode?: string;
  fromLocation?: string;
  fromPostcode?: string;
  deliveryPostcodes?: { postcode: string; time?: string; ref?: string }[];
  vehicle?: string;
  loadRef?: string;
  collectionRef?: string;
  deliveryTime?: string;
  collectionTime?: string;
  price?: string;
  notes?: string;
  postcodes?: { postcode: string; time?: string }[];
}

interface ParsedData {
  runs?: ParsedRunData[];
  customer?: string;
  date?: string;
  postcodes?: { postcode: string; time?: string }[];
  vehicle?: string;
  loadRef?: string;
  notes?: string;
  runsCreated?: number;
  created?: string[];
}

interface EmailLog {
  id: string;
  from_address: string | null;
  subject: string | null;
  body: string | null;
  parsed_data: ParsedData | null;
  run_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case "created":  return { label: "Created", cls: "delivered" };
    case "error":    return { label: "Error", cls: "exception" };
    case "partial":  return { label: "Partial", cls: "delayed" };
    default:         return { label: status, cls: "scheduled" };
  }
}

export default function AdminEmailsPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  const loadLogs = React.useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("email_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs((data as EmailLog[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    queueMicrotask(() => { loadLogs(); });
  }, [profile, loadLogs]);

  async function handleRetry(log: EmailLog) {
    if (!log.body) return;
    const cronSecret = prompt("Enter CRON_SECRET to re-process this email:");
    if (!cronSecret) return;

    const res = await fetch("/api/email-to-run", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
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

  if (authLoading || profile?.role !== "admin") return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Email imports</h1>
          <div className="page-subtitle">
            Inbound emails parsed by AI and converted to runs. Last 50 messages shown.
          </div>
        </div>
        <button type="button" className="btn sm" onClick={() => void loadLogs()} disabled={loading}>
          <Icon name="refresh" size={11} /> {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && logs.length === 0 ? (
        <div className="muted">Loading email logs…</div>
      ) : logs.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
            No emails received yet. Forward backload emails to your Postmark inbound address to get started.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {logs.map((log) => {
            const isExpanded = expandedId === log.id;
            const pill = statusPill(log.status);
            const parsed = log.parsed_data;
            const isSuccess = log.status === "created";

            return (
              <div key={log.id} className="card">
                <div
                  className="card-header"
                  style={{ cursor: "pointer" }}
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  <h3 style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {log.subject || "(no subject)"}
                    </span>
                    <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                      {log.from_address ?? ""} · {new Date(log.created_at).toLocaleString("en-GB", {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                  </h3>
                  <div className="actions">
                    {log.run_id && (isSuccess || log.status === "partial") && (
                      <Link
                        href={`/runs/${log.run_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="btn primary sm"
                      >
                        <Icon name="arrowR" size={11} /> Run
                      </Link>
                    )}
                    <span className={`pill ${pill.cls}`}><span className="dot" />{pill.label}</span>
                    <Icon name={isExpanded ? "chevD" : "chevR"} size={12} className="muted" />
                  </div>
                </div>

                {!isExpanded && parsed && (isSuccess || log.status === "partial") && (
                  <div className="card-body" style={{ paddingTop: 4, paddingBottom: 8, fontSize: 12, color: "var(--ink-500)" }}>
                    {parsed.runs && parsed.runs.length > 0 ? (
                      <>
                        {parsed.runsCreated != null
                          ? <span style={parsed.runsCreated < parsed.runs.length ? { color: "var(--warn)" } : undefined}>
                              {parsed.runsCreated}/{parsed.runs.length} runs created
                            </span>
                          : <>{parsed.runs.length} run{parsed.runs.length !== 1 ? "s" : ""}</>}
                        {" · "}{parsed.runs[0].customer || "Unknown"}
                        {parsed.runs[0].date ? ` · ${parsed.runs[0].date}` : ""}
                      </>
                    ) : (
                      <>
                        {parsed.customer && <span>{parsed.customer}</span>}
                        {parsed.postcodes && (
                          <> · {parsed.postcodes.length} stop{parsed.postcodes.length !== 1 ? "s" : ""}</>
                        )}
                        {parsed.vehicle && <> · Vehicle: {parsed.vehicle}</>}
                      </>
                    )}
                  </div>
                )}

                {!isExpanded && (log.status === "error" || log.status === "partial") && log.error && (
                  <div className="card-body" style={{ paddingTop: 4, paddingBottom: 8, fontSize: 12, color: "var(--err)" }}>
                    {log.error}
                  </div>
                )}

                {isExpanded && (
                  <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
                    {parsed && (
                      <div style={{ marginBottom: 12 }}>
                        <div className="muted" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>
                          PARSED DATA
                        </div>
                        {parsed.runs && parsed.runs.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {parsed.runs.map((r, idx) => {
                              const pcs = r.deliveryPostcodes || r.postcodes || [];
                              const wasCreated = parsed.created?.includes(r.name ?? "");
                              return (
                                <div key={idx} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10 }}>
                                  <div className="row gap-8" style={{ marginBottom: 6 }}>
                                    <span className="bold" style={{ fontSize: 12 }}>{r.name || `Run ${idx + 1}`}</span>
                                    {parsed.created && (
                                      <span className={`pill ${wasCreated ? "delivered" : "exception"}`}>
                                        <span className="dot" />{wasCreated ? "created" : "skipped"}
                                      </span>
                                    )}
                                    {r.type && (
                                      <span className={`pill ${r.type === "backload" ? "delayed" : "in-transit"}`}>
                                        <span className="dot" />{r.type}
                                      </span>
                                    )}
                                  </div>
                                  <KvGrid>
                                    {r.customer && <Kv k="Customer" v={r.customer} />}
                                    {r.date && <Kv k="Date" v={r.date} />}
                                    {r.destination && <Kv k="Dest" v={`${r.destination}${r.destinationPostcode ? ` (${r.destinationPostcode})` : ""}`} />}
                                    {r.fromLocation && <Kv k="From" v={`${r.fromLocation}${r.fromPostcode ? ` (${r.fromPostcode})` : ""}`} />}
                                    {(r.loadRef || r.collectionRef) && <Kv k="Ref" v={[r.loadRef, r.collectionRef].filter(Boolean).join(" / ")} />}
                                    {(r.deliveryTime || r.collectionTime) && <Kv k="Time" v={r.deliveryTime || r.collectionTime!} />}
                                    {r.vehicle && <Kv k="Vehicle" v={r.vehicle} />}
                                    {r.price && <Kv k="Price" v={r.price} />}
                                  </KvGrid>
                                  {pcs.length > 0 && (
                                    <div style={{ marginTop: 6, fontSize: 11.5 }}>
                                      <span className="muted">Stops: </span>
                                      <span className="mono">
                                        {pcs.map((p, i) => (
                                          <span key={i}>
                                            {p.postcode}
                                            {p.time ? ` ${p.time}` : ""}
                                            {i < pcs.length - 1 ? " → " : ""}
                                          </span>
                                        ))}
                                      </span>
                                    </div>
                                  )}
                                  {r.notes && <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-500)" }}>Notes: {r.notes}</div>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <KvGrid>
                            {parsed.customer && <Kv k="Customer" v={parsed.customer} />}
                            {parsed.date && <Kv k="Date" v={parsed.date} />}
                            {parsed.vehicle && <Kv k="Vehicle" v={parsed.vehicle} />}
                            {parsed.loadRef && <Kv k="Ref" v={parsed.loadRef} />}
                          </KvGrid>
                        )}
                      </div>
                    )}

                    {log.body && (
                      <div>
                        <div className="muted" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>
                          RAW EMAIL
                        </div>
                        <pre style={{
                          fontSize: 11, color: "var(--ink-700)",
                          background: "var(--surface-alt)",
                          border: "1px solid var(--line)",
                          borderRadius: 6, padding: 10,
                          maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap",
                          fontFamily: "var(--font-portal-mono)",
                        }}>
                          {log.body}
                        </pre>
                      </div>
                    )}

                    {(log.status === "error" || log.status === "partial") && log.body && (
                      <div style={{ marginTop: 12 }}>
                        <button type="button" className="btn sm" onClick={() => void handleRetry(log)}>
                          <Icon name="refresh" size={11} /> Retry parsing
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function KvGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="kv-grid" style={{ gridTemplateColumns: "max-content 1fr max-content 1fr", fontSize: 11.5 }}>
      {children}
    </dl>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}:</dt>
      <dd>{v}</dd>
    </>
  );
}
