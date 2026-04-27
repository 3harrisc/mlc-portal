import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listCustomerXeroMap,
  listRunsForWeek,
  markRunsExported,
  reserveInvoiceNumbers,
} from "@/app/actions/invoicing";
import { runToInvoiceable } from "@/lib/xero/run-to-invoiceable";
import { groupRuns } from "@/lib/xero/group-runs";
import { buildXeroCsv } from "@/lib/xero/build-csv";
import { DEFAULT_XERO_CONFIG, type XeroCsvLayout } from "@/types/invoicing";

export const dynamic = "force-dynamic";

/**
 * Generate a Xero invoice CSV for a given ISO week.
 *
 * Query params:
 *   week    — ISO week number (1..53)
 *   year    — ISO week year (e.g. 2025)
 *   layout  — 'lite' | 'template' (default: 'template')
 *   commit  — 'true' to mark exported runs as 'sent' (default: 'false', dry-run)
 *
 * Auth: admin only.
 *
 * Behaviour:
 *   - Picks up every run in the requested week with billable=true and
 *     invoice_status != 'sent' / 'paid' / 'cancelled'.
 *   - Groups them via lib/xero/group-runs (Ashwood / LoadRef / weekly rule).
 *   - Atomically reserves N invoice numbers from invoice_counter.
 *   - Builds the CSV and (if commit=true) updates each run's
 *     invoice_status, xero_invoice_id, xero_exported_at.
 *
 * Returns the CSV as `text/csv`.
 */
export async function POST(req: Request) {
  try {
    // 1. Auth gate.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
    }

    // 2. Validate input.
    const { searchParams } = new URL(req.url);
    const weekRaw = searchParams.get("week") ?? "";
    const yearRaw = searchParams.get("year") ?? "";
    const layoutRaw = (searchParams.get("layout") ?? "template").toLowerCase();
    const commit = searchParams.get("commit") === "true";

    const week = Number(weekRaw);
    const year = Number(yearRaw);

    if (!Number.isInteger(week) || week < 1 || week > 53) {
      return NextResponse.json(
        { ok: false, error: "week must be an integer between 1 and 53" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return NextResponse.json(
        { ok: false, error: "year must be an integer between 2020 and 2100" },
        { status: 400 }
      );
    }
    if (layoutRaw !== "lite" && layoutRaw !== "template") {
      return NextResponse.json(
        { ok: false, error: "layout must be 'lite' or 'template'" },
        { status: 400 }
      );
    }
    const layout = layoutRaw as XeroCsvLayout;

    // 3. Pull runs and customer map in parallel.
    const [runsRes, mapRes] = await Promise.all([
      listRunsForWeek(year, week),
      listCustomerXeroMap(),
    ]);
    if (runsRes.error) {
      return NextResponse.json({ ok: false, error: runsRes.error }, { status: 500 });
    }
    if (mapRes.error || !mapRes.entries) {
      return NextResponse.json(
        { ok: false, error: mapRes.error ?? "customer_xero_map missing" },
        { status: 500 }
      );
    }

    // 4. Filter to billable + not-yet-sent runs.
    const billable = (runsRes.runs ?? []).filter(
      (r) =>
        r.billable === true &&
        r.invoiceStatus !== "sent" &&
        r.invoiceStatus !== "paid" &&
        r.invoiceStatus !== "cancelled" &&
        (r.revenue ?? 0) > 0 &&
        (r.customer ?? "").trim().length > 0
    );

    if (billable.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          message: "No eligible billable runs in the selected week.",
          assignments: [],
          groupCount: 0,
          lineCount: 0,
        },
        { status: 200 }
      );
    }

    // 5. Group + (optionally) reserve invoice numbers.
    const invoiceableRuns = billable.map(runToInvoiceable);
    const groups = groupRuns(invoiceableRuns);

    let startInvoiceNumber: number;
    if (commit) {
      const reserve = await reserveInvoiceNumbers(groups.length);
      if (reserve.error || reserve.highest == null) {
        return NextResponse.json(
          { ok: false, error: reserve.error ?? "Failed to reserve invoice numbers" },
          { status: 500 }
        );
      }
      startInvoiceNumber = reserve.highest - groups.length + 1;
    } else {
      // Dry-run: peek at the counter without consuming it.
      const { data: counter } = await supabase
        .from("invoice_counter")
        .select("counter")
        .eq("id", "xero")
        .single();
      const current = counter?.counter ?? 99449;
      startInvoiceNumber = current + 1;
    }

    // 6. Build the CSV.
    const config = { ...DEFAULT_XERO_CONFIG, layout };
    const { csv, assignments } = buildXeroCsv({
      groups,
      customerMap: mapRes.entries,
      startInvoiceNumber,
      config,
    });

    // 7. Mark runs as exported on commit.
    if (commit && assignments.length > 0) {
      const mark = await markRunsExported(
        assignments.map((a) => ({ runIds: a.runIds, invoiceNumber: a.invoiceNumber }))
      );
      if (mark.error) {
        // We've already reserved the numbers — return them anyway so the user
        // knows what was issued and can reconcile manually.
        return NextResponse.json(
          {
            ok: false,
            error: `CSV generated but marking runs failed: ${mark.error}`,
            assignments,
          },
          { status: 500 }
        );
      }
    }

    // 8. Send the file.
    const filename = commit
      ? `Xero_Invoices_W${String(week).padStart(2, "0")}_${year}.csv`
      : `Xero_Invoices_W${String(week).padStart(2, "0")}_${year}_DRAFT.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Invoice-Group-Count": String(assignments.length),
        "X-Invoice-Line-Count": String(invoiceableRuns.length),
        "X-Invoice-Committed": String(commit),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
