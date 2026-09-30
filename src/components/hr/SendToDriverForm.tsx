"use client";

import { useState } from "react";
import { assignDocument } from "@/app/actions/hr-assign";
import { ukDate } from "@/lib/hr/format";
import type { HrOverview } from "@/app/actions/hr";
import type { HrDocument } from "@/types/hr";

interface Props {
  document: HrDocument;
  overview: HrOverview;
  onDone: (message: string) => void;
}

/** Inline panel under a document row: pick a driver (and start dates) and send. */
export default function SendToDriverForm({ document: doc, overview, onDone }: Props) {
  const [driverId, setDriverId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [continuousDate, setContinuousDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sent = overview.assignments.filter((a) => a.documentId === doc.id);
  const signedIds = new Set(
    overview.signatures.filter((s) => s.documentId === doc.id).map((s) => s.driverId),
  );
  const driverLabel = (id: string) => {
    const d = overview.drivers.find((x) => x.id === id);
    return d?.fullName || d?.email || "Former driver";
  };
  // Anyone not yet signed can be (re)sent; re-sending corrects their dates.
  const choices = overview.drivers.filter((d) => d.active && !signedIds.has(d.id));

  const submit = async () => {
    setError(null);
    if (!driverId) return setError("Choose a driver.");
    if (doc.collectsParticulars && !startDate) return setError("Enter the start date.");
    setBusy(true);
    const res = await assignDocument({
      documentId: doc.id,
      driverId,
      startDate: startDate || undefined,
      continuousDate: continuousDate || undefined,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setDriverId("");
    setStartDate("");
    setContinuousDate("");
    onDone(`Sent to ${driverLabel(driverId)}`);
  };

  return (
    <div style={{ display: "grid", gap: 10, padding: "8px 0", maxWidth: 640 }}>
      <div className="row gap-8" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label>Driver</label>
          <select className="select" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Choose…</option>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName || d.email}
              </option>
            ))}
          </select>
        </div>
        {doc.collectsParticulars && (
          <>
            <div className="field">
              <label>Start date</label>
              <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Continuous employment from</label>
              <input
                className="input"
                type="date"
                value={continuousDate}
                placeholder="Same as start date"
                onChange={(e) => setContinuousDate(e.target.value)}
              />
            </div>
          </>
        )}
        <button className="btn primary sm" type="button" disabled={busy} onClick={submit}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {doc.collectsParticulars && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          Leave &ldquo;continuous employment from&rdquo; blank unless their service started earlier (for
          example a transfer from another employer). The driver confirms their own name and address when
          they sign.
        </div>
      )}
      {error && <div style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>}
      {sent.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <span className="muted">Sent to: </span>
          {sent
            .map((a) => {
              const bits = [driverLabel(a.driverId)];
              if (a.startDate) bits.push(`starts ${ukDate(a.startDate)}`);
              if (signedIds.has(a.driverId)) bits.push("signed");
              return bits.join(", ");
            })
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
