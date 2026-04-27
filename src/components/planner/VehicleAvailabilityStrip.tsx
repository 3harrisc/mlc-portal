"use client";

import React from "react";

/**
 * Strip of vehicle pills shown above the daily transport sheet.
 *
 * Each pill represents one of the canonical fleet vehicles (from the
 * `vehicles` table). Pills assigned to at least one leg in today's grid
 * render as "used"; pills not yet assigned render as "available". This
 * mirrors the operator's mental model of "I've got 10 trucks, here's what's
 * still spare for today".
 *
 * Click an available pill to insert a blank row pre-filled with that vehicle.
 */
export interface VehicleAvailabilityStripProps {
  vehicles: ReadonlyArray<string>;          // canonical fleet IDs
  assignedVehicles: ReadonlyArray<string>;  // vehicles already on the day
  /** Optional: invoked when an available pill is clicked. */
  onSelect?: (vehicle: string) => void;
}

export default function VehicleAvailabilityStrip({
  vehicles,
  assignedVehicles,
  onSelect,
}: VehicleAvailabilityStripProps) {
  const assigned = new Set(assignedVehicles.map((v) => v.trim().toUpperCase()));
  const usedCount = vehicles.filter((v) => assigned.has(v.trim().toUpperCase())).length;
  const totalCount = vehicles.length;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <h3>Fleet availability</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          {usedCount} of {totalCount} vehicles assigned · {totalCount - usedCount} spare
        </span>
      </div>
      <div className="card-body" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {vehicles.length === 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            No vehicles configured. Add them under Admin → Vehicles.
          </span>
        )}
        {vehicles.map((v) => {
          const isUsed = assigned.has(v.trim().toUpperCase());
          if (isUsed) {
            return (
              <span
                key={v}
                className="pill mono"
                style={{
                  background: "var(--surface-alt)",
                  color: "var(--ink-400)",
                  border: "1px solid var(--line)",
                  textDecoration: "line-through",
                  fontWeight: 500,
                  letterSpacing: 0,
                  textTransform: "none",
                }}
                title="Already assigned to a leg today"
              >
                {v}
              </span>
            );
          }
          return (
            <button
              key={v}
              type="button"
              className="pill mono"
              onClick={() => onSelect?.(v)}
              style={{
                background: "var(--mlc-blue-50, #EAEFF8)",
                color: "var(--mlc-blue)",
                border: "1px solid var(--mlc-blue-50, #EAEFF8)",
                cursor: onSelect ? "pointer" : "default",
                fontWeight: 600,
                letterSpacing: 0,
                textTransform: "none",
              }}
              title={onSelect ? "Click to add a leg pre-filled with this vehicle" : v}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}
