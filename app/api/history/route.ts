import { NextRequest } from "next/server";

// Historical daily CLOSE prices for a set of symbols over a date range.
// Response: { results: { AAPL: { "2024-01-02": 185.64, ... } }, errors: { SYM: "reason" } }
//
// Providers are tried in order per symbol until one returns a usable daily series.
// Unlike the live-quote route (Cboe/CNBC only give today's price), historical closes
// come from chart endpoints. These run on Vercel's IPs, not the browser, so which
// hosts are reachable differs from a local machine — the multi-provider fallback keeps
// the feature working if any one source blocks the datacenter range.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type DayMap = Record<string, number>; // "YYYY-MM-DD" -> close
type SymResult = { symbol: string; days?: DayMap; error?: string };

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── Yahoo (primary): crumb-authenticated v8 chart ─────────────────────────────
let crumbCache: { crumb: string; cookie: string; expires: number } | null = null;

async function fetchCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (crumbCache && crumbCache.expires > Date.now()) return crumbCache;
  try {
    const home = await fetch("https://finance.yahoo.com/", { headers: { "User-Agent": UA }, cache: "no-store", redirect: "follow" });
    const raw = home.headers.get("set-cookie") ?? "";
    const cookie = raw.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
    const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie }, cache: "no-store" });
    const crumb = (await cr.text()).trim();
    if (!crumb || crumb.length > 40) return null;
    crumbCache = { crumb, cookie, expires: Date.now() + 25 * 60 * 1000 };
    return crumbCache;
  } catch { return null; }
}

async function fromYahoo(symbol: string, p1: number, p2: number): Promise<SymResult> {
  const c = await fetchCrumb();
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(p1 / 1000)}&period2=${Math.floor(p2 / 1000)}&interval=1d`;
  const url = c ? `${base}&crumb=${encodeURIComponent(c.crumb)}` : base;
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(c ? { Cookie: c.cookie } : {}) }, cache: "no-store" });
  if (!res.ok) return { symbol, error: `yahoo ${res.status}` };
  const json = await res.json().catch(() => null);
  const r = json?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
  if (!ts.length || !closes.length) return { symbol, error: "yahoo no data" };
  const days: DayMap = {};
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (typeof v === "number" && Number.isFinite(v)) days[iso(ts[i] * 1000)] = Math.round(v * 10000) / 10000;
  }
  return Object.keys(days).length ? { symbol, days } : { symbol, error: "yahoo empty" };
}

// ── Stooq (fallback): daily CSV ───────────────────────────────────────────────
async function fromStooq(symbol: string, p1: number, p2: number): Promise<SymResult> {
  const s = symbol.replace(/-/g, ".").toLowerCase() + ".us"; // BRK-B -> brk.b.us
  const d1 = iso(p1).replace(/-/g, ""), d2 = iso(p2).replace(/-/g, "");
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&d1=${d1}&d2=${d2}&i=d`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) return { symbol, error: `stooq ${res.status}` };
  const csv = await res.text();
  // Header: Date,Open,High,Low,Close,Volume
  const lines = csv.trim().split("\n");
  if (lines.length < 2 || !/^date,/i.test(lines[0])) return { symbol, error: "stooq no data" };
  const days: DayMap = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[0], close = parseFloat(cols[4]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close)) days[date] = Math.round(close * 10000) / 10000;
  }
  return Object.keys(days).length ? { symbol, days } : { symbol, error: "stooq empty" };
}

// ── CNBC (fallback): time-series chart ────────────────────────────────────────
async function fromCnbc(symbol: string, p1: number, p2: number): Promise<SymResult> {
  const years = Math.max(1, Math.ceil((Date.now() - p1) / (365 * 86400000)));
  const range = years <= 1 ? "1Y" : years <= 2 ? "2Y" : years <= 5 ? "5Y" : "ALL";
  const url = `https://ts-api.cnbc.com/harmony/app/charts/${range}/${encodeURIComponent(symbol)}.json`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return { symbol, error: `cnbc ${res.status}` };
  const json = await res.json().catch(() => null);
  const bars = json?.barData?.priceBars ?? json?.priceBars ?? [];
  if (!Array.isArray(bars) || !bars.length) return { symbol, error: "cnbc no data" };
  const days: DayMap = {};
  for (const b of bars) {
    const tRaw = b?.tradeTimeinMills ?? b?.tradeTime ?? b?.time;
    const ms = typeof tRaw === "string" ? Date.parse(tRaw) : Number(tRaw) * (String(tRaw).length <= 10 ? 1000 : 1);
    const close = parseFloat(b?.close);
    if (Number.isFinite(ms) && Number.isFinite(close)) days[iso(ms)] = Math.round(close * 10000) / 10000;
  }
  return Object.keys(days).length ? { symbol, days } : { symbol, error: "cnbc empty" };
}

async function fetchSymbol(symbol: string, p1: number, p2: number): Promise<SymResult> {
  const providers = [fromYahoo, fromStooq, fromCnbc];
  let lastErr = "no data";
  for (const p of providers) {
    try {
      const r = await p(symbol, p1, p2);
      if (r.days && Object.keys(r.days).length) return r;
      lastErr = r.error || lastErr;
    } catch (e: any) {
      lastErr = e?.message || "fetch failed";
    }
  }
  return { symbol, error: lastErr };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const symbols = (q.get("symbols") ?? "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return Response.json({ results: {}, errors: {} });

  const fromStr = q.get("from"); // YYYY-MM-DD
  const toStr = q.get("to");
  const p1 = fromStr ? Date.parse(fromStr + "T00:00:00Z") : Date.now() - 3 * 365 * 86400000;
  const p2 = toStr ? Date.parse(toStr + "T23:59:59Z") : Date.now();

  const settled = await mapLimit(symbols, 4, s => fetchSymbol(s, p1, p2));
  const results: Record<string, DayMap> = {};
  const errors: Record<string, string> = {};
  for (const r of settled) {
    if (r.days) results[r.symbol] = r.days;
    else errors[r.symbol] = r.error || "no data";
  }
  return Response.json({ results, errors });
}
