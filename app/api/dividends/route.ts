import { NextRequest } from "next/server";
import { UA, yahooChart } from "../../lib/yahoo";
import { parseNasdaqDividends, parseYahooDividends, type DivEvent } from "../../lib/dividends";

// Dividend history per symbol, as paid per share at the time (not split-adjusted).
// Response: { results: { MSFT: [{ ex:"2026-08-20", pay:"2026-09-10", amount:0.91 }, ...] }, errors: { SYM: "reason" } }
// An empty array means "pays no dividends" — only a symbol no provider could answer for
// goes in `errors`.
//
// Nasdaq first: amounts as paid plus payment dates and announced-but-not-yet-ex rows,
// but it only covers Nasdaq listings. Yahoo covers everything else (NYSE stocks, most
// ETFs); its split-adjusted amounts are converted back in parseYahooDividends.

async function fromNasdaq(symbol: string): Promise<DivEvent[] | null> {
  const variants = symbol.includes("-") ? [symbol, symbol.replace(/-/g, ".")] : [symbol];
  for (const sym of variants) {
    for (const ac of ["stocks", "etf"]) {
      const res = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/dividends?assetclass=${ac}`, {
        headers: {
          "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
          "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/",
        },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const evs = parseNasdaqDividends(await res.json().catch(() => null));
      if (evs && evs.length) return evs; // empty = "no table here", let Yahoo decide
    }
  }
  return null;
}

async function fromYahoo(symbol: string): Promise<DivEvent[] | null> {
  // from 1990 so every split since a dividend can be undone, monthly bars keep it small
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=631152000&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1mo&events=div%7Csplit`;
  return parseYahooDividends(await yahooChart(base));
}

async function resolve(symbol: string): Promise<{ symbol: string; events?: DivEvent[]; error?: string }> {
  const errs: string[] = [];
  for (const [name, p] of [["nasdaq", fromNasdaq], ["yahoo", fromYahoo]] as const) {
    try {
      const evs = await p(symbol);
      if (evs) return { symbol, events: evs };
      errs.push(`${name} no data`);
    } catch (e: any) { errs.push(e?.message || `${name} failed`); }
  }
  return { symbol, error: errs.join(" | ") };
}

export async function GET(request: NextRequest) {
  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
    .split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.\-^=]{1,15}$/.test(s)).slice(0, 25);
  const results: Record<string, DivEvent[]> = {};
  const errors: Record<string, string> = {};
  let next = 0;
  const settled: Awaited<ReturnType<typeof resolve>>[] = [];
  await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, async () => {
    while (next < symbols.length) settled.push(await resolve(symbols[next++]));
  }));
  for (const r of settled) {
    if (r.events) results[r.symbol] = r.events;
    else errors[r.symbol] = r.error || "no data";
  }
  // Shared CDN copy for a few hours: dividends are announced weeks ahead.
  return Response.json({ results, errors }, {
    headers: { "Cache-Control": Object.keys(errors).length ? "no-store" : "public, s-maxage=21600, stale-while-revalidate=86400" },
  });
}
