import { NextRequest } from "next/server";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type QuoteResult = { symbol: string; price?: number | null; changePct?: number | null; marketTime?: number | null; error?: string };

// Yahoo rate-limits (429) datacenter IPs and Stooq 404s them, so neither is
// reachable from a serverless function. Cboe publishes free delayed quotes over
// a public CDN (cdn.cboe.com) with no key, which serves datacenter traffic and
// includes the previous close so we get an accurate day change.
async function fetchQuote(symbol: string, cboeSym: string): Promise<Response> {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${encodeURIComponent(cboeSym)}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOne(symbol: string): Promise<QuoteResult> {
  // Cboe drops the dash on class shares (BRK-B -> BRKB); try the raw ticker
  // first, then a dashless variant if that 404s.
  const variants = symbol.includes("-") ? [symbol, symbol.replace(/-/g, "")] : [symbol];
  const maxAttempts = 3;
  let lastErr = "not found";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const variant of variants) {
      let res: Response;
      try {
        res = await fetchQuote(symbol, variant);
      } catch (e: any) {
        lastErr = e.name === "AbortError" ? "timeout" : e.message;
        continue;
      }
      if (res.status === 404) { lastErr = "not found"; continue; }
      if ((res.status === 429 || res.status >= 500)) { lastErr = `Cboe ${res.status}`; break; } // retry outer loop
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { symbol, error: `Cboe ${res.status}: ${body.slice(0, 80)}` };
      }
      const json = await res.json().catch(() => null);
      const d = json?.data;
      const price = typeof d?.current_price === "number" ? d.current_price : null;
      if (price == null) { lastErr = "no data"; continue; }
      const prev = typeof d?.prev_day_close === "number" ? d.prev_day_close : null;
      const changePct = prev && prev > 0 ? Math.round(((price - prev) / prev) * 10000) / 100 : null;
      const t = d?.last_trade_time ? Date.parse(d.last_trade_time) : NaN;
      return { symbol, price, changePct, marketTime: Number.isFinite(t) ? t : null };
    }
    if (attempt < maxAttempts) await sleep(400 * attempt);
  }
  return { symbol, error: lastErr };
}

// Run fn over items with at most `limit` in flight at once, to stay gentle.
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

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols") ?? "";
  if (!symbols) return Response.json({ results: [] });

  const symList = symbols.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const results = await mapLimit(symList, 6, fetchOne);
  return Response.json({ results });
}
