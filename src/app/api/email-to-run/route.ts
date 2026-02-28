import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizePostcode } from "@/lib/postcode-utils";
import { runToRow } from "@/types/runs";
import type { PlannedRun } from "@/types/runs";

const DEFAULT_PROGRESS = {
  completedIdx: [],
  onSiteIdx: null,
  onSiteSinceMs: null,
  lastInside: false,
};

/** Known depot/location names → postcodes */
const DEPOT_ALIASES: Record<string, string> = {
  "tamworth": "B78 3HJ",
  "premier park": "NW10 7NZ",
  "prem park": "NW10 7NZ",
  "portbury": "BS20 7XN",
  "newark": "NG22 8TX",
  "middleton foods": "WV14 0LH",
  "middleton foods willenhall": "WV14 0LH",
  "willenhall": "WV14 0LH",
  "purity soft drinks": "WS10 0BU",
  "purity soft drinks wednesbury": "WS10 0BU",
  "wednesbury": "WS10 0BU",
};

const BASE_POSTCODE = "NG22 8TX"; // Newark base

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolve a location name or postcode to a valid postcode */
function resolveLocation(nameOrPostcode: string): string {
  if (!nameOrPostcode) return "";
  const trimmed = nameOrPostcode.trim();
  // If it looks like a UK postcode already, normalize it
  if (/^[A-Z]{1,2}\d/i.test(trimmed)) {
    return normalizePostcode(trimmed);
  }
  // Try depot alias lookup
  const lower = trimmed.toLowerCase();
  for (const [alias, pc] of Object.entries(DEPOT_ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return normalizePostcode(pc);
    }
  }
  return trimmed;
}

/** Strip HTML tags to plain text */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Get next job number atomically */
async function getNextJobNumber(dateISO: string): Promise<string> {
  const sb = getSupabaseAdmin();
  const dateKey = dateISO.replaceAll("-", "");

  const { data, error } = await sb.rpc("increment_job_counter", {
    p_date_key: dateKey,
  });

  if (error) {
    // Fallback: manual upsert
    const { data: existing } = await sb
      .from("job_counters")
      .select("counter")
      .eq("date_key", dateKey)
      .single();

    const next = (existing?.counter ?? 0) + 1;
    await sb
      .from("job_counters")
      .upsert({ date_key: dateKey, counter: next });

    return `MLC-${dateKey}-${String(next).padStart(3, "0")}`;
  }

  const counter = typeof data === "number" ? data : 1;
  return `MLC-${dateKey}-${String(counter).padStart(3, "0")}`;
}

/** A single parsed run from the email */
type ParsedRun = {
  name: string;
  type: "regular" | "backload";
  customer: string;
  date: string;
  destination: string;
  destinationPostcode: string;
  fromLocation: string;
  fromPostcode: string;
  deliveryPostcodes: { postcode: string; time?: string; ref?: string }[];
  vehicle: string;
  loadRef: string;
  collectionRef: string;
  deliveryTime: string;
  collectionTime: string;
  price: string;
  notes: string;
};

/** Response from Claude: either multi-run or single-run format */
type ParsedEmailMulti = {
  runs: ParsedRun[];
};

type ParsedEmailSingle = {
  customer: string;
  date: string;
  postcodes: { postcode: string; time?: string; ref?: string }[];
  vehicle: string;
  loadRef: string;
  collectionRef: string;
  collectionTime: string;
  fromPostcode: string;
  notes: string;
};

type PostmarkAttachment = {
  Name: string;
  Content: string; // base64
  ContentType: string;
  ContentLength: number;
};

/** Extract PDF attachments from Postmark payload */
function getPdfAttachments(payload: any): PostmarkAttachment[] {
  const attachments: PostmarkAttachment[] = payload.Attachments ?? payload.attachments ?? [];
  return attachments.filter(
    (a) => a.ContentType === "application/pdf" || a.Name?.toLowerCase().endsWith(".pdf")
  );
}

/** Use Claude to parse email into multiple runs */
async function parseEmailWithClaude(
  emailBody: string,
  subject: string,
  customerNames: string[],
  pdfAttachments: PostmarkAttachment[] = []
): Promise<ParsedRun[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const depotList = Object.entries(DEPOT_ALIASES)
    .map(([name, pc]) => `  "${name}" = ${pc}`)
    .join("\n");

  const prompt = `You are parsing a UK logistics/delivery email. The email may contain MULTIPLE runs (deliveries/loads) in a table or list format, OR it may be a single delivery email.

Return ONLY valid JSON (no markdown, no code fences) with this structure:

{
  "runs": [
    {
      "name": "descriptive name of the run (e.g. 'Tamworth Load 1', 'Portbury Load 2')",
      "type": "regular or backload",
      "customer": "customer or company name",
      "date": "YYYY-MM-DD",
      "destination": "destination name (e.g. 'Tamworth', 'Portbury', 'Premier Park')",
      "destinationPostcode": "destination postcode if known, or empty string",
      "fromLocation": "collection/origin location name, or empty string",
      "fromPostcode": "collection/origin postcode if known, or empty string",
      "deliveryPostcodes": [
        {"postcode": "XX1 2YY", "time": "HH:MM or null", "ref": "reference or null"}
      ],
      "vehicle": "vehicle registration if mentioned, or empty string",
      "loadRef": "reference number for this load/run, or empty string",
      "collectionRef": "collection reference number, or empty string",
      "deliveryTime": "delivery/booking time at the destination in HH:MM 24hr format, or empty string",
      "collectionTime": "collection/pickup time in HH:MM 24hr format (backloads only), or empty string",
      "price": "price if mentioned (e.g. '£350'), or empty string",
      "notes": "any notes, pallet counts, vehicle type requirements, or empty string"
    }
  ]
}

IMPORTANT RULES:
- If the email contains a TABLE or LIST of multiple loads/runs, create a SEPARATE entry for each one
- Each row in a table = one run
- "regular" runs go from a base/depot to a destination and back
- "backload" runs are collections from a specific location (often listed separately at the bottom, or marked as backload/return load/collection)
- Backloads are typically extra jobs added after the main runs, collected from a named location
- For dates: if only day/month given, assume year is 2026. If no date found, use "${todayISO()}"
- Times should be in 24hr HH:MM format
- Known customers in the system: ${customerNames.join(", ")}. Match to the closest one if possible.
- Known depot/location postcodes:
${depotList}
- If you recognize a destination name that matches a known depot, put the postcode in "destinationPostcode"
- If you recognize a from/origin location, put the postcode in "fromPostcode"
- Look for reference numbers, booking numbers, consignment numbers — put them in loadRef or collectionRef as appropriate
- For backloads at the bottom of confirmation emails, the "collectionRef" is the reference number and "fromLocation"/"fromPostcode" is where to collect from
- For regular runs in a table, the "Time" column is the DELIVERY/BOOKING time at the destination — put it in "deliveryTime", NOT "collectionTime"
- "collectionTime" is ONLY for backload collection/pickup times
- ALL runs in the same email are for the SAME date. Use the date from the table/header for ALL runs including backloads listed at the bottom
- Pallet counts, curtain-sider requirements, etc. go in "notes"
- If there's only ONE run in the email, still return it in the "runs" array
- Check BOTH the email body AND any attached PDF documents

Email subject: ${subject}

Email body:
${emailBody}`;

  // Build content blocks: text prompt + any PDF documents
  const contentBlocks: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

  // Add PDF attachments first so Claude sees them before the prompt
  for (const pdf of pdfAttachments) {
    contentBlocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdf.Content,
      },
    });
  }

  contentBlocks.push({ type: "text", text: prompt });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response (handle potential markdown fences)
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${text.slice(0, 200)}`);
  }

  // Handle both multi-run and legacy single-run format
  if (parsed.runs && Array.isArray(parsed.runs)) {
    return parsed.runs;
  }

  // Legacy single-run format — convert to multi-run
  const single = parsed as ParsedEmailSingle;
  return [{
    name: single.customer || "Run",
    type: "backload",
    customer: single.customer || "",
    date: single.date || "",
    destination: "",
    destinationPostcode: "",
    fromLocation: "",
    fromPostcode: single.fromPostcode || "",
    deliveryPostcodes: single.postcodes || [],
    vehicle: single.vehicle || "",
    loadRef: single.loadRef || "",
    collectionRef: single.collectionRef || "",
    deliveryTime: "",
    collectionTime: single.collectionTime || "",
    price: "",
    notes: single.notes || "",
  }];
}

// ── Main handler ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  const startMs = Date.now();
  const sb = getSupabaseAdmin();

  // 1. Authenticate (supports header or query param)
  const authHeader = req.headers.get("authorization");
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    authHeader !== `Bearer ${cronSecret}` &&
    querySecret !== cronSecret
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await req.json();

    // 2. Extract email content (Postmark inbound format)
    const fromAddress: string = payload.From ?? payload.from ?? "";
    const subject: string = payload.Subject ?? payload.subject ?? "";
    const textBody: string = payload.TextBody ?? payload.text_body ?? "";
    const htmlBody: string = payload.HtmlBody ?? payload.html_body ?? "";

    const emailBody = textBody.trim() || stripHtml(htmlBody);

    // 2b. Extract PDF attachments
    const pdfAttachments = getPdfAttachments(payload);

    if (!emailBody && pdfAttachments.length === 0) {
      await sb.from("email_logs").insert({
        from_address: fromAddress,
        subject,
        body: "",
        status: "error",
        error: "Empty email body and no PDF attachments",
      });
      return NextResponse.json({ ok: true, message: "Empty email — skipped" });
    }

    // 3. Get available customers for matching
    const { data: customers } = await sb
      .from("customers")
      .select("name, base_postcode");
    const customerNames = (customers ?? []).map((c: any) => c.name);
    const customerMap = new Map(
      (customers ?? []).map((c: any) => [c.name.toLowerCase(), c])
    );

    // 4. Parse with Claude — returns array of runs
    let parsedRuns: ParsedRun[];
    try {
      parsedRuns = await parseEmailWithClaude(
        emailBody || "(see attached PDF)",
        subject,
        customerNames,
        pdfAttachments
      );
    } catch (parseErr: unknown) {
      const msg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      await sb.from("email_logs").insert({
        from_address: fromAddress,
        subject,
        body: emailBody.slice(0, 10000),
        status: "error",
        error: `Parse failed: ${msg}`,
      });
      return NextResponse.json({
        ok: true,
        message: "Parse failed — logged for review",
      });
    }

    if (!parsedRuns.length) {
      await sb.from("email_logs").insert({
        from_address: fromAddress,
        subject,
        body: emailBody.slice(0, 10000),
        parsed_data: { runs: parsedRuns },
        status: "error",
        error: "No runs found in email",
      });
      return NextResponse.json({
        ok: true,
        message: "No runs found — logged for review",
      });
    }

    // 5. Align dates — all runs from same email share the same date
    //    Find the most common explicit date (not today) and apply to runs missing a date
    const today = todayISO();
    const dateCounts = new Map<string, number>();
    for (const r of parsedRuns) {
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        dateCounts.set(r.date, (dateCounts.get(r.date) || 0) + 1);
      }
    }
    // Pick the most common date that isn't today (or just most common if all are today)
    let sharedDate = today;
    let maxCount = 0;
    for (const [d, count] of dateCounts) {
      if (count > maxCount || (count === maxCount && d !== today)) {
        sharedDate = d;
        maxCount = count;
      }
    }
    // Apply shared date to runs that defaulted to today or have no date
    // For backloads, only align if shared date is today or future — don't pull into past
    for (const r of parsedRuns) {
      if (!r.date || r.date === today) {
        if (r.type === "backload" && sharedDate < today) {
          r.date = today;
        } else {
          r.date = sharedDate;
        }
      }
    }

    // 6. Process each parsed run into a PlannedRun
    const createdRuns: { jobNumber: string; runId: string; customer: string; stops: number; name: string }[] = [];
    const errors: string[] = [];

    for (const parsed of parsedRuns) {
      // Resolve customer
      const matchedCustomer = customerNames.find(
        (c: string) => c.toLowerCase() === (parsed.customer || "").toLowerCase()
      );
      const customerName = matchedCustomer || parsed.customer || "Unknown";
      const customerData = customerMap.get(customerName.toLowerCase());

      // Resolve date
      const runDate = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : todayISO();

      // Determine run type
      const runType = parsed.type === "regular" ? "regular" : "backload";

      // Resolve from/to postcodes using depot aliases
      let fromPc: string;
      let toPc: string;

      if (runType === "regular") {
        // Regular runs: from base (Newark) to destination, return to base
        fromPc = parsed.fromPostcode
          ? resolveLocation(parsed.fromPostcode)
          : (parsed.fromLocation
            ? resolveLocation(parsed.fromLocation)
            : normalizePostcode(BASE_POSTCODE));
        toPc = fromPc; // return to base
      } else {
        // Backloads: from collection point, no return
        fromPc = parsed.fromPostcode
          ? resolveLocation(parsed.fromPostcode)
          : (parsed.fromLocation
            ? resolveLocation(parsed.fromLocation)
            : normalizePostcode(customerData?.base_postcode || BASE_POSTCODE));
        toPc = fromPc;
      }

      // Build delivery postcodes
      // For regular runs with a destination but no explicit delivery postcodes,
      // use the destination as the single delivery stop
      let postcodeLines: string[] = [];

      if (parsed.deliveryPostcodes && parsed.deliveryPostcodes.length > 0) {
        postcodeLines = parsed.deliveryPostcodes
          .filter((p: any) => p.postcode)
          .map((p: any) => {
            const pc = normalizePostcode(p.postcode);
            let line = p.time ? `${pc} ${p.time}` : pc;
            if (p.ref) line += ` REF:${p.ref}`;
            return line;
          });
      }

      // If no delivery postcodes but we have a destination, resolve it
      if (!postcodeLines.length) {
        const destPc = parsed.destinationPostcode
          ? resolveLocation(parsed.destinationPostcode)
          : resolveLocation(parsed.destination || "");

        if (destPc && /^[A-Z]{1,2}\d/i.test(destPc)) {
          // Use delivery time for the destination stop (not collection time)
          const bookingTime = parsed.deliveryTime || parsed.collectionTime || "";
          let line = bookingTime ? `${destPc} ${bookingTime}` : destPc;
          if (parsed.loadRef) line += ` REF:${parsed.loadRef}`;
          postcodeLines = [line];
        }
      }

      if (!postcodeLines.length) {
        errors.push(`Skipped "${parsed.name}": no postcodes resolved`);
        continue;
      }

      // Get job number
      const jobNumber = await getNextJobNumber(runDate);

      // Build refs — multi-run emails use the run name (e.g. "Tamworth Load 1")
      const isMultiRun = parsedRuns.length > 1;
      let loadRefFinal: string;

      if (isMultiRun && parsed.name) {
        // Use run name as primary ref, append Consolid8 ref number if present
        const refNum = parsed.loadRef || parsed.collectionRef || "";
        loadRefFinal = refNum ? `${parsed.name} / ${refNum}` : parsed.name;
      } else {
        const refs = [parsed.collectionRef, parsed.loadRef].filter(Boolean);
        loadRefFinal = refs.join(" / ") || "";
      }

      // Determine start time
      // For multi-run emails, the times are delivery booking times — don't use them as start time
      const collectionTime = parsed.collectionTime || "";
      const deliveryTime = parsed.deliveryTime
        || (parsed.deliveryPostcodes || []).find((p: any) => p.time)?.time
        || "";
      const startTime = isMultiRun
        ? (collectionTime || "08:00")
        : (collectionTime || deliveryTime || "08:00");

      // Store booking time: for backloads it's the collection time, for regular runs the delivery time
      const bookingTime = collectionTime || deliveryTime || undefined;

      const run: PlannedRun = {
        id: crypto.randomUUID(),
        jobNumber,
        loadRef: loadRefFinal,
        date: runDate,
        customer: customerName,
        vehicle: parsed.vehicle || "",
        fromPostcode: fromPc,
        toPostcode: fromPc,
        returnToBase: false,
        startTime,
        serviceMins: 25,
        includeBreaks: true,
        rawText: postcodeLines.join("\n"),
        completedStopIndexes: [],
        completedMeta: {},
        progress: DEFAULT_PROGRESS,
        runType,
        runOrder: null,
        collectionTime: bookingTime,
      };

      const { error: insertErr } = await sb
        .from("runs")
        .insert([runToRow(run)]);

      if (insertErr) {
        errors.push(`Failed to insert "${parsed.name}": ${insertErr.message}`);
        continue;
      }

      createdRuns.push({
        jobNumber,
        runId: run.id,
        customer: customerName,
        stops: postcodeLines.length,
        name: parsed.name,
      });
    }

    // 6. Log result
    const status = createdRuns.length > 0
      ? (errors.length > 0 ? "partial" : "created")
      : "error";

    await sb.from("email_logs").insert({
      from_address: fromAddress,
      subject,
      body: emailBody.slice(0, 10000),
      parsed_data: { runs: parsedRuns },
      run_id: createdRuns[0]?.runId ?? null,
      status,
      error: errors.length > 0 ? errors.join("; ") : null,
    });

    return NextResponse.json({
      ok: createdRuns.length > 0,
      runsCreated: createdRuns.length,
      runs: createdRuns,
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startMs,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email-to-run] Unexpected error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
