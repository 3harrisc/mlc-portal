import type { CustomerKey } from "@/types/runs";

export const CUSTOMERS: CustomerKey[] = [
  "Montpellier",
  "Customer A",
  "Customer B",
  "Consolid8",
  "Ashwood",
];

export const CUSTOMER_OPENING_PRESETS: Record<CustomerKey, { open: string; close: string }> = {
  Montpellier: { open: "08:00", close: "17:00" },
  "Customer A": { open: "08:00", close: "17:00" },
  "Customer B": { open: "08:00", close: "17:00" },
  Consolid8: { open: "06:00", close: "18:00" },
  Ashwood: { open: "08:00", close: "17:00" },
};

export const CUSTOMER_BASE_POSTCODES: Partial<Record<CustomerKey, string>> = {
  Montpellier: "GL2 7ND",
  Ashwood: "CF44 8ER",
};

export const DEFAULT_BASE = "GL2 7ND"; // Montpellier base

export function getDefaultOpeningForCustomer(customer: CustomerKey) {
  return CUSTOMER_OPENING_PRESETS[customer] ?? { open: "08:00", close: "17:00" };
}
