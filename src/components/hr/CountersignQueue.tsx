"use client";

import { useRef, useState } from "react";
import SignaturePad, { type SignaturePadHandle } from "@/components/hr/SignaturePad";
import { countersignDocument } from "@/app/actions/hr-countersign";
import type { PendingCountersign } from "@/lib/hr/status";
import { COUNTERSIGN_TEXT, MLC_SIGNATORIES, type HrDriver } from "@/types/hr";

interface Props {
  pending: PendingCountersign[];
  drivers: HrDriver[];
  /** Logged-in admin's name, used to preselect the matching signatory. */
  myName: string | null;
  onReview: (signatureId: string) => void;
  onDone: (message: string) => void;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Driver signatures waiting for MLC, with an inline countersign form. */
export default function CountersignQueue({ pending, drivers, myName, onReview, onDone }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [signatory, setSignatory] = useState<string>(
    MLC_SIGNATORIES.find((s) => s.name.toLowerCase() === myName?.trim().toLowerCase())?.name ?? "",
  );
  const [agreed, setAgreed] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const driverName = (id: string | null) => {
    const d = drivers.find((x) => x.id === id);
    return d?.fullName || d?.email || "Former driver";
  };

  const open = (id: string) => {
    setOpenId(id === openId ? null : id);
    setAgreed(false);
    setHasInk(false);
    setError(null);
  };

  const submit = async (signatureId: string) => {
    setError(null);
    const dataUrl = padRef.current?.toDataUrl();
    if (!dataUrl) return setError("Please draw your signature in the box.");
    setBusy(true);
    const res = await countersignDocument({ signatureId, signatoryName: signatory, agreed, signatureDataUrl: dataUrl });
    setBusy(false);
    if (res.error) return setError(res.error);
    setOpenId(null);
    onDone("Countersigned. The completed copy is saved.");
  };

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: "var(--warn)" }}>
      <div className="card-header">
        <h3>Awaiting MLC signature ({pending.length})</h3>
        <div className="actions muted" style={{ fontSize: 11.5 }}>
          Review the driver-signed copy, then sign for MLC
        </div>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Document</th>
            <th>Driver signed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pending.map(({ document, signature }) => {
            const isOpen = openId === signature.id;
            const hasReviewed = reviewed.has(signature.id);
            return [
              <tr key={signature.id}>
                <td style={{ fontSize: 12.5 }}>
                  <div className="bold">{driverName(signature.driverId)}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>signed as &ldquo;{signature.signedName}&rdquo;</div>
                </td>
                <td style={{ fontSize: 12.5 }}>{document.title}</td>
                <td className="mono tnum" style={{ fontSize: 11.5 }}>{when(signature.signedAt)}</td>
                <td>
                  <div className="row gap-4" style={{ justifyContent: "flex-end" }}>
                    <button
                      className="btn sm"
                      type="button"
                      onClick={() => {
                        setReviewed((r) => new Set(r).add(signature.id));
                        onReview(signature.id);
                      }}
                    >
                      Review
                    </button>
                    <button className="btn primary sm" type="button" onClick={() => open(signature.id)}>
                      {isOpen ? "Close" : "Sign for MLC"}
                    </button>
                  </div>
                </td>
              </tr>,
              isOpen && (
                <tr key={`${signature.id}-form`}>
                  <td colSpan={4} style={{ background: "var(--neutral-bg)" }}>
                    <div style={{ display: "grid", gap: 12, maxWidth: 560, padding: "8px 0" }}>
                      {!hasReviewed && (
                        <div style={{ fontSize: 12, color: "var(--warn)" }}>
                          Tip: click Review first to check what the driver signed.
                        </div>
                      )}
                      <div className="field">
                        <label>Signing for MLC Transport Ltd</label>
                        <select className="select" value={signatory} onChange={(e) => setSignatory(e.target.value)}>
                          <option value="">Choose…</option>
                          {MLC_SIGNATORIES.map((s) => (
                            <option key={s.name} value={s.name}>
                              {s.name}, {s.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="row gap-8" style={{ fontSize: 12.5, alignItems: "flex-start", cursor: "pointer" }}>
                        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
                        <span>{COUNTERSIGN_TEXT}</span>
                      </label>
                      <div>
                        <div className="row" style={{ justifyContent: "space-between", fontSize: 11.5 }}>
                          <span className="muted">Draw your signature</span>
                          <button type="button" className="btn sm ghost" onClick={() => padRef.current?.clear()}>
                            Clear
                          </button>
                        </div>
                        <div style={{ border: "1px solid var(--line, #e5e7eb)", borderRadius: 12, marginTop: 4 }}>
                          <SignaturePad ref={padRef} onChange={setHasInk} height={150} />
                        </div>
                      </div>
                      {error && <div style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>}
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button
                          className="btn primary"
                          type="button"
                          disabled={busy || !signatory || !agreed || !hasInk}
                          onClick={() => submit(signature.id)}
                        >
                          {busy ? "Signing…" : "Countersign"}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
