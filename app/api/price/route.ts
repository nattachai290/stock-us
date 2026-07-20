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

  // 1) Primary pass: spot gold (XAUUSD/XAU) → metals providers; everything else → Cboe.
  const results = await mapLimit(symList, 6, (sym) => isGoldSymbol(sym) ? fetchGold(sym) : fetchCboe(sym));

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

  return Response.json({ results });
}
