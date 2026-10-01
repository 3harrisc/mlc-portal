"use client";

import { useState } from "react";
import { readLicenceCheck, uploadDriverFile } from "./upload";
import type { LicenceCheck } from "@/lib/hr/licence";

interface Props {
  /** Called with the uploaded file's path and what the assistant read from it. */
  onRead: (path: string, licence: LicenceCheck, fileName: string) => void;
  label?: string;
}

/** Drop or choose an AssetGo licence check PDF; the assistant reads it. */
export default function LicenceCheckDrop({ onRead, label = "Drop an AssetGo licence check PDF here" }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.pdf$/i.test(file.name)) return setError("Use the PDF downloaded from AssetGo.");
    try {
      setBusy("Uploading…");
      const path = await uploadDriverFile(file);
      setBusy("Reading the licence check (about 15 seconds)…");
      const licence = await readLicenceCheck(path);
      onRead(path, licence, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files?.[0]);
      }}
      style={{
        display: "block",
        border: `2px dashed ${over ? "var(--mlc-blue)" : "var(--line, #d1d5db)"}`,
        borderRadius: 12,
        padding: 20,
        textAlign: "center",
        cursor: busy ? "wait" : "pointer",
        background: over ? "var(--info-bg)" : "transparent",
        fontSize: 13,
      }}
    >
      <input type="file" accept="application/pdf,.pdf" hidden disabled={!!busy} onChange={(e) => handle(e.target.files?.[0])} />
      {busy ? <span className="muted">{busy}</span> : <span><b>{label}</b><br /><span className="muted">or click to choose a file</span></span>}
      {error && <div style={{ color: "var(--err)", marginTop: 8 }}>{error}</div>}
    </label>
  );
}
