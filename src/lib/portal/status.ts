/**
 * The customer-facing load status enum.
 *
 * Lives here rather than beside StatusPill because `types/runs.ts` needs it
 * to type the `status_override` column, and a types module has no business
 * importing a React component. StatusPill re-exports both names so every
 * existing import site keeps working.
 */

export type LoadStatus =
  | "in-transit"
  | "delivered"
  | "scheduled"
  | "exception"
  | "delayed"
  | "loading";

export const STATUS_LABEL: Record<LoadStatus, string> = {
  "in-transit": "In transit",
  delivered: "Delivered",
  scheduled: "Scheduled",
  exception: "Exception",
  delayed: "Delayed",
  loading: "Loading",
};

/** Every value, in the order the override dropdown should list them. */
export const ALL_STATUSES: LoadStatus[] = [
  "scheduled",
  "loading",
  "in-transit",
  "delivered",
  "delayed",
  "exception",
];
