import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols") || "";
  if (!symbols) return Response.json({ results: [] });

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${symList.join(",")}&fields=regularMarketPrice,regularMarketChangePercent`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com/",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return Response.json(
        { results: [], error: `Yahoo ${res.status}: ${body.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const quotes = data?.quoteResponse?.result || [];

    if (!quotes.length && data?.quoteResponse?.error) {
      return Response.json(
        { results: [], error: `Yahoo error: ${JSON.stringify(data.quoteResponse.error)}` },
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
    return Response.json({ results: [], error: err.message }, { status: 502 });
  }
}
