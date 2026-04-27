"use client";

import React, { useMemo, useState, useImperativeHandle, forwardRef } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PlannedRun } from "@/types/runs";
import {
  updatePlannerCell,
  insertBlankPlannerRun,
  deletePlannerRun,
} from "@/app/actions/planner";
import { updateRunOrders, clearRunOrdersForDate } from "@/app/actions/runs";
import Icon from "@/components/portal/Icon";
import { useColumnPrefs, type ColumnDef } from "@/hooks/useColumnPrefs";

/**
 * Reorder/resize-able column definitions for the planner grid.
 * Both order and width persist in localStorage per-device.
 *
 * The leading 4px tint stripe and the trailing Delete column are NOT in
 * this list — they're frame, not user-rearrangeable content.
 */
type Align = "left" | "center" | "right";
interface PlannerColDef extends ColumnDef {
  label: string;
  align?: Align;
}

const PLANNER_COLUMNS: ReadonlyArray<PlannerColDef> = [
  { id: "collection",      label: "Collection",   defaultWidth: 140, minWidth: 70 },
  { id: "delivery",        label: "Delivery",     defaultWidth: 170, minWidth: 70 },
  { id: "days",            label: "DAYS",         defaultWidth: 92,  minWidth: 70, align: "center" },
  { id: "factory",         label: "FACTORY",      defaultWidth: 88,  minWidth: 50 },
  { id: "booking",         label: "Booking",      defaultWidth: 80,  minWidth: 50 },
  { id: "vehicle",         label: "Vehicle",      defaultWidth: 86,  minWidth: 60 },
  { id: "subby_driver",    label: "SUBBY/DRIVER", defaultWidth: 90,  minWidth: 50 },
  { id: "subby_cost",      label: "SUBBY £",      defaultWidth: 76,  minWidth: 50, align: "right" },
  { id: "trailer_number",  label: "Trailer #",    defaultWidth: 76,  minWidth: 50 },
  { id: "trailer_dropped", label: "Drop?",        defaultWidth: 56,  minWidth: 40, align: "center" },
  { id: "reference",       label: "Reference",    defaultWidth: 110, minWidth: 60 },
  { id: "customer",        label: "Customer",     defaultWidth: 130, minWidth: 70 },
  { id: "revenue",         label: "Revenue",      defaultWidth: 88,  minWidth: 60, align: "right" },
  { id: "bill",            label: "Bill?",        defaultWidth: 50,  minWidth: 40, align: "center" },
  { id: "status",          label: "Status",       defaultWidth: 90,  minWidth: 60 },
];

const COLUMN_BY_ID: Record<string, PlannerColDef> = Object.fromEntries(
  PLANNER_COLUMNS.map((c) => [c.id, c])
);

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

  // Drag-reorder + drag-resize column prefs, persisted per-device.
  const { widths, order, setWidth, reorder, reset: resetColumnPrefs } = useColumnPrefs(
    "planner-grid",
    PLANNER_COLUMNS
  );

  // dnd-kit sensors. The 8px distance threshold means short clicks don't
  // accidentally start a drag — important since the planner is full of
  // editable inputs and inputs need to remain clickable.
  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleHeaderDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorder(String(active.id), String(over.id));
  }

  /**
   * Drag-and-drop ROW reorder. When the user drops a row in a new spot:
   *   1. Recompute the visible order via arrayMove.
   *   2. Assign every row a sequential runOrder (0..N-1) so the new order
   *      survives reload.
   *   3. Persist all the runOrders to Supabase in one batch.
   *
   * After this, the customer-priority sort effectively becomes a tiebreaker
   * (it never fires because every row has a unique runOrder). Use the
   * "Reset row order" button to clear runOrders and revert to the priority
   * sort.
   */
  async function handleRowDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setRuns((prev) => {
      const fromIdx = prev.findIndex((r) => r.id === active.id);
      const toIdx = prev.findIndex((r) => r.id === over.id);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const reordered = arrayMove(prev, fromIdx, toIdx);
      const stamped = reordered.map((r, i) => ({ ...r, runOrder: i }));
      // Persist in the background — UI state is already updated optimistically.
      void updateRunOrders(
        stamped.map((r) => ({ id: r.id, runOrder: r.runOrder ?? 0 }))
      );
      onChanged?.(stamped);
      return stamped;
    });
  }

  /**
   * Reset every row's runOrder to null on the server, so the day reverts
   * to the default sort (customer-priority → vehicle → startTime).
   */
  async function handleResetRowOrder() {
    if (!confirm("Reset row order? This clears the manual order and reverts to the customer-priority sort.")) return;
    setBusy(true);
    setError("");
    const res = await clearRunOrdersForDate(date);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setRuns((prev) => {
      const cleared = prev.map((r) => ({ ...r, runOrder: null }));
      onChanged?.(cleared);
      return cleared;
    });
  }

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
              tableLayout: "fixed",
              fontSize: 12,
              // Width = sum of visible column widths; horizontal scroll appears
              // when this exceeds the container, which is fine on iPad.
              width: visibleColumnsWidthSum(widths, order, showSubbyCost, editable),
            }}
          >
            {/*
              Drag-resize widths AND drag-reorder columns, both persisted in
              localStorage per-device. Tint stripe (left) and Delete column
              (right) are frame — not user-rearrangeable.
            */}
            <colgroup>
              <col style={{ width: 4 }} />{/* tint stripe — fixed */}
              {order.map((id) => {
                if (id === "subby_cost" && !showSubbyCost) return null;
                return <col key={id} style={{ width: widths[id] }} />;
              })}
              {editable && <col style={{ width: 70 }} />}{/* Delete */}
            </colgroup>
            <thead>
              <DndContext
                sensors={sortSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleHeaderDragEnd}
              >
                <SortableContext
                  items={order.filter((id) => id !== "subby_cost" || showSubbyCost)}
                  strategy={horizontalListSortingStrategy}
                >
                  <tr>
                    <th />{/* tint */}
                    {order.map((id) => {
                      if (id === "subby_cost" && !showSubbyCost) return null;
                      const def = COLUMN_BY_ID[id];
                      if (!def) return null;
                      return (
                        <SortableResizableHeader
                          key={id}
                          colId={id}
                          label={def.label}
                          width={widths[id]}
                          minWidth={def.minWidth ?? 30}
                          align={def.align}
                          onResize={setWidth}
                        />
                      );
                    })}
                    {editable && <th />}{/* delete */}
                  </tr>
                </SortableContext>
              </DndContext>
            </thead>
            <DndContext
              sensors={sortSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleRowDragEnd}
            >
              <SortableContext
                items={runs.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {runs.map((r) => (
                    <SortableRow
                      key={r.id}
                      run={r}
                      editable={editable}
                      busy={busy}
                      order={order}
                      showSubbyCost={showSubbyCost}
                      customers={customers}
                      trailers={trailers}
                      vehicles={vehicles}
                      patchLocal={patchLocal}
                      persist={persist}
                      onRemove={removeRow}
                    />
                  ))}
                  {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={1 + order.length - (showSubbyCost ? 0 : 1) + (editable ? 1 : 0)}
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
              </SortableContext>
            </DndContext>
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
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => void handleResetRowOrder()}
              disabled={busy}
              title="Clear the manual row order and revert to customer-priority sort"
            >
              <Icon name="refresh" size={11} /> Reset row order
            </button>
            <button
              type="button"
              className="btn sm ghost"
              onClick={resetColumnPrefs}
              title="Restore default column order and widths on this device"
            >
              <Icon name="refresh" size={11} /> Reset columns
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

/**
 * Sum the widths of every currently-visible column (incl. tint stripe and
 * the trailing Delete column when admin). Used as the table's total width
 * so the browser knows when to overflow horizontally.
 */
function visibleColumnsWidthSum(
  widths: Readonly<Record<string, number>>,
  order: ReadonlyArray<string>,
  showSubbyCost: boolean,
  editable: boolean
): number {
  const TINT_STRIPE = 4;
  const DELETE_COL = 70;
  let total = TINT_STRIPE;
  for (const id of order) {
    if (id === "subby_cost" && !showSubbyCost) continue;
    total += widths[id] ?? 0;
  }
  if (editable) total += DELETE_COL;
  return total;
}

/**
 * A draggable row. The leftmost cell (the tint stripe, slightly widened
 * to be a usable hit-box) is the drag handle — pressing and dragging it
 * moves the row up or down. Inputs in the rest of the row remain
 * clickable / editable as normal.
 */
interface SortableRowProps {
  run: PlannedRun;
  editable: boolean;
  busy: boolean;
  order: ReadonlyArray<string>;
  showSubbyCost: boolean;
  customers: ReadonlyArray<string>;
  trailers: ReadonlyArray<string>;
  vehicles: ReadonlyArray<string>;
  patchLocal: (id: string, fields: Partial<PlannedRun>) => void;
  persist: (id: string, payload: Parameters<typeof updatePlannerCell>[1]) => Promise<void>;
  onRemove: (id: string) => Promise<void> | void;
}

function SortableRow({
  run: r,
  editable,
  busy,
  order,
  showSubbyCost,
  customers,
  trailers,
  vehicles,
  patchLocal,
  persist,
  onRemove,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: r.id });

  const isBackload = r.runType === "backload";
  const tint = isBackload
    ? "rgba(11, 42, 107, 0.04)"
    : "rgba(216, 30, 42, 0.04)";
  const stripeColour = isBackload
    ? "var(--mlc-blue, #0B2A6B)"
    : "var(--mlc-red, #D81E2A)";
  const locked = r.invoiceStatus === "sent" || r.invoiceStatus === "paid";
  const editableNow = editable && !locked;

  return (
    <tr
      ref={setNodeRef}
      {...attributes}
      style={{
        cursor: "default",
        background: isDragging ? "var(--surface-alt)" : tint,
        opacity: isDragging ? 0.7 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <td
        {...listeners}
        title={`${isBackload ? "Backload" : "Outbound"} — drag to reorder`}
        style={{
          width: 4,
          padding: 0,
          background: stripeColour,
          borderBottom: "1px solid var(--line)",
          cursor: editable ? (isDragging ? "grabbing" : "grab") : "default",
          touchAction: "none",
        }}
      />
      {order.map((id) => {
        if (id === "subby_cost" && !showSubbyCost) return null;
        return (
          <React.Fragment key={id}>
            {renderCell(id, r, {
              editable: editableNow,
              customers,
              trailers,
              vehicles,
              patchLocal,
              persist,
            })}
          </React.Fragment>
        );
      })}
      {editable && (
        <td className="right">
          <button
            type="button"
            className="btn sm ghost"
            disabled={busy || locked}
            onClick={() => void onRemove(r.id)}
            style={{ color: "var(--err)" }}
          >
            <Icon name="x" size={11} /> Delete
          </button>
        </td>
      )}
    </tr>
  );
}

/**
 * A sortable + resizable header. Drag the body of the header to reorder;
 * drag the right-edge handle to resize. The handle stops propagation on
 * pointerdown so resize never accidentally starts a column drag.
 */
interface SortableResizableHeaderProps {
  colId: string;
  label: string;
  width: number;
  minWidth: number;
  align?: "left" | "center" | "right";
  onResize: (id: string, width: number) => void;
}

function SortableResizableHeader({
  colId,
  label,
  width,
  minWidth,
  align = "left",
  onResize,
}: SortableResizableHeaderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: colId });

  // Resize-handle pointer state.
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(width);
  const draggingRef = React.useRef(false);

  function handleResizePointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  function handleResizePointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    onResize(colId, Math.max(minWidth, startWidthRef.current + delta));
  }
  function handleResizePointerEnd(e: React.PointerEvent<HTMLSpanElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  const textAlign = align === "right" ? "right" : align === "center" ? "center" : "left";

  return (
    <th
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        position: "relative",
        textAlign,
        paddingRight: 14,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.4 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "none",
        userSelect: "none",
      }}
      title={`Drag to reorder · drag the right edge to resize`}
    >
      {label}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${colId} column`}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        className="col-resize-handle"
        style={{
          position: "absolute",
          right: -1,
          top: 0,
          bottom: 0,
          width: 12,
          cursor: "col-resize",
          touchAction: "none",
          userSelect: "none",
          zIndex: 2,
        }}
      />
    </th>
  );
}

/**
 * Cell-renderer dispatch. Turns a column id + run row into a `<td>`.
 * Defined as a top-level switch (not a hash of closures) so it doesn't
 * re-create a Function per row per render.
 */
interface CellCtx {
  editable: boolean;
  customers: ReadonlyArray<string>;
  trailers: ReadonlyArray<string>;
  vehicles: ReadonlyArray<string>;
  patchLocal: (id: string, fields: Partial<PlannedRun>) => void;
  persist: (id: string, payload: Parameters<typeof updatePlannerCell>[1]) => Promise<void>;
}

function renderCell(id: string, r: PlannedRun, ctx: CellCtx): React.ReactNode {
  const { editable, customers, trailers, vehicles, patchLocal, persist } = ctx;
  switch (id) {
    case "collection":
      return (
        <TextCell
          value={r.fromPostcode}
          editable={editable}
          onCommit={(v) => { patchLocal(r.id, { fromPostcode: v }); void persist(r.id, { fromPostcode: v }); }}
        />
      );
    case "delivery":
      return (
        <TextCell
          value={r.toPostcode}
          editable={editable}
          onCommit={(v) => { patchLocal(r.id, { toPostcode: v }); void persist(r.id, { toPostcode: v }); }}
        />
      );
    case "days":
      return (
        <DaysCell
          dayIndex={r.dayIndex ?? null}
          dayCount={r.dayCount ?? null}
          editable={editable}
          onCommit={(idx, cnt) => {
            patchLocal(r.id, { dayIndex: idx ?? undefined, dayCount: cnt ?? undefined });
            void persist(r.id, { dayIndex: idx, dayCount: cnt });
          }}
        />
      );
    case "factory":
      return (
        <TextCell
          value={r.factory ?? ""}
          editable={editable}
          onCommit={(v) => { patchLocal(r.id, { factory: v || undefined }); void persist(r.id, { factory: v || null }); }}
        />
      );
    case "booking":
      return (
        <TextCell
          value={r.bookingTime ?? ""}
          editable={editable}
          onCommit={(v) => { patchLocal(r.id, { bookingTime: v || undefined }); void persist(r.id, { bookingTime: v || null }); }}
        />
      );
    case "vehicle":
      return (
        <SelectCell
          value={r.vehicle}
          options={vehicles}
          editable={editable}
          allowFree
          mono
          onCommit={(v) => { patchLocal(r.id, { vehicle: v }); void persist(r.id, { vehicle: v }); }}
        />
      );
    case "subby_driver":
      return (
        <TextCell
          value={r.subbyDriver ?? ""}
          editable={editable}
          onCommit={(v) => { patchLocal(r.id, { subbyDriver: v || undefined }); void persist(r.id, { subbyDriver: v || null }); }}
        />
      );
    case "subby_cost":
      return (
        <NumberCell
          value={r.subbyCost ?? 0}
          editable={editable}
          onCommit={(n) => { patchLocal(r.id, { subbyCost: n }); void persist(r.id, { subbyCost: n }); }}
        />
      );
    case "trailer_number":
      return (
        <SelectCell
          value={r.trailerNumber ?? ""}
          options={trailers}
          editable={editable}
          allowFree
          mono
          onCommit={(v) => { patchLocal(r.id, { trailerNumber: v || undefined }); void persist(r.id, { trailerNumber: v || null }); }}
        />
      );
    case "trailer_dropped":
      return (
        <CheckCell
          checked={r.trailerDropped ?? false}
          disabled={!editable}
          onChange={(v) => { patchLocal(r.id, { trailerDropped: v }); void persist(r.id, { trailerDropped: v }); }}
        />
      );
    case "reference":
      return (
        <TextCell
          value={r.loadRef ?? ""}
          editable={editable}
          mono
          onCommit={(v) => { patchLocal(r.id, { loadRef: v }); void persist(r.id, { loadRef: v }); }}
        />
      );
    case "customer":
      return (
        <SelectCell
          value={r.customer}
          options={customers}
          editable={editable}
          allowFree
          onCommit={(v) => { patchLocal(r.id, { customer: v }); void persist(r.id, { customer: v }); }}
        />
      );
    case "revenue":
      return (
        <NumberCell
          value={r.revenue ?? 0}
          editable={editable}
          onCommit={(n) => { patchLocal(r.id, { revenue: n }); void persist(r.id, { revenue: n }); }}
        />
      );
    case "bill":
      return (
        <CheckCell
          checked={r.billable ?? false}
          disabled={!editable}
          onChange={(v) => {
            patchLocal(r.id, { billable: v });
            void persist(r.id, {
              billable: v,
              invoiceStatus: v && (r.invoiceStatus ?? "open") === "open" ? "billable" : r.invoiceStatus,
            });
          }}
        />
      );
    case "status":
      return <td><StatusPill status={r.invoiceStatus ?? "open"} /></td>;
    default:
      return <td />;
  }
}

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
