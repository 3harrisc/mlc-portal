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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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

type ParsedEmail = {
  customer: string;
  date: string;
  postcodes: { postcode: string; time?: string }[];
  vehicle: string;
  loadRef: string;
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

/** Use Claude to parse email content (+ optional PDF attachments) into structured run data */
async function parseEmailWithClaude(
  emailBody: string,
  subject: string,
  customerNames: string[],
  pdfAttachments: PostmarkAttachment[] = []
): Promise<ParsedEmail> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const prompt = `You are parsing a UK logistics/delivery email to extract delivery run information.

Extract these fields and return ONLY valid JSON (no markdown, no code fences):

{
  "customer": "customer or company name sending/receiving the goods",
  "date": "delivery date in YYYY-MM-DD format",
  "postcodes": [
    {"postcode": "XX1 2YY", "time": "HH:MM or null"}
  ],
  "vehicle": "vehicle registration if mentioned, or empty string",
  "loadRef": "any booking/load/order reference number, or empty string",
  "fromPostcode": "collection/base postcode if mentioned, or empty string",
  "notes": "any special instructions or notes, or empty string"
}

IMPORTANT RULES:
- Postcodes must be valid UK postcodes (e.g. "LS9 0AB", "M1 2XX", "GL2 7ND")
- Include ALL postcodes found — both collection and delivery locations
- Times should be in 24hr HH:MM format (e.g. "14:00"), or null if not specified
- For dates: if only day/month given, assume year is 2026. If no date found, use "${todayISO()}"
- Known customers in the system: ${customerNames.join(", ")}. Match to the closest one if possible.
- If you can't determine a field, use empty string
- Check BOTH the email body AND any attached PDF documents for delivery information

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
    max_tokens: 1024,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response (handle potential markdown fences)
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${text.slice(0, 200)}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  const startMs = Date.now();
  const sb = getSupabaseAdmin();

  // 1. Authenticate
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
      // Log empty email with no attachments
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

    // 4. Parse with Claude (email body + any PDF attachments)
    let parsed;
    try {
      parsed = await parseEmailWithClaude(emailBody || "(see attached PDF)", subject, customerNames, pdfAttachments);
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

    // 5. Validate & resolve customer
    const matchedCustomer = customerNames.find(
      (c: string) => c.toLowerCase() === (parsed.customer || "").toLowerCase()
    );
    const customerName = matchedCustomer || customerNames[0] || "Unknown";
    const customerData = customerMap.get(customerName.toLowerCase());
    const basePostcode = customerData?.base_postcode || "GL2 7ND";

    // 6. Resolve date
    const runDate = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
      ? parsed.date
      : todayISO();

    // 7. Build postcodes raw text
    const postcodeLines = (parsed.postcodes || [])
      .filter((p: any) => p.postcode)
      .map((p: any) => {
        const pc = normalizePostcode(p.postcode);
        return p.time ? `${pc} ${p.time}` : pc;
      });

    if (!postcodeLines.length) {
      await sb.from("email_logs").insert({
        from_address: fromAddress,
        subject,
        body: emailBody.slice(0, 10000),
        parsed_data: parsed,
        status: "error",
        error: "No postcodes found in email",
      });
      return NextResponse.json({
        ok: true,
        message: "No postcodes found — logged for review",
      });
    }

    // 8. Get job number
    const jobNumber = await getNextJobNumber(runDate);

    // 9. Build and insert run
    const fromPc = parsed.fromPostcode
      ? normalizePostcode(parsed.fromPostcode)
      : normalizePostcode(basePostcode);

    const run: PlannedRun = {
      id: crypto.randomUUID(),
      jobNumber,
      loadRef: parsed.loadRef || "",
      date: runDate,
      customer: customerName,
      vehicle: parsed.vehicle || "",
      fromPostcode: fromPc,
      toPostcode: fromPc,
      returnToBase: true,
      startTime: "08:00",
      serviceMins: 25,
      includeBreaks: true,
      rawText: postcodeLines.join("\n"),
      completedStopIndexes: [],
      completedMeta: {},
      progress: DEFAULT_PROGRESS,
      runType: "regular",
      runOrder: null,
    };

    const { error: insertErr } = await sb
      .from("runs")
      .insert([runToRow(run)]);

    if (insertErr) {
      await sb.from("email_logs").insert({
        from_address: fromAddress,
        subject,
        body: emailBody.slice(0, 10000),
        parsed_data: parsed,
        status: "error",
        error: `Insert failed: ${insertErr.message}`,
      });
      return NextResponse.json({
        ok: false,
        error: insertErr.message,
      }, { status: 500 });
    }

    // 10. Log success
    await sb.from("email_logs").insert({
      from_address: fromAddress,
      subject,
      body: emailBody.slice(0, 10000),
      parsed_data: parsed,
      run_id: run.id,
      status: "created",
    });

    return NextResponse.json({
      ok: true,
      jobNumber,
      runId: run.id,
      customer: customerName,
      stops: postcodeLines.length,
      durationMs: Date.now() - startMs,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email-to-run] Unexpected error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
