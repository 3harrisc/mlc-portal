"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PlannedRun } from "@/types/runs";
import { useNicknames } from "@/hooks/useNicknames";
import { todayISO } from "@/lib/time-utils";
import { usePortalData } from "@/components/portal/PortalDataContext";
import { useAuth } from "@/components/AuthProvider";
import { withNickname } from "@/lib/postcode-nicknames";
import { copyLoadToPlanner, deleteLoads, setLoadVehicle } from "@/app/actions/loads";
import { listVehicles } from "@/app/actions/fleet";
import Icon from "@/components/portal/Icon";
import StatusPill, {
  STATUS_LABEL,
  type LoadStatus,
} from "@/components/portal/StatusPill";
import { usePortalSearch } from "@/components/portal/PortalSearchContext";
import { useToast } from "@/components/portal/ToastContext";
import {
  matchesSearch,
  progressTuple,
  shortDate,
} from "@/lib/portal/loads";
import {
  chainedEta,
  computeLoadChains,
  type ChainedInfo,
} from "@/lib/portal/load-chains";

type StatusFilter = "all" | LoadStatus;
type SortKey = "date" | "customer" | "vehicle" | "id" | "eta" | "status";
type SortDir = "asc" | "desc";

interface LoadRow {
  run: PlannedRun;
  status: LoadStatus;
  fromName: string;
  toName: string;
  eta: string;
  progress: { completed: number; total: number };
  /** Set when this load is leg 2+ of a stacked vehicle/date group. */
  chained?: ChainedInfo;
}

const PAGE_SIZE = 12;
const STATUSES: StatusFilter[] = [
  "all",
  "in-transit",
  "loading",
  "delivered",
  "scheduled",
  "delayed",
  "exception",
];

export default function LoadsPage() {
  const { enriched: enrichedAll, loading, refetch } = usePortalData();
  const { query } = usePortalSearch();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const nicknames = useNicknames();
  const { showToast } = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [customerFilter, setCustomerFilter] = useState<"all" | string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Canonical fleet list — populates the vehicle datalist on each row so
  // the operator can pick a registration without typing the full code.
  const [fleetVehicles, setFleetVehicles] = useState<string[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    listVehicles().then((res) => {
      if (cancelled) return;
      setFleetVehicles((res.vehicles ?? []).filter((v) => v.active).map((v) => v.id));
    });
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Local optimistic vehicle overrides — show the new value immediately
  // while the server refresh catches up. PortalData's reload eventually
  // wipes this when the canonical version comes back.
  const [vehicleOverrides, setVehicleOverrides] = useState<Record<string, string>>({});

  async function handleSetVehicle(runId: string, raw: string) {
    const trimmed = raw.trim().toUpperCase();
    setVehicleOverrides((curr) => ({ ...curr, [runId]: trimmed }));
    const res = await setLoadVehicle(runId, trimmed);
    if (res.error) {
      // Roll back the optimistic override on failure.
      setVehicleOverrides((curr) => {
        const next = { ...curr };
        delete next[runId];
        return next;
      });
      alert(`Failed to set vehicle: ${res.error}`);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} load${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError("");
    const ids = Array.from(selected);
    const res = await deleteLoads(ids);
    setDeleting(false);
    if (res.error) {
      setDeleteError(res.error);
      return;
    }
    // Reset the view so the operator lands back at "All customers / All
    // statuses / page 1" instead of staying on a now-empty filtered slice.
    setSelected(new Set());
    setStatusFilter("all");
    setCustomerFilter("all");
    setPage(1);
    // Re-fetch instead of full page reload — keeps scroll position, sidebar
    // state, etc. intact while the deleted rows disappear from the table.
    refetch();
  }

  // Tracks which load rows are mid-promotion so we can show a spinner /
  // disable the button while the server action is in flight.
  const [copying, setCopying] = useState<Set<string>>(new Set());

  /**
   * Promote a customer load into the dispatch planner. The load itself is
   * preserved on /portal/loads (the customer keeps their tracking view); a
   * matching `runs` row is created so dispatch can manage it from the
   * planner. They're independent records — same physical journey, two
   * perspectives — until cross-table linking via load_ref ships.
   */
  async function handleCopyToPlanner(loadId: string) {
    if (copying.has(loadId)) return;
    setCopying((curr) => {
      const next = new Set(curr);
      next.add(loadId);
      return next;
    });
    const res = await copyLoadToPlanner(loadId);
    setCopying((curr) => {
      const next = new Set(curr);
      next.delete(loadId);
      return next;
    });
    if (res.error) {
      showToast(`Couldn't copy to planner: ${res.error}`, "err");
      return;
    }
    showToast(
      `Copied to planner${res.jobNumber ? ` as ${res.jobNumber}` : ""}.`,
    );
  }

  // Chained-start map: vehicle+date groups with >1 load get computed chain
  // starts so leg 2's start time / ETA reflects leg 1's finish + travel,
  // matching the dispatch planner's stacked-runs handling.
  const chains = useMemo(
    () => computeLoadChains(enrichedAll.map((e) => e.run)),
    [enrichedAll],
  );

  const enriched: LoadRow[] = useMemo(
    () =>
      enrichedAll.map(({ run, status }) => {
        const chained = chains.get(run.id);
        return {
          run,
          status,
          fromName: withNickname(run.fromPostcode, nicknames),
          toName: withNickname(run.toPostcode, nicknames),
          eta: chainedEta(run, chained),
          progress: progressTuple(run),
          chained,
        };
      }),
    [enrichedAll, nicknames, chains],
  );

  const customers = useMemo(() => {
    const set = new Set<string>();
    enriched.forEach((r) => set.add(r.run.customer));
    return Array.from(set).filter(Boolean).sort();
  }, [enriched]);

  const counts: Record<StatusFilter, number> = useMemo(() => {
    const acc: Record<StatusFilter, number> = {
      all: enriched.length,
      "in-transit": 0,
      loading: 0,
      delivered: 0,
      scheduled: 0,
      delayed: 0,
      exception: 0,
    };
    for (const r of enriched) acc[r.status] += 1;
    return acc;
  }, [enriched]);

  const filtered = useMemo(() => {
    let r = enriched;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    if (customerFilter !== "all")
      r = r.filter((x) => x.run.customer === customerFilter);
    if (query) r = r.filter((x) => matchesSearch(x.run, query));

    const sorted = [...r].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [enriched, statusFilter, customerFilter, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  // Filters reset the page index in their click handlers; the search input
  // does so via a derived key effect-free in render. We clamp safePage above.

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.run.id));
  const someVisibleSelected = visible.some((r) => selected.has(r.run.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visible.forEach((r) => next.delete(r.run.id));
      } else {
        visible.forEach((r) => next.add(r.run.id));
      }
      return next;
    });
  };

  const setSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Loads</h1>
          <div className="page-subtitle">
            All consignments across your account · last 90 days
          </div>
        </div>
        <div className="row gap-8">
          {selected.size > 0 && (
            <div className="row gap-8" style={{ marginRight: 8 }}>
              <span className="muted mono" style={{ fontSize: 11.5 }}>
                {selected.size} selected
              </span>
              <button className="btn sm" type="button">
                <Icon name="download" size={12} /> Export
              </button>
              <button className="btn sm" type="button">
                <Icon name="doc" size={12} /> PODs
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={deleting}
                  onClick={() => void handleBulkDelete()}
                  title="Permanently delete selected loads"
                >
                  <Icon name="x" size={12} /> {deleting ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
          )}
          <button className="btn" type="button">
            <Icon name="filter" size={13} /> Saved filters
          </button>
          <button className="btn" type="button">
            <Icon name="download" size={13} /> Export CSV
          </button>
          <Link
            href={`/portal/loads/day/${todayISO()}`}
            className="btn"
            title="See loads grouped by vehicle for a single day"
          >
            <Icon name="cal" size={13} /> Day view
          </Link>
          <Link href="/portal/bookings" className="btn primary">
            <Icon name="plus" size={13} /> Book a collection
          </Link>
        </div>
      </div>

      {deleteError && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--err)", background: "var(--err-bg)" }}>
          <div className="card-body" style={{ color: "var(--err)", fontSize: 12.5 }}>
            {deleteError}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-toolbar">
          <div className="seg">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={statusFilter === s ? "active" : ""}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
              >
                {s === "all" ? "All" : STATUS_LABEL[s]}
                <span
                  className="mono"
                  style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}
                >
                  {counts[s]}
                </span>
              </button>
            ))}
          </div>

          <span className="filter-chip">
            <Icon name="cal" size={11} /> Last 90 days
            <Icon name="chevD" size={10} className="x" />
          </span>

          <span
            className={`filter-chip ${customerFilter !== "all" ? "active" : ""}`}
          >
            <Icon name="user" size={11} />
            <select
              value={customerFilter}
              onChange={(e) => {
                setCustomerFilter(e.target.value);
                setPage(1);
              }}
              style={{
                border: 0,
                background: "transparent",
                outline: 0,
                fontSize: 11.5,
                padding: 0,
                color: "inherit",
              }}
              aria-label="Customer filter"
            >
              <option value="all">All customers</option>
              {customers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {customerFilter !== "all" && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear customer filter"
                onClick={() => {
                  setCustomerFilter("all");
                  setPage(1);
                }}
                style={{ display: "inline-flex", cursor: "pointer" }}
              >
                <Icon name="x" size={10} className="x" />
              </span>
            )}
          </span>

          <div className="spacer" />

          <button className="btn sm ghost" type="button">
            <Icon name="settings" size={12} />
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <span
                    className={`cb ${
                      allVisibleSelected
                        ? "checked"
                        : someVisibleSelected
                          ? "indet"
                          : ""
                    }`}
                    onClick={toggleAll}
                    role="checkbox"
                    aria-checked={allVisibleSelected}
                    tabIndex={0}
                  >
                    {allVisibleSelected && (
                      <Icon name="check" size={9} strokeWidth={3} />
                    )}
                    {someVisibleSelected && !allVisibleSelected && (
                      <span
                        style={{
                          width: 8,
                          height: 2,
                          background: "#fff",
                          display: "block",
                        }}
                      />
                    )}
                  </span>
                </th>
                <SortHeader
                  k="id"
                  label="Load"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                />
                <SortHeader
                  k="customer"
                  label="Customer"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                />
                <th>Route</th>
                <SortHeader
                  k="date"
                  label="Date"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                />
                <SortHeader
                  k="vehicle"
                  label="Vehicle / Driver"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                />
                <th>Progress</th>
                <SortHeader
                  k="eta"
                  label="ETA"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                />
                <SortHeader
                  k="status"
                  label="Status"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                />
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <LoadTableRow
                  key={row.run.id}
                  row={row}
                  selected={selected.has(row.run.id)}
                  onToggle={toggleSel}
                  isAdmin={isAdmin}
                  fleetVehicles={fleetVehicles}
                  vehicleOverride={vehicleOverrides[row.run.id]}
                  onSetVehicle={handleSetVehicle}
                  onCopyToPlanner={handleCopyToPlanner}
                  copying={copying.has(row.run.id)}
                />
              ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "var(--ink-500)",
                    }}
                  >
                    No loads match these filters.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td
                    colSpan={11}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "var(--ink-500)",
                    }}
                  >
                    Loading loads…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <span>
            Showing{" "}
            <span className="bold">
              {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
              –{Math.min(safePage * PAGE_SIZE, filtered.length)}
            </span>{" "}
            of <span className="bold">{filtered.length}</span>
          </span>
          <div className="pages">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage === 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  type="button"
                  className={safePage === p ? "active" : ""}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount, safePage + 1))}
              disabled={safePage === pageCount}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function sortValue(row: LoadRow, key: SortKey): string | number {
  switch (key) {
    case "date":
      return row.run.date;
    case "customer":
      return row.run.customer;
    case "vehicle":
      return row.run.vehicle;
    case "id":
      return row.run.jobNumber;
    case "eta":
      return row.eta;
    case "status":
      return row.status;
  }
}

function SortHeader({
  k,
  label,
  sortKey,
  sortDir,
  onSort,
}: {
  k: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className="sortable" onClick={() => onSort(k)}>
      {label}
      {sortKey === k && (
        <span className="sort-arrow">{sortDir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );
}

function LoadTableRow({
  row,
  selected,
  onToggle,
  isAdmin,
  fleetVehicles,
  vehicleOverride,
  onSetVehicle,
  onCopyToPlanner,
  copying,
}: {
  row: LoadRow;
  selected: boolean;
  onToggle: (id: string) => void;
  isAdmin: boolean;
  fleetVehicles: ReadonlyArray<string>;
  vehicleOverride?: string;
  onSetVehicle: (runId: string, vehicle: string) => Promise<void>;
  onCopyToPlanner: (id: string) => Promise<void>;
  copying: boolean;
}) {
  const { run, status, fromName, toName, eta, progress } = row;
  // Use local override if present (shows immediately after admin edit), else canonical.
  const currentVehicle = vehicleOverride ?? run.vehicle ?? "";
  const stopsExtra = progress.total - 2;
  const progressColor =
    status === "exception"
      ? "var(--err)"
      : status === "delayed"
        ? "var(--warn)"
        : status === "delivered"
          ? "var(--ok)"
          : "var(--mlc-blue)";
  const progressPct = progress.total
    ? (progress.completed / progress.total) * 100
    : 0;

  return (
    <tr className={selected ? "selected" : ""}>
      <td
        onClick={(e) => {
          e.stopPropagation();
          onToggle(run.id);
        }}
      >
        <span className={`cb ${selected ? "checked" : ""}`} role="checkbox" aria-checked={selected}>
          {selected && <Icon name="check" size={9} strokeWidth={3} />}
        </span>
      </td>
      <RowLink id={run.id}>
        <div className="bold mono" style={{ fontSize: 12 }}>
          {run.jobNumber || run.id}
        </div>
        <div className="muted mono" style={{ fontSize: 10.5 }}>
          {run.loadRef || "—"}
        </div>
      </RowLink>
      <RowLink id={run.id}>
        <div style={{ fontSize: 12.5 }}>{run.customer}</div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {run.runType === "backload" ? "Backload" : "Delivery"}
        </div>
      </RowLink>
      <RowLink id={run.id}>
        <div className="row gap-4" style={{ fontSize: 11.5 }}>
          <span className="mono">{run.fromPostcode}</span>
          <Icon name="arrowR" size={10} className="muted" />
          <span className="mono">{run.toPostcode || "—"}</span>
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {fromName} → {toName}
          {stopsExtra > 0 && (
            <span>
              {" "}
              · +{stopsExtra} stop{stopsExtra === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </RowLink>
      <RowLink id={run.id}>
        <div className="mono tnum" style={{ fontSize: 11.5 }}>
          {shortDate(run.date)}
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {row.chained ? (
            <>
              <span className="mono">{row.chained.chainedStartTime}</span>
              <span style={{ marginLeft: 4, fontSize: 9.5, opacity: 0.75 }}>
                · chained
              </span>
            </>
          ) : (
            <span className="mono">{run.startTime}</span>
          )}
        </div>
      </RowLink>
      {isAdmin ? (
        // Admin: inline-edit so the operator can assign a registration here
        // (which immediately enables customer-side tracking).
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            list={`fleet-${run.id}`}
            defaultValue={currentVehicle}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v.toUpperCase() !== currentVehicle.toUpperCase()) {
                void onSetVehicle(run.id, v);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).value = currentVehicle;
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Pick reg…"
            className="input mono"
            style={{
              height: 26,
              padding: "0 8px",
              fontSize: 11.5,
              fontWeight: 700,
              textTransform: "uppercase",
              width: "100%",
            }}
          />
          <datalist id={`fleet-${run.id}`}>
            {fleetVehicles.map((v) => <option key={v} value={v} />)}
          </datalist>
        </td>
      ) : (
        <RowLink id={run.id}>
          <div className="mono bold" style={{ fontSize: 11.5 }}>
            {currentVehicle || "—"}
          </div>
          <div className="muted" style={{ fontSize: 10.5 }}>
            {currentVehicle ? "Tractor unit" : "Awaiting reg"}
          </div>
        </RowLink>
      )}
      <RowLink id={run.id} style={{ minWidth: 110 }}>
        <div className="mono tnum" style={{ fontSize: 11 }}>
          {progress.completed}/{progress.total} stops
        </div>
        <div
          style={{
            marginTop: 4,
            height: 4,
            background: "var(--line)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              background: progressColor,
            }}
          />
        </div>
      </RowLink>
      <RowLink id={run.id}>
        <div className="mono tnum" style={{ fontSize: 11.5 }}>
          {status === "delivered" ? "—" : eta}
        </div>
      </RowLink>
      <RowLink id={run.id}>
        <StatusPill status={status} />
      </RowLink>
      {isAdmin ? (
        // Admin-only "Copy to planner": promotes this customer load into the
        // dispatch `runs` table without removing it from /portal/loads, so
        // dispatch and the customer can both see what they need.
        <td onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="btn sm ghost"
            disabled={copying}
            onClick={() => void onCopyToPlanner(run.id)}
            title="Copy this load to the dispatch planner"
            style={{ whiteSpace: "nowrap", fontSize: 11 }}
          >
            <Icon name="arrowR" size={11} /> {copying ? "Copying…" : "To planner"}
          </button>
        </td>
      ) : (
        <td />
      )}
      <RowLink id={run.id}>
        <Icon name="chevR" size={14} className="muted" />
      </RowLink>
    </tr>
  );
}

function RowLink({
  id,
  children,
  style,
}: {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td style={style}>
      <Link
        href={`/portal/loads/${id}`}
        style={{
          color: "inherit",
          textDecoration: "none",
          display: "block",
        }}
      >
        {children}
      </Link>
    </td>
  );
}
