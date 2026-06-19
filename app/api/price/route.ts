import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols") || "";
  if (!symbols) return Response.json({ results: [] });

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean);

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symList.join(",")}&fields=regularMarketPrice,regularMarketChangePercent`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) throw new Error(`Yahoo Finance responded ${res.status}`);

    const data = await res.json();
    const quotes = data?.quoteResponse?.result || [];

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
