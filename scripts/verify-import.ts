/**
 * Quick post-import verification: hit Supabase and confirm what we expect
 * actually landed.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

const ENV_FILE = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  // 1. Total imported legacy rows
  const { count: totalCount } = await supabase
    .from("runs")
    .select("id", { count: "exact", head: true })
    .like("id", "legacy-%");
  console.log(`Total legacy rows: ${totalCount}`);

  // 2. By status
  const statuses = ["open", "billable", "sent", "paid", "cancelled"] as const;
  for (const s of statuses) {
    const { count } = await supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .like("id", "legacy-%")
      .eq("invoice_status", s);
    if (count) console.log(`  ${s.padEnd(10)} ${count}`);
  }

  // 3. By run type
  for (const rt of ["regular", "backload"]) {
    const { count } = await supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .like("id", "legacy-%")
      .eq("run_type", rt);
    if (count) console.log(`  ${rt.padEnd(10)} ${count}`);
  }

  // 4. Total revenue (paginated — Supabase caps SELECT at 1000 rows by default)
  let totalRev = 0;
  let totalSentRev = 0;
  let pageFrom = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("runs")
      .select("revenue, invoice_status")
      .like("id", "legacy-%")
      .range(pageFrom, pageFrom + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ revenue: number | null; invoice_status: string }>) {
      const rev = Number(r.revenue ?? 0);
      totalRev += rev;
      if (r.invoice_status === "sent") totalSentRev += rev;
    }
    if (data.length < pageSize) break;
    pageFrom += pageSize;
  }
  console.log(`\nTotal revenue across legacy rows: £${totalRev.toFixed(2)}`);
  console.log(`Already-sent revenue:             £${totalSentRev.toFixed(2)}`);

  // 5. Sample WK39 Monday
  const { data: wk39mon } = await supabase
    .from("runs")
    .select("id, customer, vehicle, from_postcode, to_postcode, revenue, invoice_status, run_type")
    .eq("date", "2025-09-22")
    .like("id", "legacy-%")
    .order("id");
  console.log(`\nWK39 Monday (2025-09-22) — ${wk39mon?.length ?? 0} legs`);
  for (const r of (wk39mon ?? []).slice(0, 6)) {
    console.log(`  ${r.run_type.padEnd(8)} ${(r.from_postcode ?? "").padEnd(15)} → ${(r.to_postcode ?? "").padEnd(20)}  ${(r.vehicle ?? "").padEnd(8)} ${(r.customer ?? "").padEnd(14)} £${(r.revenue ?? 0).toString().padStart(7)}  ${r.invoice_status}`);
  }

  // 6. Sample one already-sent leg
  const { data: sent } = await supabase
    .from("runs")
    .select("id, date, customer, vehicle, revenue")
    .eq("invoice_status", "sent")
    .like("id", "legacy-%")
    .limit(3);
  console.log("\nSample already-sent legs:");
  for (const r of sent ?? []) {
    console.log(`  ${r.id} | ${r.date} | ${r.customer} | ${r.vehicle} | £${r.revenue}`);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
