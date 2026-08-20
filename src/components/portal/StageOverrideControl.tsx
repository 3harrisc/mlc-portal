"use client";

/**
 * Admin control for pinning a load's stage, plus the public note explaining
 * that it was pinned.
 *
 * The note renders for everyone, not just admins: a customer seeing
 * "Delivered" while the map shows a moving lorry otherwise has no
 * explanation, and neither will the operator reading the row in three weeks.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ALL_STATUSES,
  STATUS_LABEL,
  type LoadStatus,
} from "@/lib/portal/status";

export default function StageOverrideControl({
  override,
  overrideBy,
  overrideAt,
  derived,
  isAdmin,
  saving,
  onChange,
}: {
  override: LoadStatus | null;
  overrideBy?: string;
  overrideAt?: string;
  /** What the status WOULD be with no override — shown in the Auto option. */
  derived: LoadStatus;
  isAdmin: boolean;
  saving: boolean;
  onChange: (next: LoadStatus | null) => void;
}) {
  // Resolved name, tagged with the id it was resolved for. Keeping the id
  // alongside means a stale result from a previous override can't leak onto
  // a new one — we simply don't render a name we didn't fetch for this id.
  const [resolved, setResolved] = useState<{
    id: string;
    name: string | null;
  } | null>(null);

  // Resolve the setter's name. RLS may hide the row from a customer, and the
  // user may have been deleted — either way we degrade to no name rather
  // than rendering a raw uuid.
  useEffect(() => {
    if (!overrideBy) return;
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("id", overrideBy)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setResolved({ id: overrideBy, name: data?.full_name ?? null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [overrideBy]);

  const byName =
    resolved && resolved.id === overrideBy ? resolved.name : null;

  const stamp = overrideAt
    ? new Date(overrideAt).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // Customers with no override to explain get nothing at all.
  if (!isAdmin && !override) return null;

  return (
    <div style={{ display: "grid", gap: 3, justifyItems: "start" }}>
      {isAdmin && (
        <select
          value={override ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? (e.target.value as LoadStatus) : null)
          }
          disabled={saving}
          aria-label="Stage"
          className="input"
          style={{ height: 26, fontSize: 11.5, width: "auto" }}
        >
          <option value="">Auto ({STATUS_LABEL[derived]})</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      )}
      {override && (
        <span className="muted" style={{ fontSize: 11 }}>
          Stage set manually
          {byName ? ` by ${byName}` : ""}
          {stamp ? ` at ${stamp}` : ""}
          {isAdmin && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={saving}
                className="btn sm ghost"
                style={{ padding: "0 4px", height: "auto" }}
              >
                Revert to auto
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
}
