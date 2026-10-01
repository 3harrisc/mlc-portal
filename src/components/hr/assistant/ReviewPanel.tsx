"use client";

import { useEffect, useState } from "react";
import MarkdownPreview from "./MarkdownPreview";
import StreamStatus from "./StreamStatus";
import { useHrAssistant } from "./useHrAssistant";
import { listHrOverview } from "@/app/actions/hr";
import type { HrDocument } from "@/types/hr";

export default function ReviewPanel() {
  const ai = useHrAssistant();
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [focus, setFocus] = useState("");

  useEffect(() => {
    listHrOverview().then((res) => {
      setDocs((res.data?.documents ?? []).filter((d) => d.status !== "archived"));
    });
  }, []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-header"><h3>Review a document</h3></div>
        <div className="card-body" style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label>Document</label>
            <select className="select" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">Choose…</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} {d.status === "draft" ? "(draft)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Anything to focus on? (optional)</label>
            <input
              className="input"
              value={focus}
              placeholder="e.g. Check the holiday pay wording is up to date"
              onChange={(e) => setFocus(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn primary"
              type="button"
              disabled={ai.running || !documentId}
              onClick={() => ai.run({ mode: "review", request: focus, documentId })}
            >
              Review it
            </button>
          </div>
        </div>
      </div>

      {(ai.output || ai.running || ai.error) && (
        <div className="card">
          <div className="card-header"><h3>Review</h3></div>
          <div className="card-body">
            <StreamStatus status={ai.status} warning={ai.warning} error={ai.error} running={ai.running} onStop={ai.stop} />
            {ai.output && <MarkdownPreview markdown={ai.output} />}
          </div>
        </div>
      )}
    </div>
  );
}
