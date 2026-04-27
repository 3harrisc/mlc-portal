"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Per-device persistent column preferences: width AND order.
 *
 * Stores both in a single localStorage entry keyed by a table id (e.g.
 * "planner-grid"). The operator can drag column edges to resize and drag
 * column headers to reorder; both stick across reloads on the same device.
 *
 * Why a single entry? Because resize and reorder happen often and we want
 * to flush both atomically. Why localStorage? Because layout is genuinely
 * per-device — the operator's iPad and dispatch monitor have different
 * available widths and they want different layouts on each.
 */
export interface ColumnDef {
  /** Stable id used as the key in widths/order. */
  id: string;
  /** Default width in pixels, used when no override is stored. */
  defaultWidth: number;
  /** Minimum width the user can drag down to. Defaults to 30. */
  minWidth?: number;
}

interface SavedPrefs {
  widths?: Record<string, number>;
  order?: string[];
}

export interface UseColumnPrefsResult {
  /** Map of column id → current width in pixels. */
  widths: Readonly<Record<string, number>>;
  /** Current display order — array of column ids. */
  order: ReadonlyArray<string>;
  /** Drag-resize one column. */
  setWidth: (id: string, width: number) => void;
  /** Move `dragId` to the slot currently occupied by `overId`. */
  reorder: (dragId: string, overId: string) => void;
  /** Restore both widths and order to the defaults from `columns`. */
  reset: () => void;
  /** True once we've loaded any saved overrides from localStorage. */
  hydrated: boolean;
}

const STORAGE_KEY_PREFIX = "mlc.column-prefs.v1.";

function readSaved(key: string): SavedPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as SavedPrefs;
  } catch {
    /* corrupt JSON; ignore */
  }
  return null;
}

export function useColumnPrefs(
  key: string,
  columns: ReadonlyArray<ColumnDef>
): UseColumnPrefsResult {
  // Defaults from the columns array — id-keyed for widths, ordered for the layout.
  const defaults = useMemo(() => {
    const w: Record<string, number> = {};
    const o: string[] = [];
    for (const c of columns) {
      w[c.id] = c.defaultWidth;
      o.push(c.id);
    }
    return { widths: w, order: o };
  }, [columns]);

  // Single state blob so width/order updates are atomic vs persistence.
  const [prefs, setPrefs] = useState<{ widths: Record<string, number>; order: string[] }>(
    () => defaults
  );
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on first mount; survives stale entries by
  // ignoring any ids the registry no longer knows about and appending any
  // new ids at the end.
  useEffect(() => {
    if (typeof window === "undefined") {
      setHydrated(true);
      return;
    }
    const saved = readSaved(key);
    if (saved) {
      setPrefs((prev) => {
        let nextWidths = prev.widths;
        let nextOrder = prev.order;

        if (saved.widths) {
          nextWidths = { ...defaults.widths };
          for (const c of columns) {
            const v = saved.widths[c.id];
            if (typeof v === "number" && Number.isFinite(v)) {
              nextWidths[c.id] = Math.max(c.minWidth ?? 30, Math.round(v));
            }
          }
        }

        if (Array.isArray(saved.order)) {
          const known = new Set(columns.map((c) => c.id));
          const filtered = saved.order.filter((id) => typeof id === "string" && known.has(id));
          for (const c of columns) if (!filtered.includes(c.id)) filtered.push(c.id);
          nextOrder = filtered;
        }

        return { widths: nextWidths, order: nextOrder };
      });
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback(
    (next: { widths: Record<string, number>; order: string[] }) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(next));
      } catch {
        /* quota / disabled storage */
      }
    },
    [key]
  );

  const setWidth = useCallback(
    (id: string, width: number) => {
      setPrefs((prev) => {
        const col = columns.find((c) => c.id === id);
        if (!col) return prev;
        const clamped = Math.max(col.minWidth ?? 30, Math.round(width));
        if (prev.widths[id] === clamped) return prev;
        const next = { widths: { ...prev.widths, [id]: clamped }, order: prev.order };
        persist(next);
        return next;
      });
    },
    [columns, persist]
  );

  const reorder = useCallback(
    (dragId: string, overId: string) => {
      if (dragId === overId) return;
      setPrefs((prev) => {
        const from = prev.order.indexOf(dragId);
        const to = prev.order.indexOf(overId);
        if (from < 0 || to < 0) return prev;
        const newOrder = [...prev.order];
        newOrder.splice(from, 1);
        newOrder.splice(to, 0, dragId);
        const next = { widths: prev.widths, order: newOrder };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const reset = useCallback(() => {
    setPrefs({ widths: { ...defaults.widths }, order: [...defaults.order] });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY_PREFIX + key);
      } catch {
        /* ignore */
      }
    }
  }, [defaults, key]);

  return {
    widths: prefs.widths,
    order: prefs.order,
    setWidth,
    reorder,
    reset,
    hydrated,
  };
}
