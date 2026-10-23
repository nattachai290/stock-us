// Server-side only (/api/history): the shared cache of daily closes, one row per
// (symbol, year) in Supabase table public.price_shards — past years never change, so each
// is fetched from the providers once and served to every user and device after that.
//
// Talks to Supabase's REST API (PostgREST) with plain fetch, no client library. The table
// has RLS on and no policies, so only the secret key (server env, never sent to the
// browser) can read or write it. Without the env vars the route just skips the cache.
//
// Replaces the Vercel Blob store (px/{SYM}/{YEAR}.json), whose free tier ran out.

export type DayMap = Record<string, number>; // "YYYY-MM-DD" -> close

const env = () => {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return url && key ? { url, key } : null;
};

export const hasShardCache = () => !!env();

function headers(key: string, extra: Record<string, string> = {}) {
  // New-style keys (sb_secret_…) go in `apikey` only; a legacy service_role key is a JWT
  // and is also sent as the bearer token.
  return { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}

// Every stored year of `symbol` within [y1, y2]: { "2025": DayMap, ... }. A year with no row
// is absent; a stored empty object means "known: no data that year". Errors read as a miss.
export async function readShards(symbol: string, y1: number, y2: number): Promise<Record<string, DayMap>> {
  const e = env();
  if (!e) return {};
  try {
    const q = `symbol=eq.${encodeURIComponent(symbol)}&year=gte.${y1}&year=lte.${y2}&select=year,days`;
    const res = await fetch(`${e.url}/rest/v1/price_shards?${q}`, { headers: headers(e.key), cache: "no-store" });
    if (!res.ok) return {};
    const rows: { year: number; days: DayMap }[] = await res.json();
    const out: Record<string, DayMap> = {};
    for (const r of rows) out[String(r.year)] = r.days || {};
    return out;
  } catch { return {}; }
}

// Upsert several years of one symbol in one request. Failures are ignored: the cache is an
// optimisation, the providers stay the source of truth.
export async function writeShards(symbol: string, years: Record<string, DayMap>): Promise<void> {
  const e = env();
  const rows = Object.entries(years).map(([year, days]) => ({ symbol, year: +year, days, updated_at: new Date().toISOString() }));
  if (!e || !rows.length) return;
  try {
    await fetch(`${e.url}/rest/v1/price_shards?on_conflict=symbol,year`, {
      method: "POST",
      headers: headers(e.key, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows),
      cache: "no-store",
    });
  } catch {}
}
