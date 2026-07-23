// USD→THB spot rate for display only (the portfolio is accounted in USD; baht is shown
// alongside as a convenience). Two keyless providers, tried in order — both work from
// datacenter IPs. Never used in any calculation that gets stored.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchJson(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  // open.er-api.com (primary)
  const a = await fetchJson("https://open.er-api.com/v6/latest/USD");
  let rate = typeof a?.rates?.THB === "number" ? a.rates.THB : null;
  // exchangerate.host (fallback)
  if (rate == null) {
    const b = await fetchJson("https://api.exchangerate.host/latest?base=USD&symbols=THB");
    rate = typeof b?.rates?.THB === "number" ? b.rates.THB : null;
  }
  return Response.json({ rate });
}
