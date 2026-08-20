"use client";

/**
 * Structured editor for a load's stop list.
 *
 * Replaces free-text editing of raw_text in LoadEditModal. The parent owns
 * the StopLine[] state and does the raw_text (de)serialisation via
 * lib/portal/stop-lines — this component is pure UI over that array.
 *
 * The `addr` field on each row is carried but never rendered: the geocoder
 * uses it and losing it on an edit would silently worsen positioning.
 */

import type { StopLine } from "@/lib/portal/stop-lines";
import Icon from "./Icon";

const GRID = "24px 1fr 92px 92px 1fr 66px";

export default function StopsEditor({
  stops,
  disabled = false,
  onChange,
}: {
  stops: StopLine[];
  disabled?: boolean;
  onChange: (next: StopLine[]) => void;
}) {
  function patch(index: number, field: keyof StopLine, value: string) {
    onChange(stops.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(stops.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...stops, { postcode: "", from: "", to: "", ref: "", addr: "" }]);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 6,
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--ink-500)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        <span />
        <span>Postcode</span>
        <span>From</span>
        <span>To</span>
        <span>Reference</span>
        <span />
      </div>

      {stops.map((stop, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 6,
            alignItems: "center",
          }}
        >
          <span
            className="muted mono"
            style={{ fontSize: 11, textAlign: "right" }}
          >
            {i + 1}
          </span>
          <input
            type="text"
            value={stop.postcode}
            onChange={(e) => patch(i, "postcode", e.target.value.toUpperCase())}
            disabled={disabled}
            placeholder="NG22 8TX"
            aria-label={`Stop ${i + 1} postcode`}
            className="input mono"
            style={{ height: 30, textTransform: "uppercase" }}
          />
          <input
            type="time"
            value={stop.from}
            onChange={(e) => {
              const from = e.target.value;
              // Clearing the start clears the end too — a window with no
              // opening can't be serialised, so don't let the UI hold one.
              onChange(
                stops.map((s, idx) =>
                  idx === i ? { ...s, from, to: from ? s.to : "" } : s,
                ),
              );
            }}
            disabled={disabled}
            aria-label={`Stop ${i + 1} window opens`}
            className="input mono"
            style={{ height: 30 }}
          />
          <input
            type="time"
            value={stop.to}
            onChange={(e) => patch(i, "to", e.target.value)}
            disabled={disabled || !stop.from}
            title={stop.from ? "Window closes" : "Set a from-time first"}
            aria-label={`Stop ${i + 1} window closes`}
            className="input mono"
            style={{ height: 30 }}
          />
          <input
            type="text"
            value={stop.ref}
            onChange={(e) => patch(i, "ref", e.target.value)}
            disabled={disabled}
            placeholder="optional"
            aria-label={`Stop ${i + 1} reference`}
            className="input mono"
            style={{ height: 30 }}
          />
          <div style={{ display: "flex", gap: 2 }}>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={disabled || i === 0}
              className="btn sm ghost icon-btn"
              aria-label={`Move stop ${i + 1} up`}
            >
              <Icon name="arrowUp" size={11} />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={disabled || i === stops.length - 1}
              className="btn sm ghost icon-btn"
              aria-label={`Move stop ${i + 1} down`}
            >
              <Icon name="arrowDown" size={11} />
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              className="btn sm ghost icon-btn"
              aria-label={`Remove stop ${i + 1}`}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="btn sm ghost"
        >
          + Add stop
        </button>
      </div>

      <span className="muted" style={{ fontSize: 11 }}>
        Leave <em>To</em> blank for a fixed booking time. Set both for a
        delivery window — the ETA never reads earlier than <em>From</em>, and
        the load flags as delayed once <em>To</em> passes.
      </span>
    </div>
  );
}
