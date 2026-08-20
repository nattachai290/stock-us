import { NextRequest } from "next/server";
import { isGoldSymbol, fetchGold } from "../../lib/goldprice";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type QuoteResult = { symbol: string; price?: number | null; changePct?: number | null; marketTime?: number | null; error?: string };

// Price sources, tried in order per symbol. Yahoo (429) and Stooq (404) block
// datacenter IPs entirely, so we use two that don't: Cboe (a free per-symbol CDN)
// as primary, and CNBC (free, batchable) as fallback for symbols Cboe rate-limits
// (429) or doesn't carry. Spreading across two providers keeps a 100+ symbol
// portfolio from tripping either one's rate limit.

// ── Cboe (primary, per-symbol) ────────────────────────────────────────────────
async function cboeFetch(cboeSym: string): Promise<Response> {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${encodeURIComponent(cboeSym)}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    return await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, cache: "no-store", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns a quote, or { error } — "429"/"not found"/etc. so the caller can fall back.
async function fetchCboe(symbol: string): Promise<QuoteResult> {
  // Cboe writes class shares with a dot (BRK-B -> BRK.B), sometimes dashless (BRKB).
  const variants = symbol.includes("-")
    ? [symbol, symbol.replace(/-/g, "."), symbol.replace(/-/g, "")]
    : [symbol];
  let lastErr = "not found";
  for (const variant of variants) {
    let res: Response;
    try {
      res = await cboeFetch(variant);
    } catch (e: any) {
      lastErr = e.name === "AbortError" ? "timeout" : e.message;
      continue;
    }
    if (res.status === 404 || res.status === 403) { lastErr = "not found"; continue; }
    if (res.status === 429 || res.status >= 500) { return { symbol, error: "429" }; } // hand to fallback
    if (!res.ok) { lastErr = `Cboe ${res.status}`; continue; }
    const json = await res.json().catch(() => null);
    const d = json?.data;
    const price = typeof d?.current_price === "number" ? d.current_price : null;
    if (price == null) { lastErr = "no data"; continue; }
    const prev = typeof d?.prev_day_close === "number" ? d.prev_day_close : null;
    const changePct = prev && prev > 0 ? Math.round(((price - prev) / prev) * 10000) / 100 : null;
    const t = d?.last_trade_time ? Date.parse(d.last_trade_time) : NaN;
    return { symbol, price, changePct, marketTime: Number.isFinite(t) ? t : null };
  }
  return { symbol, error: lastErr };
}

// ── CNBC (fallback, batched) ──────────────────────────────────────────────────
const toNum = (v: any) => {
  const n = parseFloat(String(v ?? "").replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function fetchCnbcBatch(symbols: string[]): Promise<Map<string, QuoteResult>> {
  const out = new Map<string, QuoteResult>();
  if (!symbols.length) return out;
  // CNBC wants pipe-separated symbols in one param (repeated params merge into a
  // single bad ticker).
  const qs = `symbols=${encodeURIComponent(symbols.join("|"))}`;
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?${qs}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, cache: "no-store", signal: ctrl.signal });
  } catch {
    return out;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return out;
  const json = await res.json().catch(() => null);
  let quotes = json?.FormattedQuoteResult?.FormattedQuote ?? json?.QuickQuoteResult?.QuickQuote ?? [];
  if (!Array.isArray(quotes)) quotes = [quotes];
  for (const q of quotes) {
    const sym = String(q?.symbol ?? "").toUpperCase();
    if (!sym || Number(q?.code) !== 0) continue; // code 0 = valid quote
    const price = toNum(q?.last);
    if (price == null) continue;
    let changePct = toNum(q?.change_pct);
    if (changePct == null) {
      const prev = toNum(q?.previous_day_closing);
      if (prev && prev > 0) changePct = Math.round(((price - prev) / prev) * 10000) / 100;
    }
    const t = q?.last_time ? Date.parse(q.last_time) : NaN;
    out.set(sym, { symbol: sym, price, changePct: changePct ?? null, marketTime: Number.isFinite(t) ? t : null });
  }
  return out;
}

// ── short-lived quote cache ───────────────────────────────────────────────────
// The client polls once a minute per open tab while the market is open. Without this,
// two tabs and a phone mean three upstream fetches per symbol per minute, and Cboe
// starts returning 429s. A few seconds of staleness costs nothing here — the sources
// are delayed feeds to begin with — so serve any quote younger than TTL from memory.
//
// Per-instance and in-memory on purpose: no external store to run, and a cold start
// just means a cache miss. It reduces load, it is not relied on for correctness.
const QUOTE_TTL_MS = 45_000;
const quoteCache = new Map<string, { at: number; quote: QuoteResult }>();

function cachedQuote(symbol: string): QuoteResult | null {
  const hit = quoteCache.get(symbol);
  if (!hit || Date.now() - hit.at > QUOTE_TTL_MS) return null;
  return hit.quote;
}

// Only successful quotes are cached — caching an error would keep a symbol broken for
// the whole TTL even after the source recovers.
function cacheQuotes(results: QuoteResult[]) {
  const now = Date.now();
  for (const r of results) if (!r.error && r.price != null) quoteCache.set(r.symbol, { at: now, quote: r });
  // Bound the map so a long-lived instance cannot grow without limit.
  if (quoteCache.size > 500) {
    for (const [k, v] of quoteCache) if (now - v.at > QUOTE_TTL_MS) quoteCache.delete(k);
  }
}

// ── concurrency helper ────────────────────────────────────────────────────────
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols") ?? "";
  if (!symbols) return Response.json({ results: [] });

  const symList = symbols.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

  // 0) Serve anything still fresh from the last few seconds without touching a provider.
  const fresh = new Map<string, QuoteResult>();
  const toFetch: string[] = [];
  for (const sym of symList) {
    const hit = cachedQuote(sym);
    if (hit) fresh.set(sym, hit); else toFetch.push(sym);
  }

  // 1) Primary pass: spot gold (XAUUSD/XAU) → metals providers; everything else → Cboe.
  const results = await mapLimit(toFetch, 6, (sym) => isGoldSymbol(sym) ? fetchGold(sym) : fetchCboe(sym));

  // 2) Fallback pass: send everything Cboe couldn't resolve to CNBC (batched).
  //    Exclude gold — CNBC's "XAU" is the PHLX Gold/Silver *index* (~150), not spot
  //    gold (~$4000), so it must never fall back there.
  const misses = results.filter(r => r.error && !isGoldSymbol(r.symbol)).map(r => r.symbol);
  if (misses.length) {
    const cnbc = new Map<string, QuoteResult>();
    for (const grp of chunk(misses, 40)) {
      const m = await fetchCnbcBatch(grp);
      m.forEach((v, k) => cnbc.set(k, v));
      await sleep(150);
    }
    for (let i = 0; i < results.length; i++) {
      if (results[i].error) {
        const hit = cnbc.get(results[i].symbol);
        if (hit) results[i] = hit;
      }
    }
  }

  cacheQuotes(results);
  // Re-assemble in the order asked for, so the response shape never depends on what
  // happened to be cached.
  const byId = new Map(results.map(r => [r.symbol, r]));
  const out = symList.map(sym => fresh.get(sym) ?? byId.get(sym) ?? { symbol: sym, error: "not found" });
  return Response.json({ results: out });
}
