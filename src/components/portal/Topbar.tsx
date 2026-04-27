"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef } from "react";
import Icon from "./Icon";
import { usePortalSearch } from "./PortalSearchContext";

const CRUMB_MAP: Record<string, string[]> = {
  "/portal": ["Dashboard"],
  "/portal/loads": ["Operations", "Loads"],
  "/portal/tracking": ["Operations", "Live tracking"],
  "/portal/documents": ["Operations", "Documents"],
  "/portal/bookings": ["Operations", "Book a collection"],
  "/portal/reports": ["Reports"],
  "/portal/settings": ["Account", "Users"],
  "/portal/help": ["Account", "Help"],
};

function crumbsFor(pathname: string): string[] {
  if (CRUMB_MAP[pathname]) return CRUMB_MAP[pathname];
  if (pathname.startsWith("/portal/loads/")) {
    const id = pathname.split("/").pop() ?? "";
    return ["Operations", "Loads", id];
  }
  return ["Dashboard"];
}

export default function Topbar() {
  const pathname = usePathname() ?? "/portal";
  const crumbs = useMemo(() => crumbsFor(pathname), [pathname]);
  const searchRef = useRef<HTMLInputElement>(null);
  const { query, setQuery } = usePortalSearch();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={`${i}-${c}`}>
            {i > 0 && <Icon name="chevR" size={12} className="sep" />}
            <span className={i === crumbs.length - 1 ? "current" : ""}>{c}</span>
          </Fragment>
        ))}
      </div>
      <div className="topbar-search">
        <Icon name="search" size={14} className="icon" />
        <input
          ref={searchRef}
          placeholder="Search loads, refs, postcodes…"
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="kbd">⌘K</span>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" type="button" title="Refresh">
          <Icon name="refresh" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Notifications">
          <Icon name="bell" size={15} />
          <span className="dot" />
        </button>
        <Link href="/portal/bookings" className="btn primary">
          <Icon name="plus" size={13} /> New booking
        </Link>
      </div>
    </header>
  );
}
