// Spot gold (XAU/USD, per troy ounce) price source for the /api/price route.
// Cboe and CNBC only carry equities/ETFs, so a holding with symbol XAUUSD/XAU is
// routed here instead. Two free, no-key providers; parsing is split into pure
// functions so the response shapes can be unit-tested without network access.

export type GoldQuote = { symbol: string; price?: number | null; changePct?: number | null; marketTime?: number | null; error?: string };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Symbols a user can give a gold holding. Deliberately NOT "GOLD" — that is a real
// ticker (Barrick Gold Corp, NYSE) the equity providers should keep handling.
export const GOLD_ALIASES = new Set(["XAUUSD", "XAU", "XAUUSD=X"]);
export const isGoldSymbol = (s: string) => GOLD_ALIASES.has(s.toUpperCase());

// data-asg.goldprice.org/dbXRates/USD →
// { ts, ..., items: [{ curr:"USD", xauPrice, chgXau, pcXau, xauClose, ... }] }
export function parseGoldpriceOrg(j: any, symbol: string): GoldQuote | null {
  const it = j?.items?.[0];
  const price = typeof it?.xauPrice === "number" ? it.xauPrice : null;
  if (price == null || !(price > 0)) return null;
  const changePct = typeof it?.pcXau === "number" ? Math.round(it.pcXau * 100) / 100 : null;
  const t = typeof j?.ts === "number" && Number.isFinite(j.ts) ? j.ts : Date.now();
  return { symbol, price, changePct, marketTime: t };
}

// api.gold-api.com/price/XAU → { name, price, symbol:"XAU", updatedAt, ... } (no change%)
export function parseGoldApiCom(j: any, symbol: string): GoldQuote | null {
  const price = typeof j?.price === "number" ? j.price : null;
  if (price == null || !(price > 0)) return null;
  const t = j?.updatedAt ? Date.parse(j.updatedAt) : NaN;
  return { symbol, price, changePct: null, marketTime: Number.isFinite(t) ? t : Date.now() };
}

async function getJson(url: string, ms = 6000): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
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

// Try goldprice.org (price + change%) first, then gold-api.com (price only).
export async function fetchGold(symbol: string): Promise<GoldQuote> {
  const a = await getJson("https://data-asg.goldprice.org/dbXRates/USD");
  const q1 = a && parseGoldpriceOrg(a, symbol);
  if (q1) return q1;

  const b = await getJson("https://api.gold-api.com/price/XAU");
  const q2 = b && parseGoldApiCom(b, symbol);
  if (q2) return q2;

  return { symbol, error: "gold price unavailable" };
}
