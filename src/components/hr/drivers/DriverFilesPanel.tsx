"use client";

import { useState } from "react";
import { addDriverFile, getDriverFileUrl } from "@/app/actions/hr-drivers";
import { uploadDriverFile } from "./upload";
import { ukDate } from "@/lib/hr/format";
import { DRIVER_FILE_KINDS, type DriverFile, type DriverFileKind } from "@/types/hr-drivers";

interface Props {
  driverId: string;
  files: DriverFile[];
  onChanged: () => void;
}

/** Files MLC holds on the driver (other than new licence checks, which go through the licence panel). */
export default function DriverFilesPanel({ driverId, files, onChanged }: Props) {
  const [kind, setKind] = useState<DriverFileKind>("right_to_work");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (k: DriverFileKind) => DRIVER_FILE_KINDS.find((x) => x.value === k)?.label ?? k;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const path = await uploadDriverFile(file);
      const res = await addDriverFile({ driverId, path, kind, title: file.name });
      if (res.error) throw new Error(res.error);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    const tab = window.open("", "_blank");
    const res = await getDriverFileUrl(id);
    if (res.url && tab) tab.location.href = res.url;
    else {
      tab?.close();
      setError(res.error ?? "Couldn't open file");
    }
  };

  const hasRtw = files.some((f) => f.kind === "right_to_work");

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {!hasRtw && (
        <div style={{ fontSize: 12.5, color: "var(--warn)" }}>
          No right-to-work evidence on file. This must be checked before employment starts.
        </div>
      )}
      {files.length > 0 && (
        <table className="data">
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td style={{ fontSize: 12.5 }}>
                  <div className="bold">{label(f.kind)}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{f.title}</div>
                </td>
                <td className="mono tnum" style={{ fontSize: 11.5 }}>{ukDate(f.uploadedAt.slice(0, 10))}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn sm ghost" type="button" onClick={() => open(f.id)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row gap-8" style={{ flexWrap: "wrap" }}>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as DriverFileKind)} style={{ maxWidth: 240 }}>
          {DRIVER_FILE_KINDS.filter((k) => k.value !== "licence_check").map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
        <label className="btn sm" style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Uploading…" : "Upload file"}
          <input type="file" hidden accept="application/pdf,image/*" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {error && <div style={{ color: "var(--err)", fontSize: 12.5 }}>{error}</div>}
    </div>
  );
}
