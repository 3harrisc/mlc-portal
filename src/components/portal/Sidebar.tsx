"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import BrandMark from "./BrandMark";
import Icon, { type IconName } from "./Icon";
import { usePortalData } from "./PortalDataContext";

interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  matchPrefixes?: string[];
}

const OPERATIONS: NavItem[] = [
  { href: "/portal", icon: "dashboard", label: "Dashboard" },
  { href: "/portal/loads", icon: "truck", label: "Loads", matchPrefixes: ["/portal/loads"] },
  { href: "/portal/tracking", icon: "map", label: "Live tracking" },
  { href: "/portal/documents", icon: "doc", label: "Documents" },
  { href: "/portal/bookings", icon: "plus", label: "Book a collection" },
  { href: "/portal/reports", icon: "chart", label: "Reports" },
];

const ACCOUNT: NavItem[] = [
  { href: "/portal/settings", icon: "settings", label: "Account & users" },
  { href: "/portal/help", icon: "help", label: "Help & contact" },
];

// Admin/dispatch routes — the new ones live inside the portal shell, the
// older ones still bounce out to the dark dispatch shell.
const DISPATCH: NavItem[] = [
  { href: "/portal/planner", icon: "list", label: "Planner", matchPrefixes: ["/portal/planner"] },
  { href: "/portal/figures", icon: "chart", label: "Figures", matchPrefixes: ["/portal/figures"] },
  { href: "/portal/invoicing", icon: "doc", label: "Invoicing", matchPrefixes: ["/portal/invoicing"] },
  { href: "/portal/plan", icon: "map", label: "Plan a route" },
  { href: "/runs", icon: "truck", label: "Dispatch runs" },
];

// Reference data admin — only useful for admins, kept compact.
const ADMIN: NavItem[] = [
  { href: "/admin/customers", icon: "user", label: "Customers" },
  { href: "/admin/xero-map", icon: "doc", label: "Xero map" },
  { href: "/admin/vehicles", icon: "truck", label: "Vehicles" },
  { href: "/admin/trailers", icon: "box", label: "Trailers" },
  { href: "/admin/depots", icon: "pin", label: "Depots" },
  { href: "/admin/drivers", icon: "user", label: "Drivers" },
  { href: "/admin/users", icon: "settings", label: "Admin users" },
];

const DRIVER: NavItem[] = [
  { href: "/driver", icon: "truck", label: "Driver mode" },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefixes?.some((p) => pathname.startsWith(p))) return true;
  return pathname === item.href;
}

function initials(name: string | null | undefined): string {
  if (!name) return "··";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "··";
}

export default function Sidebar() {
  const pathname = usePathname() ?? "/portal";
  const { profile } = useAuth();
  const { counts, loading: dataLoading } = usePortalData();

  const accountName =
    profile?.allowed_customers?.[0] ?? profile?.full_name ?? "Customer";
  const accountRole =
    profile?.role === "customer"
      ? "Customer portal"
      : profile?.role
        ? `${profile.role[0]?.toUpperCase()}${profile.role.slice(1)}`
        : "Portal";

  const renderItem = (item: NavItem) => {
    const active = isActive(pathname, item);
    const count = dataLoading
      ? undefined
      : item.label === "Loads"
        ? counts.loads
        : item.label === "Live tracking"
          ? counts.tracking
          : undefined;
    const alert =
      item.label === "Live tracking" && counts.exceptions > 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-item ${active ? "active" : ""}`}
      >
        <Icon name={item.icon} size={16} className="nav-icon" />
        <span>{item.label}</span>
        {count != null && (
          <span className={`nav-count ${alert ? "alert" : ""}`}>{count}</span>
        )}
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BrandMark />
        <div className="brand-text">
          <div className="name">MLC TRANSPORT</div>
          <div className="sub">Customer Portal</div>
        </div>
      </div>

      <Link href="/portal/settings" className="sidebar-account">
        <div className="acct-avatar">{initials(accountName)}</div>
        <div className="acct-meta">
          <div className="acct-name">{accountName}</div>
          <div className="acct-role">{accountRole}</div>
        </div>
        <Icon name="chevD" size={14} className="acct-caret" />
      </Link>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Operations</div>
        {OPERATIONS.map(renderItem)}
        <div className="nav-section-label">Account</div>
        {ACCOUNT.map(renderItem)}
        {profile?.role === "admin" && (
          <>
            <div className="nav-section-label">Dispatch</div>
            {DISPATCH.map(renderItem)}
            <div className="nav-section-label">Admin</div>
            {ADMIN.map(renderItem)}
          </>
        )}
        {profile?.role === "driver" && (
          <>
            <div className="nav-section-label">Driver</div>
            {DRIVER.map(renderItem)}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <span>
          <span className="status-dot" />
          All systems normal
        </span>
        <span className="mono">v4.2</span>
      </div>
    </aside>
  );
}
