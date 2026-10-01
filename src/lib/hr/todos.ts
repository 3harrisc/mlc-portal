/**
 * The HR to-do list across all drivers: what MLC needs to act on, most
 * serious first. Pure - shared by the dashboard and the fortnightly email.
 */
import { awaitingCountersign, driverDocumentViews } from "./status";
import { licenceFlags } from "./licence";
import type { HrAssignment, HrDocument, HrSignature } from "@/types/hr";
import { driverName, type DriverFileKind, type DriverRecord } from "@/types/hr-drivers";

export type TodoLevel = "danger" | "warn" | "info";

export interface HrTodo {
  level: TodoLevel;
  /** Driver name, or null for MLC-wide items. */
  who: string | null;
  message: string;
  href: string;
}

export interface TodoInputs {
  drivers: DriverRecord[];
  fileKinds: Record<string, DriverFileKind[]>;
  documents: HrDocument[];
  assignments: HrAssignment[];
  signatures: HrSignature[];
  logins: { id: string; email: string; fullName: string | null }[];
  now: Date;
}

const DAY = 86_400_000;
export const UNSIGNED_GRACE_DAYS = 7;
export const LICENCE_CHECK_STALE_DAYS = 180;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY);
}

const ORDER: Record<TodoLevel, number> = { danger: 0, warn: 1, info: 2 };

export function hrTodos(i: TodoInputs): HrTodo[] {
  const out: HrTodo[] = [];
  const published = i.documents.filter((d) => d.status === "published");
  const hasContractTemplate = published.some((d) => d.collectsParticulars);

  for (const d of i.drivers) {
    if (d.status === "left") continue;
    const who = driverName(d);
    const href = `/admin/hr/drivers/${d.id}`;
    const add = (level: TodoLevel, message: string, link = href) => out.push({ level, who, message, href: link });
    const kinds = i.fileKinds[d.id] ?? [];

    if (!kinds.includes("right_to_work")) add("danger", "No right-to-work evidence on file");

    if (!d.licence) add("warn", "No AssetGo licence check on file");
    else {
      for (const f of licenceFlags(d.licence, i.now)) add(f.level, f.message);
      const age = daysSince(d.licenceCheckedOn, i.now);
      if (age != null && age > LICENCE_CHECK_STALE_DAYS) {
        add("info", `Latest licence check in the portal is ${Math.floor(age / 30)} months old - upload the newest one from AssetGo`);
      }
    }

    const missing = [
      !d.startDate && "start date",
      !d.niNumber && "NI number",
      !d.phone && "phone",
      !(d.emergencyContactName && d.emergencyContactPhone) && "emergency contact",
    ].filter(Boolean);
    if (missing.length) add("info", `Missing details: ${missing.join(", ")}`);

    if (!d.profileId) {
      add("warn", "No portal login linked, so they can't sign documents");
      continue;
    }

    const views = driverDocumentViews(d.profileId, published, i.assignments, i.signatures, i.now);
    if (!views.some((v) => v.document.collectsParticulars) && hasContractTemplate) {
      add(d.status === "starter" ? "warn" : "info", "Contract not sent yet - use Send starter pack");
    }

    const overdue = views.filter((v) => v.status === "expired");
    if (overdue.length) add("danger", `Re-sign overdue: ${overdue.map((v) => v.document.title).join(", ")}`);

    const unsigned = views.filter((v) => v.status === "outstanding");
    if (unsigned.length) {
      // "Sent" is when MLC sent it to them, or when an all-drivers document was
      // published - but never before the driver started.
      const ages = unsigned.map((v) => {
        const sent = v.assignment?.assignedAt ?? [v.document.publishedAt, d.startDate].filter(Boolean).sort().at(-1);
        return daysSince(sent ?? null, i.now) ?? 0;
      });
      const oldest = Math.max(...ages);
      const titles = unsigned.map((v) => v.document.title).join(", ");
      add(
        oldest > UNSIGNED_GRACE_DAYS ? "warn" : "info",
        `${unsigned.length === 1 ? "Hasn't signed" : `Hasn't signed ${unsigned.length} documents:`} ${titles}${oldest > 0 ? ` (oldest ${oldest} days)` : ""}`,
      );
    }

    const dueSoon = views.filter((v) => v.status === "due_soon");
    if (dueSoon.length) add("info", `Re-sign due soon: ${dueSoon.map((v) => v.document.title).join(", ")}`);

    for (const v of views) {
      if (v.status !== "expired" && awaitingCountersign(v.document, v.lastSignature)) {
        add("warn", `Signed "${v.document.title}" - waiting for MLC to countersign`, "/admin/hr");
      }
    }
  }

  const linked = new Set(i.drivers.map((d) => d.profileId).filter(Boolean));
  for (const l of i.logins) {
    if (!linked.has(l.id)) {
      out.push({
        level: "warn",
        who: l.fullName || l.email,
        message: "Has a driver login but no driver record",
        href: "/admin/hr/drivers/new",
      });
    }
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level] || (a.who ?? "").localeCompare(b.who ?? ""));
}

export function todoCounts(todos: HrTodo[]): Record<TodoLevel, number> {
  return {
    danger: todos.filter((t) => t.level === "danger").length,
    warn: todos.filter((t) => t.level === "warn").length,
    info: todos.filter((t) => t.level === "info").length,
  };
}
