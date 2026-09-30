"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createDocumentUpload, finalizeDocument } from "@/app/actions/hr";
import { HR_CATEGORIES, type HrAudience, type HrCategory, type HrDriver } from "@/types/hr";

const MAX_BYTES = 20 * 1024 * 1024;

interface Props {
  drivers: HrDriver[];
  onDone: () => void;
  onCancel: () => void;
}

export default function UploadDocumentForm({ drivers, onDone, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<HrCategory>("contract");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<HrAudience>("all");
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [resign, setResign] = useState("");
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeDrivers = drivers.filter((d) => d.active);

  const pickFile = (f: File | null) => {
    setError(null);
    if (f && !/\.pdf$/i.test(f.name)) {
      setError("Please choose a PDF. Word documents can be saved as PDF via File → Save As.");
      return;
    }
    if (f && f.size > MAX_BYTES) {
      setError("That PDF is over 20 MB.");
      return;
    }
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
  };

  const toggleDriver = (id: string) =>
    setDriverIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Choose a PDF to upload.");
    if (!title.trim()) return setError("Give the document a title.");
    if (audience === "selected" && driverIds.length === 0) return setError("Pick at least one driver.");
    const resignMonths = resign ? Number(resign) : null;

    setBusy(true);
    try {
      const start = await createDocumentUpload(file.name);
      if (start.error || !start.path || !start.token) throw new Error(start.error ?? "Upload failed");

      const { error: upErr } = await createClient()
        .storage.from("hr-documents")
        .uploadToSignedUrl(start.path, start.token, file, { contentType: "application/pdf" });
      if (upErr) throw new Error(upErr.message);

      const res = await finalizeDocument({
        path: start.path,
        fileName: file.name,
        title,
        category,
        description,
        audience,
        driverIds: audience === "selected" ? driverIds : [],
        resignMonths,
        publish,
      });
      if (res.error) throw new Error(res.error);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={submit}>
      <div className="card-header">
        <h3>Upload document</h3>
      </div>
      <div
        className="card-body"
        style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}
      >
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>PDF file</label>
          <input
            className="input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="field">
          <label>Title</label>
          <input
            className="input"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Class 1 Driver Contract"
          />
        </div>
        <div className="field">
          <label>Category</label>
          <select
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value as HrCategory)}
          >
            {HR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Note for drivers (optional)</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Please read the manual handling section carefully"
          />
        </div>
        <div className="field">
          <label>Who needs to sign</label>
          <select
            className="select"
            value={audience}
            onChange={(e) => setAudience(e.target.value as HrAudience)}
          >
            <option value="all">All drivers (including future starters)</option>
            <option value="selected">Selected drivers only</option>
          </select>
        </div>
        <div className="field">
          <label>Re-sign every</label>
          <select className="select" value={resign} onChange={(e) => setResign(e.target.value)}>
            <option value="">Never — sign once</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
            <option value="24">24 months</option>
            <option value="36">36 months</option>
          </select>
        </div>

        {audience === "selected" && (
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>Drivers ({driverIds.length} selected)</label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 6,
                maxHeight: 200,
                overflowY: "auto",
                padding: 8,
                border: "1px solid var(--line, #e5e7eb)",
                borderRadius: 8,
              }}
            >
              {activeDrivers.length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  No active drivers yet — add them under Admin users.
                </span>
              )}
              {activeDrivers.map((d) => (
                <label key={d.id} className="row gap-8" style={{ fontSize: 12.5, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={driverIds.includes(d.id)}
                    onChange={() => toggleDriver(d.id)}
                  />
                  {d.fullName || d.email}
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="row gap-8" style={{ gridColumn: "span 2", fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          Send to drivers now (untick to save as a draft)
        </label>

        {error && (
          <div style={{ gridColumn: "span 2", color: "var(--err)", fontSize: 12.5 }}>{error}</div>
        )}

        <div className="row gap-8" style={{ gridColumn: "span 2", justifyContent: "flex-end" }}>
          <button type="button" className="btn sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary sm" disabled={busy}>
            {busy ? "Uploading…" : publish ? "Upload & send" : "Save draft"}
          </button>
        </div>
      </div>
    </form>
  );
}
