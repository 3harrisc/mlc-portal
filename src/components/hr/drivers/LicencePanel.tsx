"use client";

import { hasFullCategory, licenceFlags, toIsoDate, type LicenceCheck } from "@/lib/hr/licence";
import { ukDate } from "@/lib/hr/format";

const FLAG_COLOUR = { danger: "var(--err)", warn: "var(--warn)", info: "var(--info)" } as const;

function d(iso: string | null | undefined) {
  const v = toIsoDate(iso ?? null);
  return v ? ukDate(v) : "—";
}

/** Summary of the most recent AssetGo licence check, with anything MLC should act on. */
export default function LicencePanel({ licence }: { licence: LicenceCheck }) {
  const flags = licenceFlags(licence);
  const hgv = licence.categories.filter((c) => ["C1", "C1E", "C", "CE"].includes(c.code.toUpperCase()));
  const rows: [string, string][] = [
    ["Licence number", licence.licence_number ?? "—"],
    ["Status", `${licence.licence_status ?? "—"}${licence.disqualified ? " · DISQUALIFIED" : ""}`],
    ["Penalty points", String(licence.total_points)],
    ["Photocard expires", d(licence.photocard_expiry)],
    ["C / C+E", `${hasFullCategory(licence, "C") ? "C ✓" : "C ✗"}   ${hasFullCategory(licence, "CE") ? "C+E ✓" : "C+E ✗"}`],
    ["Driver CPC (LGV) valid to", d(licence.cpc?.lgv_valid_to)],
    ["Tachograph card", licence.tacho_card?.number ? `${licence.tacho_card.number} · expires ${d(licence.tacho_card.expiry)}` : "—"],
    ["Checked", `${d(licence.checked_on)}${licence.check_number ? ` (AssetGo #${licence.check_number})` : ""}`],
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {flags.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          {flags.map((f) => (
            <div key={f.message} style={{ fontSize: 12.5, color: FLAG_COLOUR[f.level] }}>
              {f.level === "danger" ? "⚠ " : "• "}{f.message}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "4px 12px", fontSize: 12.5 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <span className="muted">{k}</span>
            <span className="mono">{v}</span>
          </div>
        ))}
      </div>
      {hgv.length > 0 && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          HGV categories: {hgv.map((c) => `${c.code} ${c.status.toLowerCase()} ${d(c.valid_from)} → ${d(c.valid_to)}`).join(" · ")}
        </div>
      )}
      {licence.endorsements.length > 0 && (
        <div style={{ fontSize: 12.5 }}>
          <b>Endorsements</b>
          {licence.endorsements.map((e, i) => (
            <div key={i}>{e.offence_code} · {e.points} pts · offence {d(e.offence_date)}{e.expiry_date ? ` · expires ${d(e.expiry_date)}` : ""}</div>
          ))}
        </div>
      )}
    </div>
  );
}
