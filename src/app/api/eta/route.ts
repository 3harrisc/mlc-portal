import { NextResponse } from "next/server";

type Row = Record<string, string>;

function envAny(...keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function stripQuotes(s: string) {
  const t = (s ?? "").trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

function normVehicle(s: string) {
  // webfleet objectname is normally the reg; match robustly
  return stripQuotes(String(s ?? ""))
    .toUpperCase()
    .replace(/\s+/g, "");
}

function toNumberSafe(s: string) {
  const n = Number(String(s ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse "2°32'34.4\" W" + "51°13'43.9\" N" into decimal degrees.
 */
function dmsToDecimal(dmsRaw: string): number | null {
  const s = stripQuotes(dmsRaw);
  if (!s) return null;

  // Example: 2°32'34.4" W
  const m = s.match(
    /(\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)\s*"\s*([NSEW])/i
  );
  if (!m) return null;

  const deg = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const hemi = String(m[4]).toUpperCase();

  if (![deg, min, sec].every(Number.isFinite)) return null;

  let dec = deg + min / 60 + sec / 3600;
  if (hemi === "S" || hemi === "W") dec *= -1;
  return dec;
}

/**
 * Very small CSV parser that handles:
 * - header row
 * - quoted fields with semicolons or commas
 * - newline-separated rows
 */
function parseCsv(text: string): Row[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (!lines.length) return [];

  // Auto-detect delimiter: semicolon or comma (Webfleet uses semicolons)
  const delimiter = lines[0].includes(";") ? ";" : ",";

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // handle escaped double quote inside quoted string: ""
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
        continue;
      }

      if (ch === delimiter && !inQ) {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };

  const headers = parseLine(lines[0]).map((h) => stripQuotes(h));

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const row: Row = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = stripQuotes(cols[c] ?? "");
    }
    rows.push(row);
  }
  return rows;
}

function pickVehicleRow(rows: Row[], vehicleQuery: string): Row | null {
  const q = normVehicle(vehicleQuery);
  if (!q) return rows[0] ?? null;

  // Search in multiple fields (Webfleet vehicles vs trailers store names differently)
  const keysToTry = ["objectname", "objectno", "externalid", "description"];

  // Exact match first
  for (const r of rows) {
    for (const k of keysToTry) {
      const v = r[k];
      if (v && normVehicle(v) === q) return r;
    }
  }

  // Substring match in any field (for registrations like "B14MLC")
  for (const r of rows) {
    for (const k of keysToTry) {
      const v = r[k];
      if (v && normVehicle(v).includes(q)) return r;
    }
  }

  return null;
}

function extractLatLng(row: Row): { lat: number; lng: number } | null {
  // Best: microdegrees fields (they exist in your raw)
  const latMdeg = toNumberSafe(row["latitude_mdeg"]);
  const lngMdeg = toNumberSafe(row["longitude_mdeg"]);
  if (latMdeg != null && lngMdeg != null) {
    // Webfleet mdeg is degrees * 1e6
    const lat = latMdeg / 1_000_000;
    const lng = lngMdeg / 1_000_000;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }

  // Next best: DMS text fields
  const latDms = dmsToDecimal(row["latitude"]);
  const lngDms = dmsToDecimal(row["longitude"]);
  if (latDms != null && lngDms != null) return { lat: latDms, lng: lngDms };

  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const vehicle = searchParams.get("vehicle") || "";
    const debug = searchParams.get("debug") === "true";

    const baseUrl = envAny("WEBFLEET_BASE_URL") || "https://csv.webfleet.com/extern";

    const account = envAny("WEBFLEET_ACCOUNT");
    const username = envAny("WEBFLEET_USERNAME");
    const password = envAny("WEBFLEET_PASSWORD");
    const apiKey = envAny("WEBFLEET_API_KEY", "WEBFLEET_APIKEY"); // ✅ accept either

    if (!account || !username || !password || !apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing Webfleet env vars. Need WEBFLEET_ACCOUNT, WEBFLEET_USERNAME, WEBFLEET_PASSWORD, WEBFLEET_API_KEY (or WEBFLEET_APIKEY).",
        },
        { status: 500 }
      );
    }

    // This is the standard "object report" style endpoint
    // If you used a slightly different action earlier, this still works for most accounts.
    let url =
      `${baseUrl}?` +
      `lang=en&` +
      `account=${encodeURIComponent(account)}&` +
      `username=${encodeURIComponent(username)}&` +
      `password=${encodeURIComponent(password)}&` +
      `apikey=${encodeURIComponent(apiKey)}&` +
      `action=showObjectReportExtern&` +
      `outputformat=csv`;

    // Filter by vehicle if specified
    // Note: Don't use filterstring - it's too restrictive for Webfleet
    // Instead, fetch all and filter in code (allows matching across all fields)

    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Webfleet HTTP ${res.status}`, raw: text.slice(0, 2000) },
        { status: 500 }
      );
    }

    const rows = parseCsv(text);
    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "Webfleet returned no rows", raw: text.slice(0, 2000) },
        { status: 500 }
      );
    }

    const row = pickVehicleRow(rows, vehicle);
    if (!row) {
      return NextResponse.json(
        {
          ok: false,
          error: "Webfleet returned no usable row for this vehicle. Check reg matches objectname.",
          hint: `Tried matching against objectname/objectno/externalid. Query=${vehicle}`,
          sample: rows.slice(0, 3),
          allVehicleNames: rows.map(r => r.objectname || r.objectno || "(no name)").slice(0, 20),
        },
        { status: 500 }
      );
    }

    const ll = extractLatLng(row);
    if (!ll) {
      return NextResponse.json(
        {
          ok: false,
          error: "Webfleet returned a row but without usable lat/lng",
          hint: "Check that the vehicle has a recent GPS position in Webfleet.",
          raw: row,
        },
        { status: 500 }
      );
    }

    const speed = toNumberSafe(row["speed"]);
    const heading = toNumberSafe(row["course"]);
    const timestamp = row["pos_time"] || row["msgtime"] || "";

    return NextResponse.json({
      ok: true,
      vehicle: stripQuotes(row["objectname"] || vehicle),
      lat: ll.lat,
      lng: ll.lng,
      speedKph: speed ?? undefined,
      heading: heading ?? undefined,
      timestamp: timestamp ? timestamp : undefined,
      raw: debug ? row : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Webfleet error", details: String(e) },
      { status: 500 }
    );
  }
}
