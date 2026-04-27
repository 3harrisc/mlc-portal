"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-device persistent column widths.
 *
 * Stores user-adjusted widths in localStorage keyed by the table identifier
 * the caller passes in (e.g. "planner-grid"). Defaults are baked in by the
 * caller, so a fresh device shows sensible widths until the operator drags
 * the column borders to taste.
 *
 * Why localStorage and not the database? Two reasons:
 *  - It's per-device. The operator's iPad has different available width than
 *    their dispatch monitor, and they want different layouts on each.
 *  - It's instant. Width changes happen on every drag tick; flooding the DB
 *    on each pixel of movement would be silly.
 */
export interface ColumnDef {
  /** Stable id used as the localStorage key field. */
  id: string;
  /** Width in CSS pixels used when no override is stored. */
  defaultWidth: number;
  /** Floor; the user can't drag below this. Defaults to 30. */
  minWidth?: number;
}

export interface UseResizableColumnsResult {
  /** Map of column id → current width in pixels. */
  widths: Readonly<Record<string, number>>;
  /** Set the width of one column (clamped to the column's minWidth). */
  setWidth: (id: string, width: number) => void;
  /** Restore every column to its default and clear localStorage. */
  reset: () => void;
  /** True once we've loaded any saved overrides — useful for SSR-safety. */
  hydrated: boolean;
}

const STORAGE_KEY_PREFIX = "mlc.resizable-cols.";

function readSaved(key: string): Record<string, number> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      // Filter to numeric values only.
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
  } catch {
    /* corrupt JSON; ignore */
  }
  return null;
}

export function useResizableColumns(
  key: string,
  columns: ReadonlyArray<ColumnDef>
): UseResizableColumnsResult {
  // SSR-safe initial state — start with defaults; load saved widths after hydration.
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const c of columns) initial[c.id] = c.defaultWidth;
    return initial;
  });
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once we're on the client.
  useEffect(() => {
    const saved = readSaved(key);
    if (saved) {
      setWidths((prev) => {
        const merged = { ...prev };
        for (const c of columns) {
          if (typeof saved[c.id] === "number") {
            merged[c.id] = Math.max(c.minWidth ?? 30, Math.round(saved[c.id]));
          }
        }
        return merged;
      });
    }
    setHydrated(true);
    // Intentionally only run once per key — defaults & columns shouldn't churn at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback(
    (next: Record<string, number>) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(next));
      } catch {
        /* quota / disabled storage; ignore */
      }
    },
    [key]
  );

  const setWidth = useCallback(
    (id: string, width: number) => {
      setWidths((prev) => {
        const col = columns.find((c) => c.id === id);
        if (!col) return prev;
        const clamped = Math.max(col.minWidth ?? 30, Math.round(width));
        if (prev[id] === clamped) return prev;
        const next = { ...prev, [id]: clamped };
        persist(next);
        return next;
      });
    },
    [columns, persist]
  );

  const reset = useCallback(() => {
    const fresh: Record<string, number> = {};
    for (const c of columns) fresh[c.id] = c.defaultWidth;
    setWidths(fresh);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY_PREFIX + key);
      } catch {
        /* ignore */
      }
    }
  }, [columns, key]);

  return { widths, setWidth, reset, hydrated };
}
