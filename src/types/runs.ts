export type CustomerKey = string;

export type Customer = {
  id: string;
  name: string;
  base_postcode: string;
  open_time: string;
  close_time: string;
};

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
};

export type ProgressState = {
  completedIdx: number[];
  onSiteIdx: number | null;
  onSiteSinceMs: number | null;
  lastInside: boolean;
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
