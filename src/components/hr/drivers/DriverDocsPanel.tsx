"use client";

import { STATUS_PILL } from "@/components/hr/ComplianceMatrix";
import { awaitingCountersign } from "@/lib/hr/status";
import { ukDate } from "@/lib/hr/format";
import type { DriverDocumentView } from "@/types/hr";

/** What this driver has to sign, and where each document stands. */
export default function DriverDocsPanel({ views }: { views: DriverDocumentView[] }) {
  if (views.length === 0) {
    return <div className="muted" style={{ fontSize: 12.5 }}>No documents have been sent to this driver yet.</div>;
  }
  return (
    <table className="data">
      <thead>
        <tr><th>Document</th><th>Status</th><th>Signed</th></tr>
      </thead>
      <tbody>
        {views.map((v) => {
          const sig = v.lastSignature;
          const pill = v.status !== "expired" && awaitingCountersign(v.document, sig)
            ? { label: "Awaiting MLC", cls: "delayed" }
            : STATUS_PILL[v.status];
          return (
            <tr key={v.document.id}>
              <td style={{ fontSize: 12.5 }}>{v.document.title}</td>
              <td><span className={`pill ${pill.cls}`}><span className="dot" />{pill.label}</span></td>
              <td className="mono tnum" style={{ fontSize: 11.5 }}>
                {sig ? ukDate(sig.signedAt.slice(0, 10)) : "—"}
                {v.expiresAt && ` · re-sign by ${ukDate(v.expiresAt.slice(0, 10))}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
