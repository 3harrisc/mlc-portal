"use client";

/** Status line, warnings and errors for a running assistant request. */
export default function StreamStatus({
  status, warning, error, running, onStop,
}: { status: string | null; warning: string | null; error: string | null; running: boolean; onStop: () => void }) {
  if (!running && !warning && !error) return null;
  return (
    <div style={{ display: "grid", gap: 6, marginBottom: 10, fontSize: 12.5 }}>
      {running && (
        <div className="row gap-8" style={{ color: "var(--ink-500)" }}>
          <span className="status-dot" />
          <span>{status ?? "Working…"}</span>
          <button className="btn sm ghost" type="button" onClick={onStop}>Stop</button>
        </div>
      )}
      {warning && <div style={{ color: "var(--warn)" }}>{warning}</div>}
      {error && <div style={{ color: "var(--err)" }}>{error}</div>}
    </div>
  );
}
