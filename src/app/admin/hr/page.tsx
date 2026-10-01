"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Icon from "@/components/portal/Icon";
import { useToast } from "@/components/portal/ToastContext";
import UploadDocumentForm from "@/components/hr/UploadDocumentForm";
import ComplianceMatrix from "@/components/hr/ComplianceMatrix";
import CountersignQueue from "@/components/hr/CountersignQueue";
import SendToDriverForm from "@/components/hr/SendToDriverForm";
import {
  archiveDocument,
  deleteDraftDocument,
  getDocumentUrl,
  getSignedCopyUrl,
  listHrOverview,
  publishDocument,
  type HrOverview,
} from "@/app/actions/hr";
import { appliesToDriver, driverDocumentViews, pendingCountersigns } from "@/lib/hr/status";
import { categoryLabel, type HrDocument } from "@/types/hr";

const STATUS_CLS: Record<HrDocument["status"], string> = {
  published: "delivered",
  draft: "scheduled",
  archived: "loading",
};

export default function AdminHrPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const [overview, setOverview] = useState<HrOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin") router.push("/");
  }, [authLoading, profile, router]);

  const load = useCallback(async () => {
    const res = await listHrOverview();
    if (res.error) setError(res.error);
    else {
      setError(null);
      setOverview(res.data ?? null);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === "admin") queueMicrotask(() => { load(); });
  }, [profile, load]);

  // Signed / required counts per document, over active drivers.
  const progress = useMemo(() => {
    const out = new Map<string, { signed: number; required: number }>();
    if (!overview) return out;
    const now = new Date();
    const drivers = overview.drivers.filter((d) => d.active);
    for (const doc of overview.documents) {
      let signed = 0;
      let required = 0;
      for (const drv of drivers) {
        if (!appliesToDriver(doc, drv.id, overview.assignments)) continue;
        required++;
        const [view] = driverDocumentViews(drv.id, [doc], overview.assignments, overview.signatures, now);
        if (view && (view.status === "signed" || view.status === "due_soon")) signed++;
      }
      out.set(doc.id, { signed, required });
    }
    return out;
  }, [overview]);

  const pending = useMemo(
    () => (overview ? pendingCountersigns(overview.documents, overview.signatures) : []),
    [overview],
  );

  const openUrl = async (fetchUrl: () => Promise<{ url?: string; error?: string }>) => {
    // Open the tab synchronously so pop-up blockers allow it, then point it at the URL.
    const tab = window.open("", "_blank");
    const res = await fetchUrl();
    if (res.url && tab) tab.location.href = res.url;
    else {
      tab?.close();
      showToast(res.error ?? "Couldn't open file", "err");
    }
  };

  const act = async (id: string, fn: () => Promise<{ error?: string }>, done: string) => {
    setBusyId(id);
    const res = await fn();
    setBusyId(null);
    if (res.error) showToast(res.error, "err");
    else {
      showToast(done);
      load();
    }
  };

  const docs = (overview?.documents ?? []).filter((d) => showArchived || d.status !== "archived");

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">HR documents</h1>
          <div className="page-subtitle">
            Contracts and health &amp; safety documents drivers sign in driver mode
          </div>
        </div>
        <div className="row gap-8">
          <Link className="btn" href="/admin/hr/assistant">
            <Icon name="help" size={13} /> HR assistant
          </Link>
          <button className="btn" type="button" onClick={() => load()}>
            <Icon name="refresh" size={13} /> Refresh
          </button>
          <button className="btn primary" type="button" onClick={() => setShowUpload((v) => !v)}>
            <Icon name="plus" size={13} /> Upload document
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        </div>
      )}

      {showUpload && overview && (
        <UploadDocumentForm
          drivers={overview.drivers}
          onCancel={() => setShowUpload(false)}
          onDone={() => {
            setShowUpload(false);
            showToast("Document saved");
            load();
          }}
        />
      )}

      {overview && pending.length > 0 && (
        <CountersignQueue
          pending={pending}
          drivers={overview.drivers}
          myName={profile?.full_name ?? null}
          onReview={(sigId) => openUrl(() => getSignedCopyUrl(sigId))}
          onDone={(msg) => {
            showToast(msg);
            load();
          }}
        />
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Documents</h3>
          <div className="actions">
            <label className="row gap-4" style={{ fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Who signs</th>
                <th>Re-sign</th>
                <th>Signed</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const p = progress.get(d.id);
                const assigned = overview?.assignments.filter((a) => a.documentId === d.id).length ?? 0;
                const busy = busyId === d.id;
                return (
                  <Fragment key={d.id}>
                  <tr>
                    <td>
                      <div className="bold" style={{ fontSize: 12.5 }}>{d.title}</div>
                      <div className="muted mono" style={{ fontSize: 10.5 }}>{d.fileName}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{categoryLabel(d.category)}</td>
                    <td style={{ fontSize: 12 }}>
                      {d.audience === "all"
                        ? "All drivers"
                        : d.collectsParticulars
                          ? `Blank contract · sent to ${assigned}`
                          : `${assigned} selected`}
                      {d.requiresCountersign && <span className="muted"> + MLC</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{d.resignMonths ? `Every ${d.resignMonths} mo` : "Once"}</td>
                    <td className="mono tnum" style={{ fontSize: 12 }}>
                      {d.status === "published" && p ? `${p.signed} / ${p.required}` : "—"}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_CLS[d.status]}`} style={{ textTransform: "capitalize" }}>
                        <span className="dot" />
                        {d.status}
                      </span>
                    </td>
                    <td>
                      <div className="row gap-4" style={{ justifyContent: "flex-end" }}>
                        {d.audience === "selected" && d.status !== "archived" && (
                          <button
                            className="btn sm"
                            type="button"
                            onClick={() => setSendingId(sendingId === d.id ? null : d.id)}
                          >
                            {sendingId === d.id ? "Close" : "Send to driver"}
                          </button>
                        )}
                        <button
                          className="btn sm ghost"
                          type="button"
                          aria-label={`View ${d.title}`}
                          onClick={() => openUrl(() => getDocumentUrl(d.id))}
                        >
                          <Icon name="eye" size={12} />
                        </button>
                        {d.status === "draft" && (
                          <>
                            <button
                              className="btn sm"
                              type="button"
                              disabled={busy}
                              onClick={() => act(d.id, () => publishDocument(d.id), "Sent to drivers")}
                            >
                              Send
                            </button>
                            <button
                              className="btn sm ghost"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`Delete draft "${d.title}"?`))
                                  act(d.id, () => deleteDraftDocument(d.id), "Draft deleted");
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {d.status === "published" && (
                          <button
                            className="btn sm ghost"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  `Archive "${d.title}"? Drivers will no longer be asked to sign it. Signed copies are kept.`,
                                )
                              )
                                act(d.id, () => archiveDocument(d.id), "Archived");
                            }}
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {sendingId === d.id && overview && (
                    <tr>
                      <td colSpan={7} style={{ background: "var(--neutral-bg)" }}>
                        <SendToDriverForm
                          document={d}
                          overview={overview}
                          onDone={(msg) => {
                            showToast(msg);
                            load();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {overview && docs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)", fontSize: 12.5 }}>
                    No documents yet. Upload a contract or H&amp;S policy to get started.
                  </td>
                </tr>
              )}
              {!overview && !error && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--ink-500)", fontSize: 12.5 }}>
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Driver sign-off</h3>
          <div className="actions muted" style={{ fontSize: 11.5 }}>
            Click a signed entry to download the signed copy
          </div>
        </div>
        {overview && (
          <ComplianceMatrix
            overview={overview}
            onOpenSigned={(sigId) => openUrl(() => getSignedCopyUrl(sigId))}
          />
        )}
      </div>
    </>
  );
}
