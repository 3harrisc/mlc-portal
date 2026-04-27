/**
 * Import the extracted Master Planner JSON into Supabase.
 *
 * Reads the JSON produced by `scripts/extract_master_planner.py` and upserts
 * one `runs` row per leg. Idempotent: the same source row always maps to the
 * same `runs.id` (`legacy-{sheet}-r{row}`), so re-running the import won't
 * duplicate.
 *
 * Defaults to dry-run (no DB writes). Pass `--commit` to actually write.
 *
 * Required env (read from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      (service-role; bypasses RLS for admin import)
 *
 * Usage:
 *   npx tsx scripts/import-master-planner.ts --in tmp/all-weeks.json
 *   npx tsx scripts/import-master-planner.ts --in tmp/all-weeks.json --commit
 *   npx tsx scripts/import-master-planner.ts --in tmp/all-weeks.json --commit --week 39 --year 2025
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// ── env ──────────────────────────────────────────────────────────────────────

const ENV_FILE = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE });
} else {
  dotenv.config();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

interface CliArgs {
  inFile: string;
  commit: boolean;
  week?: number;
  year?: number;
  batchSize: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { inFile: "", commit: false, batchSize: 250 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.inFile = argv[++i];
    else if (a === "--commit") args.commit = true;
    else if (a === "--week") args.week = Number(argv[++i]);
    else if (a === "--year") args.year = Number(argv[++i]);
    else if (a === "--batch-size") args.batchSize = Number(argv[++i]);
    else if (a === "-h" || a === "--help") {
      console.log("Usage: tsx scripts/import-master-planner.ts --in <json> [--commit] [--week N --year YYYY]");
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (!args.inFile) {
    console.error("--in <json> is required");
    process.exit(1);
  }
  return args;
}

// ── JSON shapes (matches Python extractor's output) ─────────────────────────

interface ExtractedLeg {
  sourceSheet: string;
  sourceRow: number;
  date: string;                    // yyyy-MM-dd
  runType: "regular" | "backload";
  fromPostcode: string;
  toPostcode: string;
  dayIndex: number | null;
  dayCount: number | null;
  factory: string | null;
  bookingTime: string | null;
  vehicle: string;
  subbyDriver: string | null;
  subbyCost: number | null;
  trailerNumber: string | null;
  trailerDropped: boolean;
  trailerDroppedNote: string | null;
  reference: string | null;
  customer: string;
  revenue: number;
  billable: boolean;
  invoiceStatus: "open" | "billable" | "sent" | "paid" | "cancelled";
}

interface ExtractedFile {
  generatedAt: string;
  sourceFile: string;
  stats: Array<{ year: number; week: number; legCount: number }>;
  legs: ExtractedLeg[];
}

// ── Mapping leg → runs row ──────────────────────────────────────────────────

function legacyId(leg: ExtractedLeg): string {
  return `legacy-${leg.sourceSheet}-r${leg.sourceRow}`;
}

function legToRow(leg: ExtractedLeg): Record<string, unknown> {
  return {
    id: legacyId(leg),
    job_number: "",
    load_ref: leg.reference ?? "",
    date: leg.date,
    customer: leg.customer,
    vehicle: leg.vehicle,
    from_postcode: leg.fromPostcode,
    to_postcode: leg.toPostcode,
    return_to_base: true,
    start_time: "08:00",
    service_mins: 25,
    include_breaks: true,
    raw_text: "",
    completed_stop_indexes: [],
    completed_meta: {},
    progress: { completedIdx: [], onSiteIdx: null, onSiteSinceMs: null, lastInside: false },
    created_by: null,
    run_type: leg.runType,
    run_order: null,
    collection_time: null,
    collection_date: null,
    factory: leg.factory,
    booking_time: leg.bookingTime,
    subby_driver: leg.subbyDriver,
    subby_cost: leg.subbyCost,
    trailer_number: leg.trailerNumber,
    trailer_dropped: leg.trailerDropped,
    reference: leg.reference,
    day_index: leg.dayIndex,
    day_count: leg.dayCount,
    revenue: leg.revenue,
    billable: leg.billable,
    invoice_status: leg.invoiceStatus,
    xero_invoice_id: null,         // not recoverable from spreadsheet
    xero_exported_at: null,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  const raw = fs.readFileSync(path.resolve(args.inFile), "utf-8");
  const data: ExtractedFile = JSON.parse(raw);

  let legs = data.legs;
  if (args.year && args.week) {
    legs = legs.filter((l) => {
      // Sheet names look like Mon_WK39_25; recover (year, week) from there.
      const m = l.sourceSheet.match(/_WK(\d+)_(\d+)$/);
      if (!m) return false;
      const yy = Number(m[2]);
      const wk = Number(m[1]);
      return wk === args.week && 2000 + yy === args.year;
    });
    console.log(`Filtered to WK${args.week}/${args.year} → ${legs.length} legs`);
  }

  console.log(`Total legs to import: ${legs.length}`);
  console.log(`Mode: ${args.commit ? "REAL COMMIT" : "DRY-RUN (no writes)"}`);

  // Summary by status / type for visibility before any DB write.
  const byStatus = new Map<string, number>();
  const byRunType = new Map<string, number>();
  const byVehicle = new Map<string, number>();
  let totalRev = 0;
  let totalSentRev = 0;

  for (const l of legs) {
    byStatus.set(l.invoiceStatus, (byStatus.get(l.invoiceStatus) ?? 0) + 1);
    byRunType.set(l.runType, (byRunType.get(l.runType) ?? 0) + 1);
    byVehicle.set(l.vehicle, (byVehicle.get(l.vehicle) ?? 0) + 1);
    totalRev += l.revenue;
    if (l.invoiceStatus === "sent") totalSentRev += l.revenue;
  }

  console.log("\nBy invoice status:");
  for (const [k, v] of Array.from(byStatus.entries()).sort()) {
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)}`);
  }
  console.log("\nBy run type:");
  for (const [k, v] of Array.from(byRunType.entries()).sort()) {
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)}`);
  }
  console.log(`\nTotal revenue:        £${totalRev.toFixed(2)}`);
  console.log(`Already-sent revenue: £${totalSentRev.toFixed(2)}`);
  console.log("\nTop 15 vehicles:");
  for (const [k, v] of Array.from(byVehicle.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)}`);
  }

  // Show sample.
  console.log("\nSample 3 legs (first / middle / last):");
  for (const l of [legs[0], legs[Math.floor(legs.length / 2)], legs[legs.length - 1]].filter(Boolean)) {
    const row = legToRow(l);
    console.log(`  ${row.id} | ${row.date} | ${row.customer} | ${row.vehicle} | £${row.revenue} | ${row.invoice_status}`);
  }

  if (!args.commit) {
    console.log("\n[dry-run] Skipping DB writes. Re-run with --commit to apply.");
    return;
  }

  // Real commit.
  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rows = legs.map(legToRow);
  const batches = chunk(rows, args.batchSize);
  console.log(`\nUpserting ${rows.length} rows in ${batches.length} batches of up to ${args.batchSize}…`);

  let upserted = 0;
  for (const [i, batch] of batches.entries()) {
    const { error, count } = await supabase
      .from("runs")
      .upsert(batch, { onConflict: "id", count: "exact" });
    if (error) {
      console.error(`Batch ${i + 1} failed:`, error.message);
      process.exit(1);
    }
    upserted += count ?? batch.length;
    process.stdout.write(`  batch ${i + 1}/${batches.length}  +${batch.length}  total ${upserted}\n`);
  }

  console.log(`\nDone. Upserted ${upserted} rows.`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
