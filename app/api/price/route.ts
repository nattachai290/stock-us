import { NextRequest } from "next/server";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type QuoteResult = { symbol: string; price?: number | null; changePct?: number | null; marketTime?: number | null; error?: string };

// The chart endpoint needs no crumb/cookie handshake and is far more tolerant of
// repeated requests than v8/finance/quote, which now rate-limits (429) aggressively.
// It's per-symbol, so we fan out with limited concurrency (see mapLimit below).
async function fetchOne(symbol: string): Promise<QuoteResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9" },
        cache: "no-store",
      });
    } catch (e: any) {
      if (attempt >= maxAttempts) return { symbol, error: e.message };
      await sleep(400 * attempt);
      continue;
    }

    // 429 (and occasionally 5xx) are transient — back off and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** (attempt - 1); // 500ms, 1000ms, 2000ms
      await sleep(backoffMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { symbol, error: `Yahoo ${res.status}: ${body.slice(0, 120)}` };
    }

    const data = await res.json().catch(() => null);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) {
      const err = data?.chart?.error;
      return { symbol, error: err ? JSON.stringify(err) : "no data" };
    }

    const price = meta.regularMarketPrice ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const changePctRaw = price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null;
    return {
      symbol,
      price,
      changePct: changePctRaw != null ? Math.round(changePctRaw * 100) / 100 : null,
      // regularMarketTime is unix seconds — convert to ms for JS Date
      marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    };
  }
}

// Run fn over items with at most `limit` requests in flight at once, so we don't
// spray Yahoo with the whole batch simultaneously and trip its rate limiter.
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

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const results = await mapLimit(symList, 4, fetchOne);
  return Response.json({ results });
}
