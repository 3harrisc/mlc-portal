export type CostCategory = "fuel" | "adblue" | "parking" | "tolls" | "other";

export const COST_CATEGORIES: { value: CostCategory; label: string }[] = [
  { value: "fuel", label: "Fuel" },
  { value: "adblue", label: "AdBlue" },
  { value: "parking", label: "Parking" },
  { value: "tolls", label: "Tolls" },
  { value: "other", label: "Other" },
];

export type Cost = {
  id: string;
  driverId: string;
  runId: string | null;
  vehicle: string;
  date: string;
  category: CostCategory;
  amount: number; // pence
  note: string;
  receiptUrl: string | null;
  createdAt: string;
};

/** Map a Supabase `costs` row (snake_case) to a Cost (camelCase) */
export function rowToCost(row: any): Cost {
  return {
    id: row.id,
    driverId: row.driver_id,
    runId: row.run_id ?? null,
    vehicle: row.vehicle ?? "",
    date: row.date,
    category: row.category,
    amount: row.amount ?? 0,
    note: row.note ?? "",
    receiptUrl: row.receipt_url ?? null,
    createdAt: row.created_at ?? "",
  };
}

/** Format pence as £X.XX */
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
