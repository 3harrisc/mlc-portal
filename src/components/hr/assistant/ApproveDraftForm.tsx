"use client";

import Link from "next/link";
import { useState } from "react";
import { createDocumentFromDraft } from "@/app/actions/hr-ai";
import { openPlaceholders, titleFromMarkdown } from "@/lib/hr/markdown";
import { HR_CATEGORIES, type HrAudience, type HrCategory } from "@/types/hr";

/** Turn an approved draft into a DRAFT document on the HR page (still not sent to drivers). */
export default function ApproveDraftForm({ markdown }: { markdown: string }) {
  const [title, setTitle] = useState(() => titleFromMarkdown(markdown) ?? "");
  const [category, setCategory] = useState<HrCategory>("policy");
  const [audience, setAudience] = useState<HrAudience>("all");
  const [resign, setResign] = useState("");
  const [countersign, setCountersign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const gaps = openPlaceholders(markdown);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const res = await createDocumentFromDraft({
      markdown,
      title: title || titleFromMarkdown(markdown) || "",
      category,
      audience,
      resignMonths: resign ? Number(resign) : null,
      requiresCountersign: countersign,
    });
    setBusy(false);
    if (res.error) setError(res.error);
    else setCreated(true);
  };

  if (created) {
    return (
      <div className="card">
        <div className="card-body" style={{ fontSize: 13 }}>
          Saved as a <b>draft</b> document. It hasn&apos;t gone to drivers yet. Open{" "}
          <Link href="/admin/hr" style={{ color: "var(--mlc-blue)" }}>HR documents</Link>, check the PDF with the
          eye icon, then press <b>Send</b> when you&apos;re happy.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>Approve and create document</h3>
      </div>
      <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {gaps.length > 0 && (
          <div style={{ gridColumn: "span 2", fontSize: 12.5, color: "var(--warn)" }}>
            {gaps.length} gap{gaps.length === 1 ? "" : "s"} to fill first (highlighted in yellow). Click{" "}
            <b>Edit</b> on the draft to fill them in, or ask for changes.
          </div>
        )}
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Title</label>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Category</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as HrCategory)}>
            {HR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Who needs to sign</label>
          <select className="select" value={audience} onChange={(e) => setAudience(e.target.value as HrAudience)}>
            <option value="all">All drivers (including future starters)</option>
            <option value="selected">Selected drivers (use Send to driver)</option>
          </select>
        </div>
        <div className="field">
          <label>Re-sign every</label>
          <select className="select" value={resign} onChange={(e) => setResign(e.target.value)}>
            <option value="">Never — sign once</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
            <option value="24">24 months</option>
          </select>
        </div>
        <label className="row gap-8" style={{ fontSize: 12.5, cursor: "pointer", alignSelf: "end" }}>
          <input type="checkbox" checked={countersign} onChange={(e) => setCountersign(e.target.checked)} />
          Needs MLC countersignature
        </label>
        {error && <div style={{ gridColumn: "span 2", color: "var(--err)", fontSize: 12.5 }}>{error}</div>}
        <div className="row" style={{ gridColumn: "span 2", justifyContent: "flex-end" }}>
          <button className="btn primary" type="button" disabled={busy || gaps.length > 0} onClick={submit}>
            {busy ? "Creating PDF…" : "Create draft document"}
          </button>
        </div>
      </div>
    </div>
  );
}
