/**
 * Domain types for the Xero invoicing module (migration 008).
 *
 * `CustomerXeroMap` mirrors the spreadsheet's XeroMap sheet but adds a few
 * extras (email, branding theme) the legacy CSV-export macro didn't support.
 */

export interface CustomerXeroMap {
  id: string;
  /** Name as it appears on the run row (planner-side). */
  plannerName: string;
  /** ContactName Xero expects. Falls back to `plannerName` when null. */
  xeroContactName?: string;
  accountCode: string;       // default '200'
  taxType: string;           // default 'OUTPUT2'
  /** Days after end-of-invoice-month before payment is due. */
  dueDays: number;
  emailAddress?: string;
  brandingTheme?: string;
  notes?: string;
}

export interface Trailer {
  id: string;                // e.g. 'MLC014'
  description: string;
  active: boolean;
}

export interface Vehicle {
  id: string;                // e.g. 'C12MLC'
  description: string;
  active: boolean;
  sortOrder: number;
}

export interface Depot {
  id: string;                // slug, e.g. 'hq'
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
}

/** Row shape used by the Xero CSV grouper / writer. */
export interface InvoiceableRun {
  id: string;
  date: string;              // YYYY-MM-DD
  customer: string;          // planner-side name
  loadRef: string;
  description: string;       // pre-prefix description (we add the date)
  amount: number;            // £ revenue
}

export type XeroCsvLayout = "lite" | "template";

export interface XeroExportConfig {
  layout: XeroCsvLayout;
  invoicePrefix: string;     // 'INV-'
  defaultAccountCode: string;
  defaultTaxType: string;
  /** Customer planner-name match for which we never combine lines. */
  noGroupingCustomers: ReadonlyArray<string>;
}

export const DEFAULT_XERO_CONFIG: XeroExportConfig = {
  layout: "template",
  invoicePrefix: "INV-",
  defaultAccountCode: "200",
  defaultTaxType: "OUTPUT2",
  noGroupingCustomers: ["ashwood"],
};

/** A grouped invoice ready to be written to a CSV row group. */
export interface InvoiceGroup {
  /** Stable key used to dedupe / debug; see lib/xero/group-runs.ts. */
  key: string;
  customer: string;          // planner name
  /** Latest line date in the group — used as the InvoiceDate. */
  invoiceDate: string;       // YYYY-MM-DD
  isoWeek: number;
  isoYear: number;
  lines: ReadonlyArray<InvoiceableRun>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToCustomerXeroMap(row: any): CustomerXeroMap {
  return {
    id: row.id,
    plannerName: row.planner_name,
    xeroContactName: row.xero_contact_name ?? undefined,
    accountCode: row.account_code ?? "200",
    taxType: row.tax_type ?? "OUTPUT2",
    dueDays: row.due_days ?? 30,
    emailAddress: row.email_address ?? undefined,
    brandingTheme: row.branding_theme ?? undefined,
    notes: row.notes ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToTrailer(row: any): Trailer {
  return {
    id: row.id,
    description: row.description ?? "",
    active: row.active ?? true,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToVehicle(row: any): Vehicle {
  return {
    id: row.id,
    description: row.description ?? "",
    active: row.active ?? true,
    sortOrder: Number(row.sort_order ?? 100),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToDepot(row: any): Depot {
  return {
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusM: Number(row.radius_m ?? 200),
  };
}
