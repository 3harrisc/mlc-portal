"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Bottom-of-sidebar status indicator that surfaces what's actually deployed.
 *
 * Why this exists
 * ---------------
 * The placeholder "v4.2" badge was static and gave no information about
 * whether the live site reflected today's work. Now the badge shows the
 * short git SHA of the running build; clicking it pops a small panel with
 * the commit subject, branch, and how long ago the commit happened — so
 * the operator can tell at a glance whether a fix they're chasing has
 * landed yet.
 *
 * The values come from build-time env injection in next.config.ts (Vercel
 * `VERCEL_GIT_*` env vars in production, `git` CLI shell-out locally).
 * If no metadata is present (e.g. builds without a .git directory) we
 * fall back to the original "v4.2" string so nothing visibly breaks.
 */
export default function BuildBadge() {
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
  const subject = process.env.NEXT_PUBLIC_BUILD_SUBJECT ?? "";
  const branch = process.env.NEXT_PUBLIC_BUILD_BRANCH ?? "";
  const time = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
  const shortSha = sha.slice(0, 7);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the popover when clicking outside or pressing Escape — the same
  // dismiss pattern used by the rest of the sidebar dropdowns.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!shortSha) {
    // Build metadata wasn't injected — leave the static label in place.
    return <span className="mono">v4.2</span>;
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mono"
        title="Show deployed build info"
        style={{
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          font: "inherit",
        }}
      >
        v4.2 · {shortSha}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Build info"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            minWidth: 240,
            maxWidth: 320,
            padding: 10,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            fontSize: 11.5,
            zIndex: 50,
          }}
        >
          <div className="bold" style={{ marginBottom: 4 }}>
            Deployed build
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              wordBreak: "break-all",
              color: "var(--ink-500)",
              marginBottom: 6,
            }}
          >
            {sha}
          </div>
          {subject && (
            <div style={{ marginBottom: 6, lineHeight: 1.35 }}>{subject}</div>
          )}
          <div className="muted" style={{ fontSize: 10.5 }}>
            {branch && <span>{branch}</span>}
            {branch && time && <span> · </span>}
            {time && <span title={time}>{relativeTime(time)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** "5 min ago", "3 h ago", "2 d ago" — keeps the popover compact. */
function relativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
