import { NextResponse } from "next/server";
import { envAny, parseCsv } from "@/lib/webfleet";

/**
 * GET /api/webfleet/driving-times
 *
 * Debug endpoint: calls Webfleet getRemainingDrivingTimesEu
 * and returns the raw CSV + parsed rows so we can see the exact fields.
 *
 * Protected by CRON_SECRET to prevent public access.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Also allow via query param for easy browser testing
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    if (secret !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const baseUrl = envAny("WEBFLEET_BASE_URL") || "https://csv.webfleet.com/extern";
  const account = envAny("WEBFLEET_ACCOUNT");
  const username = envAny("WEBFLEET_USERNAME");
  const password = envAny("WEBFLEET_PASSWORD");
  const apiKey = envAny("WEBFLEET_API_KEY", "WEBFLEET_APIKEY");

  if (!account || !username || !password || !apiKey) {
    return NextResponse.json({
      error: "Missing Webfleet env vars",
      debug: {
        hasAccount: !!account,
        hasUsername: !!username,
        hasPassword: !!password,
        hasApiKey: !!apiKey,
        hasCronSecret: !!cronSecret,
      },
    }, { status: 500 });
  }

  const url =
    `${baseUrl}?` +
    `lang=en&` +
    `account=${encodeURIComponent(account)}&` +
    `username=${encodeURIComponent(username)}&` +
    `password=${encodeURIComponent(password)}&` +
    `apikey=${encodeURIComponent(apiKey)}&` +
    `action=getRemainingDrivingTimesEu&` +
    `outputformat=csv`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const rawText = await res.text();

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        httpStatus: res.status,
        rawText: rawText.slice(0, 2000),
      });
    }

    const rows = parseCsv(rawText);

    return NextResponse.json({
      ok: true,
      httpStatus: res.status,
      rawCsvPreview: rawText.slice(0, 3000),
      csvHeaders: rows.length > 0 ? Object.keys(rows[0]) : [],
      rowCount: rows.length,
      rows,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
