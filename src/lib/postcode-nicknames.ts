import { createClient } from "@/lib/supabase/client";
import { normalizePostcode } from "@/lib/postcode-utils";

let cachedNicknames: Record<string, string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60_000; // 5 minutes

/** Fetch all postcode nicknames (client-side, cached) */
export async function fetchNicknames(): Promise<Record<string, string>> {
  if (cachedNicknames && Date.now() - cacheTime < CACHE_TTL) {
    return cachedNicknames;
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("postcode_nicknames")
    .select("postcode, nickname");

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[normalizePostcode(row.postcode)] = row.nickname;
  }

  cachedNicknames = map;
  cacheTime = Date.now();
  return map;
}

/** Clear the cache (call after admin edits) */
export function clearNicknameCache() {
  cachedNicknames = null;
  cacheTime = 0;
}

/** Format a postcode with its nickname: "NG22 8TX (Brakes Newark)" */
export function withNickname(
  postcode: string,
  nicknames: Record<string, string>
): string {
  const norm = normalizePostcode(postcode);
  const nick = nicknames[norm];
  return nick ? `${postcode} (${nick})` : postcode;
}
