"use client";

/**
 * Inline-edit modal for the load detail page.
 *
 * Existed nowhere before this — admins could adjust the vehicle reg via the
 * Vehicle & driver card and could delete the row, but every other field
 * (run type, start time, collection time/date, the stops list itself,
 * return-to-base, service mins) was read-only. This dialog fills that
 * gap and is the entry point for converting a load between regular and
 * backload mid-flight.
 *
 * Persistence is via the existing updateLoad server action — no new
 * surface, no new RLS rules. The form's source of truth is local state
 * seeded from the run on open; on save we hand back the new values to
 * the parent, which is responsible for pushing them into its run state
 * and refreshing siblings if needed.
 */

import { useEffect, useRef, useState } from "react";
import type { PlannedRun, RunType } from "@/types/runs";
import Icon from "./Icon";

export interface LoadEdits {
  runType: RunType;
  startTime: string;
  collectionDate: string;
  collectionTime: string;
  fromPostcode: string;
  toPostcode: string;
  rawText: string;
  returnToBase: boolean;
  serviceMins: number;
  includeBreaks: boolean;
}

export default function LoadEditModal({
  open,
  run,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  run: PlannedRun;
  saving: boolean;
  onClose: () => void;
  onSave: (edits: LoadEdits) => Promise<void>;
}) {
  const [edits, setEdits] = useState<LoadEdits>(() => seedFromRun(run));
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset the form whenever the modal is re-opened against a different run.
  // Without this, a save-then-reopen would show stale fields if the parent
  // updated the run between toggles.
  useEffect(() => {
    if (open) setEdits(seedFromRun(run));
  }, [open, run]);

  // Esc to close, click-outside to dismiss — same dismiss model as the
  // build badge popover. Saving in-flight blocks both so we don't lose
  // pending edits to a stray click.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  function update<K extends keyof LoadEdits>(key: K, value: LoadEdits[K]) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    await onSave(edits);
  }

  const isBackload = edits.runType === "backload";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit load"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        ref={dialogRef}
        style={{
          background: "var(--surface)",
          borderRadius: 8,
          border: "1px solid var(--line)",
          width: "min(640px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
      >
        <form onSubmit={handleSave}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16 }}>
              Edit load{" "}
              <span className="muted mono" style={{ fontSize: 13 }}>
                {run.jobNumber || run.id}
              </span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="btn sm ghost icon-btn"
              aria-label="Close"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          <div style={{ padding: 18, display: "grid", gap: 14 }}>
            <Field label="Run type">
              <select
                value={edits.runType}
                onChange={(e) => update("runType", e.target.value as RunType)}
                disabled={saving}
                className="input"
                style={{ height: 32 }}
              >
                <option value="regular">Regular delivery</option>
                <option value="backload">Backload</option>
              </select>
              <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {isBackload
                  ? "Backload: truck goes empty to the pickup, then delivers."
                  : "Regular: truck loads at customer base / collection point, then delivers."}
              </span>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Start time">
                <input
                  type="time"
                  value={edits.startTime}
                  onChange={(e) => update("startTime", e.target.value)}
                  disabled={saving}
                  className="input"
                  style={{ height: 32 }}
                />
              </Field>
              {isBackload && (
                <Field label="Collection time">
                  <input
                    type="time"
                    value={edits.collectionTime}
                    onChange={(e) => update("collectionTime", e.target.value)}
                    disabled={saving}
                    className="input"
                    style={{ height: 32 }}
                  />
                </Field>
              )}
            </div>

            {isBackload && (
              <Field label="Collection date">
                <input
                  type="date"
                  value={edits.collectionDate}
                  onChange={(e) => update("collectionDate", e.target.value)}
                  disabled={saving}
                  className="input"
                  style={{ height: 32 }}
                />
                <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Leave blank if collection and delivery are the same day.
                </span>
              </Field>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label={isBackload ? "Pickup postcode" : "From postcode"}>
                <input
                  type="text"
                  value={edits.fromPostcode}
                  onChange={(e) => update("fromPostcode", e.target.value.toUpperCase())}
                  disabled={saving}
                  className="input mono"
                  style={{ height: 32, textTransform: "uppercase" }}
                />
              </Field>
              <Field label="Final delivery postcode">
                <input
                  type="text"
                  value={edits.toPostcode}
                  onChange={(e) => update("toPostcode", e.target.value.toUpperCase())}
                  disabled={saving}
                  className="input mono"
                  style={{ height: 32, textTransform: "uppercase" }}
                />
              </Field>
            </div>

            <Field label="Stops (one postcode per line, in order)">
              <textarea
                value={edits.rawText}
                onChange={(e) => update("rawText", e.target.value)}
                disabled={saving}
                rows={Math.max(4, Math.min(12, edits.rawText.split("\n").length + 1))}
                className="input mono"
                style={{ minHeight: 96, padding: 8, lineHeight: 1.45 }}
              />
              <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Reorder by moving lines around — chain ETA recomputes on save.
              </span>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Service minutes per stop">
                <input
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  value={edits.serviceMins}
                  onChange={(e) => update("serviceMins", Number(e.target.value) || 0)}
                  disabled={saving}
                  className="input mono"
                  style={{ height: 32 }}
                />
              </Field>
              <Field label="Options">
                <label className="row gap-8" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={edits.returnToBase}
                    onChange={(e) => update("returnToBase", e.target.checked)}
                    disabled={saving}
                  />
                  Return to base after last drop
                </label>
                <label className="row gap-8" style={{ fontSize: 12, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={edits.includeBreaks}
                    onChange={(e) => update("includeBreaks", e.target.checked)}
                    disabled={saving}
                  />
                  Include legal breaks in ETA
                </label>
              </Field>
            </div>
          </div>

          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              className="btn sm ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn sm primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11.5,
        fontWeight: 600,
        color: "var(--ink-700)",
      }}
    >
      {label}
      {children}
    </label>
  );
}

function seedFromRun(run: PlannedRun): LoadEdits {
  return {
    runType: run.runType ?? "regular",
    startTime: run.startTime ?? "08:00",
    collectionDate: run.collectionDate ?? "",
    collectionTime: run.collectionTime ?? "",
    fromPostcode: run.fromPostcode ?? "",
    toPostcode: run.toPostcode ?? "",
    rawText: run.rawText ?? "",
    returnToBase: run.returnToBase ?? true,
    serviceMins: run.serviceMins ?? 25,
    includeBreaks: run.includeBreaks ?? true,
  };
}
