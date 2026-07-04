import { NextRequest } from "next/server";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Module-level cache — persists across warm Lambda invocations
let crumbCache: { crumb: string; cookie: string; expires: number } | null = null;

async function fetchCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (crumbCache && crumbCache.expires > Date.now()) return crumbCache;

  // 1. Hit Yahoo Finance homepage to get session cookies
  const homeRes = await fetch("https://finance.yahoo.com/", {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html" },
    cache: "no-store",
    redirect: "follow",
  });

  const rawCookie = homeRes.headers.get("set-cookie") ?? "";
  // Keep only name=value pairs (strip Secure/HttpOnly/Path/etc.)
  const cookieStr = rawCookie.split(",")
    .map(c => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // 2. Fetch the crumb token
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, "Cookie": cookieStr },
    cache: "no-store",
  });

  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.startsWith("<") || crumb.length > 60) {
    throw new Error(`Cannot get crumb (status ${crumbRes.status}): ${crumb.slice(0, 80)}`);
  }

  crumbCache = { crumb, cookie: cookieStr, expires: Date.now() + 25 * 60 * 1000 }; // 25 min TTL
  return crumbCache;
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols") ?? "";
  if (!symbols) return Response.json({ results: [] });

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean);

  try {
    const { crumb, cookie } = await fetchCrumb();

    const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${symList.join(",")}&crumb=${encodeURIComponent(crumb)}&fields=regularMarketPrice,regularMarketChangePercent`;

    // Yahoo rate-limits (429) are transient — retry with backoff instead of
    // nuking the crumb/cookie, which would otherwise force extra handshake
    // requests right when Yahoo is already throttling us.
    let res: Response;
    let body = "";
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Cookie": cookie,
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });

      if (res.ok || res.status !== 429 || attempt >= maxAttempts) break;

      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** (attempt - 1); // 500ms, 1000ms, ...
      await sleep(backoffMs);
    }

    if (!res.ok) {
      // Only auth failures mean the crumb/cookie is actually invalid.
      // A 429 just means we were too fast — keep the cached crumb.
      if (res.status === 401 || res.status === 403) crumbCache = null;
      body = await res.text().catch(() => "");
      return Response.json(
        { results: [], error: `Yahoo ${res.status}: ${body.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const quotes = data?.quoteResponse?.result ?? [];

    if (!quotes.length && data?.quoteResponse?.error) {
      return Response.json(
        { results: [], error: `Yahoo: ${JSON.stringify(data.quoteResponse.error)}` },
        { status: 502 }
      );
    }

    const results = symList.map(sym => {
      const q = quotes.find((r: any) => r.symbol === sym);
      if (!q) return { symbol: sym, error: "not found" };
      return {
        symbol: sym,
        price: q.regularMarketPrice ?? null,
        changePct: q.regularMarketChangePercent ?? null,
      };
    });

    return Response.json({ results });
  } catch (err: any) {
    crumbCache = null;
    return Response.json({ results: [], error: err.message }, { status: 502 });
  }
}
