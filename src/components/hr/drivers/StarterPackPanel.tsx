"use client";

import type { ChecklistItem } from "@/lib/hr/checklist";

interface Props {
  items: ChecklistItem[];
  /** True once the contract has been sent (so the button becomes "Re-send"). */
  contractSent: boolean;
  isStarter: boolean;
  busy: boolean;
  onSend: () => void;
  onMarkActive: () => void;
}

/** Onboarding checklist with the starter-pack action. */
export default function StarterPackPanel({ items, contractSent, isStarter, busy, onSend, onMarkActive }: Props) {
  const done = items.filter((i) => i.done).length;
  const complete = done === items.length;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", fontSize: 12.5 }}>
        <span>
          <b>{done} of {items.length}</b> done
          {complete && <span style={{ color: "var(--ok)" }}> · all complete</span>}
        </span>
        <div className="row gap-8">
          {complete && isStarter && (
            <button className="btn sm" type="button" disabled={busy} onClick={onMarkActive}>Mark as active</button>
          )}
          <button className="btn primary sm" type="button" disabled={busy} onClick={onSend}>
            {contractSent ? "Re-send contract" : "Send starter pack"}
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {items.map((i) => (
          <div key={i.key} className="row gap-8" style={{ fontSize: 12.5, alignItems: "flex-start" }}>
            <span style={{ width: 16, color: i.done ? "var(--ok)" : "var(--ink-400, #9ca3af)" }}>{i.done ? "✓" : "○"}</span>
            <span style={{ flex: 1 }}>
              {i.label}
              {!i.done && i.hint && <span className="muted" style={{ fontSize: 11 }}> · {i.hint}</span>}
            </span>
          </div>
        ))}
      </div>
      {!contractSent && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          Send starter pack sends the blank contract with this driver&apos;s start date. Handbook, H&amp;S and other
          &ldquo;all drivers&rdquo; documents reach them automatically once their login is linked.
        </div>
      )}
    </div>
  );
}
