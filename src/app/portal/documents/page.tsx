"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePortalData } from "@/components/portal/PortalDataContext";
import { useNicknames } from "@/hooks/useNicknames";
import { withNickname } from "@/lib/postcode-nicknames";
import { shortDate } from "@/lib/portal/loads";
import Icon from "@/components/portal/Icon";
import { useToast } from "@/components/portal/ToastContext";

type DocType = "all" | "POD" | "CMR" | "Invoice";

interface DocRow {
  type: "POD" | "CMR" | "Invoice";
  filename: string;
  loadId: string;
  loadJobNumber: string;
  customer: string;
  dropName: string;
  dropPostcode: string;
  signedBy: string;
  date: string;
  available: boolean;
}

export default function DocumentsPage() {
  const { enriched, loading } = usePortalData();
  const nicknames = useNicknames();
  const { showToast } = useToast();
  const [typeFilter, setTypeFilter] = useState<DocType>("all");

  const docs: DocRow[] = useMemo(() => {
    // Until a `documents` table or storage bucket exists, derive a virtual
    // POD record for each delivered run so the UI is ready to drop real
    // signed documents in. Phase 4 will swap this for real storage rows.
    return enriched
      .filter((r) => r.status === "delivered")
      .map(({ run }) => ({
        type: "POD" as const,
        filename: `POD-${run.jobNumber || run.id}.pdf`,
        loadId: run.id,
        loadJobNumber: run.jobNumber || run.id,
        customer: run.customer,
        dropName:
          withNickname(run.toPostcode, nicknames) || run.toPostcode || "—",
        dropPostcode: run.toPostcode || "",
        signedBy: "—",
        date: run.date,
        available: false,
      }));
  }, [enriched, nicknames]);

  const counts = {
    all: docs.length,
    POD: docs.filter((d) => d.type === "POD").length,
    CMR: docs.filter((d) => d.type === "CMR").length,
    Invoice: docs.filter((d) => d.type === "Invoice").length,
  };

  const visible = useMemo(
    () => (typeFilter === "all" ? docs : docs.filter((d) => d.type === typeFilter)),
    [docs, typeFilter],
  );

  const handleAction = (action: "view" | "download", doc: DocRow) => {
    if (!doc.available) {
      showToast(
        `${doc.type} ${doc.filename} isn't uploaded yet — wire-up landing in phase 4.`,
        "err",
      );
      return;
    }
    showToast(`${action === "view" ? "Opening" : "Downloading"} ${doc.filename}…`);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Documents</h1>
          <div className="page-subtitle">
            PODs, CMRs and invoices for your account
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn" type="button">
            <Icon name="filter" size={13} /> Filter
          </button>
          <button
            className="btn"
            type="button"
            onClick={() =>
              showToast("Bulk download lands when document storage is wired.", "err")
            }
          >
            <Icon name="download" size={13} /> Bulk download
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <div className="seg">
            {(["all", "POD", "CMR", "Invoice"] as DocType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={typeFilter === t ? "active" : ""}
                onClick={() => setTypeFilter(t)}
              >
                {t === "all" ? "All" : t}
                <span
                  className="mono"
                  style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}
                >
                  {counts[t]}
                </span>
              </button>
            ))}
          </div>
          <span className="filter-chip">
            <Icon name="cal" size={11} /> Last 30 days
          </span>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {visible.length} document{visible.length === 1 ? "" : "s"}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Document</th>
                <th>Load</th>
                <th>Customer</th>
                <th>Drop</th>
                <th>Signed by</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr key={`${d.type}-${d.loadId}`}>
                  <td>
                    <div className="row gap-8">
                      <div className="doc-icon">{d.type}</div>
                      <div>
                        <div className="bold mono" style={{ fontSize: 11.5 }}>
                          {d.filename}
                        </div>
                        <div className="muted" style={{ fontSize: 10.5 }}>
                          {d.available ? "PDF" : "Awaiting upload"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Link
                      href={`/portal/loads/${d.loadId}`}
                      className="mono"
                      style={{
                        fontSize: 11.5,
                        color: "var(--mlc-blue)",
                        textDecoration: "none",
                      }}
                    >
                      {d.loadJobNumber}
                    </Link>
                  </td>
                  <td style={{ fontSize: 12 }}>{d.customer}</td>
                  <td>
                    <div style={{ fontSize: 12 }}>{d.dropName}</div>
                    {d.dropPostcode && (
                      <div className="muted mono" style={{ fontSize: 10.5 }}>
                        {d.dropPostcode}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{d.signedBy}</td>
                  <td className="mono tnum" style={{ fontSize: 11.5 }}>
                    {shortDate(d.date)}
                  </td>
                  <td>
                    <div className="row gap-4">
                      <button
                        className="btn sm ghost"
                        type="button"
                        onClick={() => handleAction("view", d)}
                        aria-label={`View ${d.filename}`}
                      >
                        <Icon name="eye" size={12} />
                      </button>
                      <button
                        className="btn sm ghost"
                        type="button"
                        onClick={() => handleAction("download", d)}
                        aria-label={`Download ${d.filename}`}
                      >
                        <Icon name="download" size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "var(--ink-500)",
                      fontSize: 12.5,
                    }}
                  >
                    No documents yet. Completed loads will surface PODs here once
                    the documents pipeline is wired up.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "var(--ink-500)",
                      fontSize: 12.5,
                    }}
                  >
                    Loading documents…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
