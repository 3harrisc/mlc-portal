export type CustomerKey = string;

export type Customer = {
  id: string;
  name: string;
  base_postcode: string;
  open_time: string;
  close_time: string;
};

export type RunType = "regular" | "backload";

/**
 * Invoice lifecycle.
 *  - 'open'      : not yet flagged for billing
 *  - 'billable'  : flagged for billing but not yet exported
 *  - 'sent'      : included in a Xero CSV export
 *  - 'paid'      : marked paid (set manually or by future Xero webhook)
 *  - 'cancelled' : will not be billed
 */
export type InvoiceStatus = "open" | "billable" | "sent" | "paid" | "cancelled";

export type PlannedRun = {
  id: string;
  jobNumber: string;
  loadRef: string;
  date: string; // YYYY-MM-DD
  customer: CustomerKey;
  vehicle: string;
  fromPostcode: string;
  toPostcode: string;
  returnToBase: boolean;
  startTime: string; // HH:MM
  serviceMins: number;
  includeBreaks: boolean;
  rawText: string; // pasted lines
  completedStopIndexes?: number[];
  completedMeta?: Record<number, { atISO?: string; by: "auto" | "admin" | "driver"; arrivedISO?: string }>;
  progress?: ProgressState;
  createdBy?: string;
  runType: RunType;
  runOrder: number | null;
  collectionTime?: string; // HH:MM booking time at collection (backloads)
  collectionDate?: string; // YYYY-MM-DD if collection is on a different day to delivery
  // Planner-extension fields (migration 008). All optional so legacy rows keep working.
  factory?: string;
  bookingTime?: string;
  subbyDriver?: string;
  subbyCost?: number;
  trailerNumber?: string;
  trailerDropped?: boolean;
  reference?: string;
  // Multi-day trip indicator (migration 010): "Day {dayIndex} OF {dayCount}".
  // Both undefined → single-day leg.
  dayIndex?: number;
  dayCount?: number;
  // Invoicing
  revenue?: number;
  billable?: boolean;
  invoiceStatus?: InvoiceStatus;
  xeroInvoiceId?: string;
  xeroExportedAt?: string; // ISO timestamp
};

export type ProgressState = {
  completedIdx: number[];
  onSiteIdx: number | null;
  onSiteSinceMs: number | null;
  lastInside: boolean;
  // Backload collection tracking (at fromPostcode)
  collectArrivedMs?: number | null;
  collectDepartedISO?: string | null;
  collected?: boolean;
  // Chained run protection: vehicle must leave stop area before tracking begins
  // undefined = not yet determined, true = waiting for departure, false = cleared
  pendingDeparture?: boolean;
};

export type Weekdays = {
  mon: boolean;
  tue: boolean;
  wed: boolean;
  thu: boolean;
  fri: boolean;
};

export type RouteTemplate = {
  id: string;
  name: string;
  customer: CustomerKey;
  fromPostcode: string;
  toPostcode: string;
  returnToBase: boolean;
  startTime: string;
  serviceMins: number;
  includeBreaks: boolean;
  rawText: string;
  activeWeekdays?: Weekdays;
  days?: Weekdays; // backward compat
};

/** Map a Supabase `runs` row (snake_case) to a PlannedRun (camelCase) */
// `any` is used here intentionally — Supabase row shapes drift over time and
// we want this mapper to tolerate missing columns without throwing. Adding new
// columns is safe; removing is not.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToRun(row: any): PlannedRun {
  return {
    id: row.id,
    jobNumber: row.job_number ?? "",
    loadRef: row.load_ref ?? "",
    date: row.date,
    customer: row.customer,
    vehicle: row.vehicle ?? "",
    fromPostcode: row.from_postcode,
    toPostcode: row.to_postcode ?? "",
    returnToBase: row.return_to_base ?? true,
    startTime: row.start_time ?? "08:00",
    serviceMins: row.service_mins ?? 25,
    includeBreaks: row.include_breaks ?? true,
    rawText: row.raw_text ?? "",
    completedStopIndexes: row.completed_stop_indexes ?? [],
    completedMeta: row.completed_meta ?? {},
    progress: row.progress ?? { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false },
    createdBy: row.created_by ?? undefined,
    runType: row.run_type ?? "regular",
    runOrder: row.run_order ?? null,
    collectionTime: row.collection_time ?? undefined,
    collectionDate: row.collection_date ?? undefined,
    factory: row.factory ?? undefined,
    bookingTime: row.booking_time ?? undefined,
    subbyDriver: row.subby_driver ?? undefined,
    subbyCost: row.subby_cost == null ? undefined : Number(row.subby_cost),
    trailerNumber: row.trailer_number ?? undefined,
    trailerDropped: row.trailer_dropped ?? false,
    reference: row.reference ?? undefined,
    dayIndex: row.day_index ?? undefined,
    dayCount: row.day_count ?? undefined,
    revenue: row.revenue == null ? 0 : Number(row.revenue),
    billable: row.billable ?? false,
    invoiceStatus: (row.invoice_status as InvoiceStatus) ?? "open",
    xeroInvoiceId: row.xero_invoice_id ?? undefined,
    xeroExportedAt: row.xero_exported_at ?? undefined,
  };
}

/** Map a PlannedRun (camelCase) to a Supabase `runs` insert row (snake_case) */
export function runToRow(run: PlannedRun, userId?: string) {
  return {
    id: run.id,
    job_number: run.jobNumber,
    load_ref: run.loadRef || "",
    date: run.date,
    customer: run.customer,
    vehicle: run.vehicle || "",
    from_postcode: run.fromPostcode,
    to_postcode: run.toPostcode || "",
    return_to_base: run.returnToBase,
    start_time: run.startTime,
    service_mins: run.serviceMins,
    include_breaks: run.includeBreaks,
    raw_text: run.rawText || "",
    completed_stop_indexes: run.completedStopIndexes ?? [],
    completed_meta: run.completedMeta ?? {},
    progress: run.progress ?? { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false },
    created_by: userId ?? null,
    run_type: run.runType ?? "regular",
    run_order: run.runOrder ?? null,
    collection_time: run.collectionTime ?? null,
    collection_date: run.collectionDate ?? null,
    factory: run.factory ?? null,
    booking_time: run.bookingTime ?? null,
    subby_driver: run.subbyDriver ?? null,
    subby_cost: run.subbyCost ?? null,
    trailer_number: run.trailerNumber ?? null,
    trailer_dropped: run.trailerDropped ?? false,
    reference: run.reference ?? null,
    day_index: run.dayIndex ?? null,
    day_count: run.dayCount ?? null,
    revenue: run.revenue ?? 0,
    billable: run.billable ?? false,
    invoice_status: run.invoiceStatus ?? "open",
    xero_invoice_id: run.xeroInvoiceId ?? null,
    xero_exported_at: run.xeroExportedAt ?? null,
  };
}

/** Map a Supabase `templates` row to a RouteTemplate */
export function rowToTemplate(row: any): RouteTemplate {
  return {
    id: row.id,
    name: row.name,
    customer: row.customer,
    fromPostcode: row.from_postcode,
    toPostcode: row.to_postcode ?? "",
    returnToBase: row.return_to_base ?? true,
    startTime: row.start_time ?? "08:00",
    serviceMins: row.service_mins ?? 25,
    includeBreaks: row.include_breaks ?? true,
    rawText: row.raw_text ?? "",
    activeWeekdays: row.active_weekdays ?? { mon: true, tue: true, wed: true, thu: true, fri: true },
  };
}

/** Map a RouteTemplate to a Supabase `templates` insert row */
export function templateToRow(t: RouteTemplate, userId?: string) {
  return {
    id: t.id,
    name: t.name,
    customer: t.customer,
    from_postcode: t.fromPostcode,
    to_postcode: t.toPostcode || "",
    return_to_base: t.returnToBase,
    start_time: t.startTime,
    service_mins: t.serviceMins,
    include_breaks: t.includeBreaks,
    raw_text: t.rawText || "",
    active_weekdays: t.activeWeekdays ?? { mon: true, tue: true, wed: true, thu: true, fri: true },
    created_by: userId ?? null,
  };
}
