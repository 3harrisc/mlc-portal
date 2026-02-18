// Shared Webfleet CSV parsing utilities
// Used by both the collector (cron) and any debug endpoints

export type Row = Record<string, string>;

export function envAny(...keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

export function stripQuotes(s: string) {
  const t = (s ?? "").trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

export function normVehicle(s: string) {
  return stripQuotes(String(s ?? ""))
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function toNumberSafe(s: string) {
  const n = Number(String(s ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

export function dmsToDecimal(dmsRaw: string): number | null {
  const s = stripQuotes(dmsRaw);
  if (!s) return null;

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

export function parseCsv(text: string): Row[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (!lines.length) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
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

export function extractLatLng(row: Row): { lat: number; lng: number } | null {
  const latMdeg = toNumberSafe(row["latitude_mdeg"]);
  const lngMdeg = toNumberSafe(row["longitude_mdeg"]);
  if (latMdeg != null && lngMdeg != null) {
    const lat = latMdeg / 1_000_000;
    const lng = lngMdeg / 1_000_000;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }

  const latDms = dmsToDecimal(row["latitude"]);
  const lngDms = dmsToDecimal(row["longitude"]);
  if (latDms != null && lngDms != null) return { lat: latDms, lng: lngDms };

  return null;
}

/** Fetch ALL vehicles from Webfleet in one CSV call */
export async function fetchAllVehiclesFromWebfleet(): Promise<{
  rows: Row[];
  error?: string;
}> {
  const baseUrl = envAny("WEBFLEET_BASE_URL") || "https://csv.webfleet.com/extern";
  const account = envAny("WEBFLEET_ACCOUNT");
  const username = envAny("WEBFLEET_USERNAME");
  const password = envAny("WEBFLEET_PASSWORD");
  const apiKey = envAny("WEBFLEET_API_KEY", "WEBFLEET_APIKEY");

  if (!account || !username || !password || !apiKey) {
    return { rows: [], error: "Missing Webfleet env vars" };
  }

  const url =
    `${baseUrl}?` +
    `lang=en&` +
    `account=${encodeURIComponent(account)}&` +
    `username=${encodeURIComponent(username)}&` +
    `password=${encodeURIComponent(password)}&` +
    `apikey=${encodeURIComponent(apiKey)}&` +
    `action=showObjectReportExtern&` +
    `outputformat=csv`;

  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  if (!res.ok) {
    return { rows: [], error: `Webfleet HTTP ${res.status}: ${text.slice(0, 500)}` };
  }

  const rows = parseCsv(text);
  return { rows };
}

/** Parse a single Webfleet CSV row into a vehicle position record */
export function parseVehicleRow(row: Row) {
  const name = stripQuotes(row["objectname"] || row["objectno"] || "");
  const ll = extractLatLng(row);
  if (!name || !ll) return null;

  const speed = toNumberSafe(row["speed"]);
  const heading = toNumberSafe(row["course"]);
  const posTime = row["pos_time"] || row["msgtime"] || "";

  return {
    vehicle: normVehicle(name),
    lat: ll.lat,
    lng: ll.lng,
    speed_kph: speed,
    heading: heading,
    pos_time: posTime || null,
    raw: row,
  };
}
