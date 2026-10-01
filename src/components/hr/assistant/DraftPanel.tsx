"use client";

import { useState } from "react";
import MarkdownPreview from "./MarkdownPreview";
import ApproveDraftForm from "./ApproveDraftForm";
import StreamStatus from "./StreamStatus";
import { useHrAssistant } from "./useHrAssistant";
import { splitNotes } from "@/lib/hr/assistant/notes";
import { titleFromMarkdown } from "@/lib/hr/markdown";

const EXAMPLES = [
  "A toolbox talk on winter driving for our drivers",
  "A drug and alcohol policy, including when MLC may test drivers",
  "A letter inviting a driver to a disciplinary hearing about a tachograph infringement",
  "An anti-harassment policy covering the duty to prevent sexual harassment",
  "A new-starter welcome letter listing what to bring on day one",
];

export default function DraftPanel() {
  const ai = useHrAssistant();
  const [request, setRequest] = useState("");
  const [changes, setChanges] = useState("");
  const [doc, setDoc] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);

  // While streaming, show the live document; once finished it becomes editable state.
  const live = splitNotes(ai.output);
  const keep = (text: string) => {
    if (!text.trim()) return;
    const { document, notes } = splitNotes(text);
    setDoc(document);
    setNotes(notes);
  };

  const draft = async () => {
    setEditing(false);
    keep(await ai.run({ mode: "draft", request }));
  };
  const revise = async () => {
    setEditing(false);
    keep(await ai.run({ mode: "revise", request: changes, currentDraft: doc }));
    setChanges("");
  };

  const shown = ai.running ? live.document : doc;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-header"><h3>What do you need?</h3></div>
        <div className="card-body" style={{ display: "grid", gap: 10 }}>
          <textarea
            className="input"
            rows={3}
            value={request}
            placeholder="e.g. A policy on using company vehicles for personal errands during breaks"
            onChange={(e) => setRequest(e.target.value)}
            style={{ height: "auto", padding: 10 }}
          />
          <div className="row gap-4" style={{ flexWrap: "wrap" }}>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="filter-chip" onClick={() => setRequest(ex)} style={{ cursor: "pointer" }}>
                {ex}
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" type="button" disabled={ai.running || request.trim().length < 3} onClick={draft}>
              {doc ? "Start a new draft" : "Draft it"}
            </button>
          </div>
        </div>
      </div>

      {(shown || ai.running || ai.error) && (
        <div className="card">
          <div className="card-header">
            <h3>Draft</h3>
            {!ai.running && doc && (
              <div className="actions">
                <button className="btn sm" type="button" onClick={() => setEditing((v) => !v)}>
                  {editing ? "Preview" : "Edit"}
                </button>
              </div>
            )}
          </div>
          <div className="card-body">
            <StreamStatus status={ai.status} warning={ai.warning} error={ai.error} running={ai.running} onStop={ai.stop} />
            {editing ? (
              <textarea
                className="input mono"
                value={doc}
                onChange={(e) => setDoc(e.target.value)}
                rows={28}
                style={{ height: "auto", width: "100%", padding: 10, fontSize: 12 }}
              />
            ) : (
              shown && <MarkdownPreview markdown={shown} />
            )}
          </div>
        </div>
      )}

      {!ai.running && notes && (
        <div className="card" style={{ borderColor: "var(--warn)", background: "var(--warn-bg)" }}>
          <div className="card-header"><h3>Notes for you (not part of the document)</h3></div>
          <div className="card-body"><MarkdownPreview markdown={notes} /></div>
        </div>
      )}

      {!ai.running && doc && (
        <>
          <div className="card">
            <div className="card-header"><h3>Ask for changes</h3></div>
            <div className="card-body" style={{ display: "grid", gap: 10 }}>
              <textarea
                className="input"
                rows={2}
                value={changes}
                placeholder="e.g. Make it shorter, and say testing is done by an outside provider"
                onChange={(e) => setChanges(e.target.value)}
                style={{ height: "auto", padding: 10 }}
              />
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn" type="button" disabled={changes.trim().length < 3} onClick={revise}>
                  Revise draft
                </button>
              </div>
            </div>
          </div>
          <ApproveDraftForm key={titleFromMarkdown(doc) ?? ""} markdown={doc} />
        </>
      )}
    </div>
  );
}
