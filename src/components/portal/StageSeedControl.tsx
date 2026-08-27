"use client";

/**
 * Admin control for saying what stage a load's vehicle is actually at.
 *
 * The value shown is the stage the load currently reads as, not a stored
 * override — choosing a different one seeds real progress state and the
 * geofence tracking carries on from there.
 */

import type { StageId, StageOption } from "@/lib/portal/stage-seed";

export default function StageSeedControl({
  options,
  value,
  saving,
  onChange,
}: {
  options: StageOption[];
  value: StageId;
  saving: boolean;
  onChange: (next: StageId) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 3, justifyItems: "start" }}>
      <span
        className="muted"
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          fontWeight: 600,
        }}
      >
        Vehicle is currently
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
        className="input"
        style={{ height: 26, fontSize: 11.5, width: "auto" }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
