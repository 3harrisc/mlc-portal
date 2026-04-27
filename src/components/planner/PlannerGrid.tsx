"use client";

import React, { useMemo, useState, useImperativeHandle, forwardRef } from "react";
import type { PlannedRun } from "@/types/runs";
import {
  updatePlannerCell,
  insertBlankPlannerRun,
  deletePlannerRun,
} from "@/app/actions/planner";
import Icon from "@/components/portal/Icon";

/**
 * The "DAILY TRANSPORT SHEET" — the source of truth for the day's runs.
 *
 * Column language matches the spreadsheet exactly:
 *   Collection · Delivery · DAYS · FACTORY · Booking Time · Vehicle ·
 *   SUBBY/DRIVER · SUBBY COST · Trailer Number · Trailer Dropped? ·
 *   Reference · Customer
 * plus portal-side billing columns: Revenue, Bill?, Status.
 *
 * Outbound (regular) rows render with a pink left-edge tint, backloads
 * render with a blue tint — same colour code as the operator uses on the
 * spreadsheet. Pink/blue come from the brand palette, not OS-default red/blue.
 *
 * Cells are inline-editable and persist on blur.
 */
export interface PlannerGridProps {
  date: string;                                 // yyyy-MM-dd
  initialRuns: ReadonlyArray<PlannedRun>;
  customers: ReadonlyArray<string>;
  trailers: ReadonlyArray<string>;
  vehicles: ReadonlyArray<string>;
  /** When false, the grid renders read-only — used for non-admin viewers. */
  editable: boolean;
  onChanged?: (runs: PlannedRun[]) => void;
}

export interface PlannerGridHandle {
  /** Insert a blank row, optionally pre-filling the vehicle (used by the
   *  Fleet availability strip). */
  addRowWithVehicle: (vehicle?: string) => Promise<void>;
}

const PlannerGrid = forwardRef<PlannerGridHandle, PlannerGridProps>(function PlannerGrid(
  props,
  ref
) {
  const { date, initialRuns, customers, trailers, vehicles, editable, onChanged } = props;
  const [runs, setRuns] = useState<PlannedRun[]>([...initialRuns]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const initialKey = useMemo(() => initialRuns.map((r) => r.id).join("|"), [initialRuns]);
  const lastKey = React.useRef(initialKey);
  React.useEffect(() => {
    if (lastKey.current !== initialKey) {
      lastKey.current = initialKey;
      setRuns([...initialRuns]);
    }
  }, [initialKey, initialRuns]);

  function patchLocal(id: string, fields: Partial<PlannedRun>) {
    setRuns((curr) => {
      const next = curr.map((r) => (r.id === id ? { ...r, ...fields } : r));
      onChanged?.(next);
      return next;
    });
  }

  async function persist(id: string, payload: Parameters<typeof updatePlannerCell>[1]) {
    const res = await updatePlannerCell(id, payload);
    if (res.error) setError(res.error);
  }

  async function addRow(prefillVehicle?: string) {
    setBusy(true);
    setError("");
    const res = await insertBlankPlannerRun(date);
    setBusy(false);
    if (res.error || !res.run) {
      setError(res.error ?? "Failed to add row");
      return;
    }
    let row = res.run;
    if (prefillVehicle) {
      row = { ...row, vehicle: prefillVehicle };
      void persist(row.id, { vehicle: prefillVehicle });
    }
    setRuns((curr) => {
      const next = [...curr, row];
      onChanged?.(next);
      return next;
    });
  }

  useImperativeHandle(
    ref,
    (): PlannerGridHandle => ({
      addRowWithVehicle: async (vehicle?: string) => {
        await addRow(vehicle);
      },
    }),
    // addRow closes over `date` and `setRuns`; we only need to refresh
    // the handle when those identities matter — they don't here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function removeRow(id: string) {
    if (!confirm("Delete this row?")) return;
    setBusy(true);
    setError("");
    const res = await deletePlannerRun(id);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setRuns((curr) => {
      const next = curr.filter((r) => r.id !== id);
      onChanged?.(next);
      return next;
    });
  }

  // Bottom strip — Vehicle Earnings UK Deliveries.
  const earnings = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of runs) {
      const v = r.vehicle?.trim() || "—";
      map.set(v, (map.get(v) ?? 0) + (r.revenue ?? 0));
    }
    const list = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    const total = list.reduce((s, [, v]) => s + v, 0);
    return { list, total };
  }, [runs]);

  // SUBBY COST is rare — only show the column when at least one leg in
  // today's grid has vehicle=SUBBY. Saves 70px of horizontal space on
  // every other day.
  const showSubbyCost = useMemo(
    () => runs.some((r) => (r.vehicle ?? "").trim().toUpperCase() === "SUBBY"),
    [runs]
  );

  return (
    <>
      {error && (
        <div
          className="card"
          style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}
        >
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>
            {error}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3>UK Deliveries</h3>
          <span className="muted" style={{ fontSize: 11 }}>
            {runs.length} leg{runs.length === 1 ? "" : "s"} · {date}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            className="data"
            style={{
              width: "100%",
              tableLayout: "fixed",
              fontSize: 12,
            }}
          >
            {/*
              Explicit column widths so the row fits on one screen without
              horizontal scroll. Booking Time / FACTORY / SUBBY COST /
              Trailer Number / Vehicle were trimmed per operator feedback —
              they're rarely fully populated, so they don't earn 150px each.
            */}
            <colgroup>
              <col style={{ width: 4 }} />          {/* tint stripe */}
              <col style={{ width: "11%" }} />      {/* Collection */}
              <col style={{ width: "13%" }} />      {/* Delivery — leave longest */}
              <col style={{ width: 92 }} />         {/* DAYS — bigger so the 1 OF 2 inputs are visible */}
              <col style={{ width: 78 }} />         {/* FACTORY (BRAKES, POOLE…) */}
              <col style={{ width: 70 }} />         {/* Booking Time */}
              <col style={{ width: 76 }} />         {/* Vehicle */}
              <col style={{ width: 86 }} />         {/* SUBBY/DRIVER — trimmed */}
              {showSubbyCost && <col style={{ width: 70 }} />}  {/* SUBBY COST (conditional) */}
              <col style={{ width: 64 }} />         {/* Trailer Number — trimmed */}
              <col style={{ width: 50 }} />         {/* Trailer Dropped? */}
              <col style={{ width: "10%" }} />      {/* Reference */}
              <col style={{ width: "11%" }} />      {/* Customer */}
              <col style={{ width: 80 }} />         {/* Revenue */}
              <col style={{ width: 44 }} />         {/* Bill? */}
              <col style={{ width: 80 }} />         {/* Status */}
              {editable && <col style={{ width: 64 }} />}{/* Delete */}
            </colgroup>
            <thead>
              <tr>
                <th />{/* row tint indicator */}
                <th>Collection</th>
                <th>Delivery</th>
                <th style={{ textAlign: "center" }}>DAYS</th>
                <th>FACTORY</th>
                <th>Booking</th>
                <th>Vehicle</th>
                <th>SUBBY/DRIVER</th>
                {showSubbyCost && <th className="right">SUBBY £</th>}
                <th>Trailer #</th>
                <th style={{ textAlign: "center" }} title="Trailer dropped?">Drop?</th>
                <th>Reference</th>
                <th>Customer</th>
                <th className="right">Revenue</th>
                <th style={{ textAlign: "center" }}>Bill?</th>
                <th>Status</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const isBackload = r.runType === "backload";
                const tint = isBackload
                  ? "rgba(11, 42, 107, 0.04)"          // soft brand-blue for backloads
                  : "rgba(216, 30, 42, 0.04)";        // soft brand-pink for outbound
                const stripeColour = isBackload
                  ? "var(--mlc-blue, #0B2A6B)"
                  : "var(--mlc-red, #D81E2A)";
                const locked = r.invoiceStatus === "sent" || r.invoiceStatus === "paid";
                return (
                  <tr key={r.id} style={{ cursor: "default", background: tint }}>
                    <td
                      style={{
                        width: 4,
                        padding: 0,
                        background: stripeColour,
                        borderBottom: "1px solid var(--line)",
                      }}
                      title={isBackload ? "Backload" : "Outbound"}
                    />
                    <TextCell value={r.fromPostcode} editable={editable && !locked}
                      onCommit={(v) => { patchLocal(r.id, { fromPostcode: v }); void persist(r.id, { fromPostcode: v }); }} />
                    <TextCell value={r.toPostcode} editable={editable && !locked}
                      onCommit={(v) => { patchLocal(r.id, { toPostcode: v }); void persist(r.id, { toPostcode: v }); }} />
                    <DaysCell
                      dayIndex={r.dayIndex ?? null}
                      dayCount={r.dayCount ?? null}
                      editable={editable && !locked}
                      onCommit={(idx, cnt) => {
                        patchLocal(r.id, { dayIndex: idx ?? undefined, dayCount: cnt ?? undefined });
                        void persist(r.id, { dayIndex: idx, dayCount: cnt });
                      }}
                    />
                    <TextCell value={r.factory ?? ""} editable={editable && !locked}
                      onCommit={(v) => { patchLocal(r.id, { factory: v || undefined }); void persist(r.id, { factory: v || null }); }} />
                    <TextCell value={r.bookingTime ?? ""} editable={editable && !locked}
                      onCommit={(v) => { patchLocal(r.id, { bookingTime: v || undefined }); void persist(r.id, { bookingTime: v || null }); }} />
                    <SelectCell value={r.vehicle} options={vehicles} editable={editable && !locked} allowFree mono
                      onCommit={(v) => { patchLocal(r.id, { vehicle: v }); void persist(r.id, { vehicle: v }); }} />
                    <TextCell value={r.subbyDriver ?? ""} editable={editable && !locked}
                      onCommit={(v) => { patchLocal(r.id, { subbyDriver: v || undefined }); void persist(r.id, { subbyDriver: v || null }); }} />
                    {showSubbyCost && (
                      <NumberCell value={r.subbyCost ?? 0} editable={editable && !locked}
                        onCommit={(n) => { patchLocal(r.id, { subbyCost: n }); void persist(r.id, { subbyCost: n }); }} />
                    )}
                    <SelectCell value={r.trailerNumber ?? ""} options={trailers} editable={editable && !locked} allowFree mono
                      onCommit={(v) => { patchLocal(r.id, { trailerNumber: v || undefined }); void persist(r.id, { trailerNumber: v || null }); }} />
                    <CheckCell checked={r.trailerDropped ?? false} disabled={!editable || locked}
                      onChange={(v) => { patchLocal(r.id, { trailerDropped: v }); void persist(r.id, { trailerDropped: v }); }} />
                    <TextCell value={r.loadRef ?? ""} editable={editable && !locked} mono
                      onCommit={(v) => { patchLocal(r.id, { loadRef: v }); void persist(r.id, { loadRef: v }); }} />
                    <SelectCell value={r.customer} options={customers} editable={editable && !locked} allowFree
                      onCommit={(v) => { patchLocal(r.id, { customer: v }); void persist(r.id, { customer: v }); }} />
                    <NumberCell value={r.revenue ?? 0} editable={editable && !locked}
                      onCommit={(n) => { patchLocal(r.id, { revenue: n }); void persist(r.id, { revenue: n }); }} />
                    <CheckCell checked={r.billable ?? false} disabled={!editable || locked}
                      onChange={(v) => {
                        patchLocal(r.id, { billable: v });
                        void persist(r.id, {
                          billable: v,
                          invoiceStatus: v && (r.invoiceStatus ?? "open") === "open" ? "billable" : r.invoiceStatus,
                        });
                      }} />
                    <td><StatusPill status={r.invoiceStatus ?? "open"} /></td>
                    {editable && (
                      <td className="right">
                        <button
                          type="button"
                          className="btn sm ghost"
                          disabled={busy || locked}
                          onClick={() => void removeRow(r.id)}
                          style={{ color: "var(--err)" }}
                        >
                          <Icon name="x" size={11} /> Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={(editable ? 17 : 16) - (showSubbyCost ? 0 : 1)}
                    style={{ textAlign: "center", padding: 32, color: "var(--ink-500)", fontSize: 12.5 }}
                  >
                    No legs for {date}.{" "}
                    {editable && (
                      <button type="button" className="btn sm" onClick={() => void addRow()} style={{ marginLeft: 8 }}>
                        <Icon name="plus" size={11} /> Add the first row
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && runs.length > 0 && (
          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button type="button" className="btn sm" disabled={busy} onClick={() => void addRow()}>
              <Icon name="plus" size={11} /> Add row
            </button>
            <Legend />
          </div>
        )}
      </div>

      {/* Vehicle Earnings strip — bottom of daily sheet */}
      {earnings.list.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h3>Vehicle Earnings UK Deliveries</h3>
            <span className="muted" style={{ fontSize: 11 }}>
              Sum of revenue per vehicle for {date}
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  {earnings.list.map(([v]) => (
                    <th key={v} className="right mono">{v}</th>
                  ))}
                  <th className="right" style={{ borderLeft: "1px solid var(--line)" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ cursor: "default" }}>
                  {earnings.list.map(([v, amt]) => (
                    <td key={v} className="right mono tnum">£{amt.toFixed(2)}</td>
                  ))}
                  <td className="right mono tnum bold" style={{ borderLeft: "1px solid var(--line)" }}>
                    £{earnings.total.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
});

export default PlannerGrid;

// ── Cell components ──────────────────────────────────────────────────

function Legend() {
  return (
    <div className="row gap-12 muted" style={{ fontSize: 11 }}>
      <span className="row gap-4">
        <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--mlc-red, #D81E2A)", borderRadius: 2 }} />
        Outbound
      </span>
      <span className="row gap-4">
        <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--mlc-blue, #0B2A6B)", borderRadius: 2 }} />
        Backload
      </span>
    </div>
  );
}

function TextCell({
  value,
  editable,
  mono,
  onCommit,
}: {
  value: string;
  editable: boolean;
  mono?: boolean;
  onCommit: (v: string) => void;
}) {
  if (!editable) {
    // Read-only: truncate with ellipsis so long values don't burst the cell.
    return (
      <td
        className={mono ? "mono" : undefined}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={value || undefined}
      >
        {value || <span className="muted">—</span>}
      </td>
    );
  }
  return (
    <td style={{ padding: "4px 6px" }}>
      <input
        type="text"
        defaultValue={value}
        title={value || undefined}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            (e.target as HTMLInputElement).value = value;
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`input ${mono ? "mono" : ""}`}
        style={{
          width: "100%",
          height: 28,
          padding: "0 6px",
          fontSize: 12.5,
          boxSizing: "border-box",
        }}
      />
    </td>
  );
}

function NumberCell({
  value,
  editable,
  onCommit,
}: {
  value: number;
  editable: boolean;
  onCommit: (n: number) => void;
}) {
  if (!editable) {
    return (
      <td className="right mono tnum">
        {value > 0 ? value.toFixed(2) : <span className="muted">—</span>}
      </td>
    );
  }
  return (
    <td className="right" style={{ padding: "4px 6px" }}>
      <input
        type="number"
        step="0.01"
        min="0"
        defaultValue={value > 0 ? value.toFixed(2) : ""}
        placeholder="0.00"
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="input mono tnum"
        style={{
          width: "100%",
          height: 28,
          padding: "0 6px",
          fontSize: 12.5,
          textAlign: "right",
          boxSizing: "border-box",
        }}
      />
    </td>
  );
}

function SelectCell({
  value,
  options,
  editable,
  allowFree,
  mono,
  onCommit,
}: {
  value: string;
  options: ReadonlyArray<string>;
  editable: boolean;
  allowFree?: boolean;
  mono?: boolean;
  onCommit: (v: string) => void;
}) {
  if (!editable) {
    return (
      <td
        className={mono ? "mono" : undefined}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={value || undefined}
      >
        {value || <span className="muted">—</span>}
      </td>
    );
  }
  if (allowFree) {
    const datalistId = `dl-${Math.random().toString(36).slice(2, 8)}`;
    return (
      <td style={{ padding: "4px 6px" }}>
        <input
          type="text"
          list={datalistId}
          defaultValue={value}
          title={value || undefined}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== value) onCommit(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={`input ${mono ? "mono" : ""}`}
          style={{
            width: "100%",
            height: 28,
            padding: "0 6px",
            fontSize: 12.5,
            boxSizing: "border-box",
          }}
        />
        <datalist id={datalistId}>
          {options.map((o) => <option key={o} value={o} />)}
        </datalist>
      </td>
    );
  }
  return (
    <td style={{ padding: "4px 6px" }}>
      <select
        defaultValue={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v !== value) onCommit(v);
        }}
        className="select"
        style={{
          width: "100%",
          height: 28,
          padding: "0 6px",
          fontSize: 12.5,
          boxSizing: "border-box",
        }}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
      </select>
    </td>
  );
}

function CheckCell({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <td style={{ textAlign: "center" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`cb ${checked ? "checked" : ""}`}
        style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
        aria-label={checked ? "Checked" : "Unchecked"}
      >
        {checked && <Icon name="check" size={10} />}
      </button>
    </td>
  );
}

/**
 * "DAYS" column — three cells like the spreadsheet: number / "OF" / number.
 * Both empty = single-day leg (the default). Setting either commits both
 * (with a sensible default for the other).
 */
function DaysCell({
  dayIndex,
  dayCount,
  editable,
  onCommit,
}: {
  dayIndex: number | null;
  dayCount: number | null;
  editable: boolean;
  onCommit: (idx: number | null, cnt: number | null) => void;
}) {
  const idx = dayIndex ?? "";
  const cnt = dayCount ?? "";

  if (!editable) {
    if (dayIndex == null || dayCount == null) {
      return <td style={{ textAlign: "center" }}><span className="muted">—</span></td>;
    }
    return (
      <td className="mono tnum" style={{ textAlign: "center" }}>
        {dayIndex} OF {dayCount}
      </td>
    );
  }

  function commit(rawIdx: string, rawCnt: string) {
    const i = rawIdx === "" ? null : Number(rawIdx);
    const c = rawCnt === "" ? null : Number(rawCnt);
    // Validate: either both null or both >= 1 with i <= c
    if (i == null && c == null) {
      onCommit(null, null);
      return;
    }
    if (i != null && c == null) {
      // user set an index but no count: default count to index
      onCommit(i, i);
      return;
    }
    if (i == null && c != null) {
      // user set a count but no index: default index to 1
      onCommit(1, c);
      return;
    }
    if (i! > c!) {
      onCommit(c, c);
      return;
    }
    onCommit(i, c);
  }

  return (
    <td style={{ textAlign: "center", padding: "4px 4px" }}>
      <span className="row gap-4" style={{ justifyContent: "center" }}>
        <input
          type="number"
          min="1"
          max="9"
          defaultValue={String(idx)}
          placeholder="—"
          onBlur={(e) => commit(e.target.value, String(cnt))}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="input mono tnum"
          style={{
            width: 32,
            height: 26,
            padding: "0 4px",
            fontSize: 12,
            textAlign: "center",
            boxSizing: "border-box",
          }}
        />
        <span className="muted" style={{ fontSize: 10, fontWeight: 600 }}>OF</span>
        <input
          type="number"
          min="1"
          max="9"
          defaultValue={String(cnt)}
          placeholder="—"
          onBlur={(e) => commit(String(idx), e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="input mono tnum"
          style={{
            width: 32,
            height: 26,
            padding: "0 4px",
            fontSize: 12,
            textAlign: "center",
            boxSizing: "border-box",
          }}
        />
      </span>
    </td>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "in-transit",
    paid: "delivered",
    billable: "loading",
    cancelled: "scheduled",
    open: "scheduled",
  };
  const cls = map[status] ?? "scheduled";
  return (
    <span className={`pill ${cls}`}>
      <span className="dot" />
      {status}
    </span>
  );
}
