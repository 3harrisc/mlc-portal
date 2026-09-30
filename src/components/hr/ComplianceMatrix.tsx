"use client";

import { useMemo } from "react";
import { awaitingCountersign, driverDocumentViews } from "@/lib/hr/status";
import type { HrOverview } from "@/app/actions/hr";
import type { SignStatus } from "@/types/hr";

export const STATUS_PILL: Record<SignStatus, { label: string; cls: string }> = {
  signed: { label: "Signed", cls: "delivered" },
  due_soon: { label: "Due soon", cls: "delayed" },
  expired: { label: "Expired", cls: "exception" },
  outstanding: { label: "To sign", cls: "scheduled" },
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

interface Props {
  overview: HrOverview;
  onOpenSigned: (signatureId: string) => void;
}

/** Drivers down the side, published documents across the top. */
export default function ComplianceMatrix({ overview, onOpenSigned }: Props) {
  const { published, drivers, rows } = useMemo(() => {
    const published = overview.documents.filter((d) => d.status === "published");
    const drivers = overview.drivers.filter((d) => d.active);
    const now = new Date();
    const rows = drivers.map((driver) => {
      const views = driverDocumentViews(
        driver.id,
        published,
        overview.assignments,
        overview.signatures,
        now,
      );
      const byDoc = new Map(views.map((v) => [v.document.id, v]));
      const todo = views.filter((v) => v.status !== "signed").length;
      return { driver, byDoc, todo };
    });
    return { published, drivers, rows };
  }, [overview]);

  if (published.length === 0 || drivers.length === 0) {
    return (
      <div className="card-body" style={{ textAlign: "center", padding: 32, color: "var(--ink-500)" }}>
        {drivers.length === 0
          ? "No active drivers yet."
          : "Nothing sent to drivers yet. Upload a document to get started."}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Outstanding</th>
            {published.map((d) => (
              <th key={d.id} style={{ whiteSpace: "nowrap" }} title={d.title}>
                {d.title.length > 24 ? `${d.title.slice(0, 23)}…` : d.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ driver, byDoc, todo }) => (
            <tr key={driver.id}>
              <td>
                <div className="bold" style={{ fontSize: 12.5 }}>{driver.fullName || "—"}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{driver.email}</div>
              </td>
              <td className="mono tnum" style={{ fontSize: 12, color: todo ? "var(--err)" : "var(--ok)" }}>
                {todo || "✓"}
              </td>
              {published.map((d) => {
                const view = byDoc.get(d.id);
                if (!view) {
                  return (
                    <td key={d.id} className="muted" style={{ fontSize: 11 }}>
                      n/a
                    </td>
                  );
                }
                const sig = view.lastSignature;
                const pill =
                  view.status !== "expired" && awaitingCountersign(d, sig)
                    ? { label: "Awaiting MLC", cls: "delayed" }
                    : STATUS_PILL[view.status];
                return (
                  <td key={d.id}>
                    {sig ? (
                      <button
                        type="button"
                        className={`pill ${pill.cls}`}
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onOpenSigned(sig.id)}
                        title={`Signed ${shortDate(sig.signedAt)} as "${sig.signedName}" — click to download`}
                      >
                        <span className="dot" />
                        {pill.label} · {shortDate(sig.signedAt)}
                      </button>
                    ) : (
                      <span className={`pill ${pill.cls}`}>
                        <span className="dot" />
                        {pill.label}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
