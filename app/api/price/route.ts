import { NextRequest } from "next/server";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type QuoteResult = { symbol: string; price?: number | null; changePct?: number | null; marketTime?: number | null; error?: string };

// Yahoo now hard-rate-limits (429) datacenter IPs such as Vercel's, so we can't
// reach it from a serverless function at all. Stooq needs no key/crumb and
// serves datacenter traffic fine. Its light-quote endpoint takes many symbols in
// one CSV request. US tickers use the ".us" suffix (e.g. aapl.us, brk-b.us).
const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

async function fetchBatch(symbols: string[]): Promise<QuoteResult[]> {
  const query = symbols.map(s => `${s.toLowerCase()}.us`).join(",");
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(query)}&f=sd2t2ohlc&h&e=csv`;

  const maxAttempts = 3;
  let lastErr = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "text/csv" },
        cache: "no-store",
        signal: ctrl.signal,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        lastErr = `Stooq ${res.status}`;
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return symbols.map(s => ({ symbol: s, error: `Stooq ${res.status}: ${body.slice(0, 80)}` }));
      }

      const text = await res.text();
      // CSV header: Symbol,Date,Time,Open,High,Low,Close
      const rows = text.trim().split("\n").slice(1);
      const bySymbol = new Map<string, QuoteResult>();
      for (const line of rows) {
        const [rawSym, date, time, open, , , close] = line.split(",");
        if (!rawSym) continue;
        const sym = rawSym.replace(/\.us$/i, "").toUpperCase();
        const price = num(close);
        if (price == null || !date || date.startsWith("0000")) {
          bySymbol.set(sym, { symbol: sym, error: "not found" });
          continue;
        }
        const openN = num(open);
        // Stooq's light quote has no previous-close field, so "today's change"
        // here is measured from the session open.
        const changePct = openN && openN > 0 ? Math.round(((price - openN) / openN) * 10000) / 100 : null;
        const t = date && time && time !== "00:00:00" ? Date.parse(`${date}T${time}Z`) : Date.parse(`${date}T00:00:00Z`);
        bySymbol.set(sym, { symbol: sym, price, changePct, marketTime: Number.isFinite(t) ? t : null });
      }
      // Preserve request order; flag any symbol Stooq didn't return.
      return symbols.map(s => bySymbol.get(s.toUpperCase()) ?? { symbol: s, error: "not found" });
    } catch (e: any) {
      lastErr = e.name === "AbortError" ? "timeout" : e.message;
      if (attempt >= maxAttempts) break;
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  return symbols.map(s => ({ symbol: s, error: lastErr }));
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols") ?? "";
  if (!symbols) return Response.json({ results: [] });

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const results = await fetchBatch(symList);
  return Response.json({ results });
}
