import { NextRequest } from "next/server";
import { list, put } from "@vercel/blob";

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

// ── Nasdaq (primary): official historical API, works from datacenter IPs ───────
// GET /api/quote/{SYM}/historical?assetclass=stocks&fromdate=..&todate=..&limit=9999
// → data.tradesTable.rows[] = { date:"01/02/2024", close:"$185.64", ... }
// ETFs need assetclass=etf, so try stocks then etf. Nasdaq is picky about headers.
async function nasdaqTry(symbol: string, assetclass: string, from: string, to: string): Promise<DayMap | null> {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetclass}&fromdate=${from}&todate=${to}&limit=9999`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.nasdaq.com",
      "Referer": "https://www.nasdaq.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`nasdaq ${assetclass} ${res.status}`);
  const json = await res.json().catch(() => null);
  const rows = json?.data?.tradesTable?.rows;
  if (!Array.isArray(rows) || !rows.length) return null;
  const days: DayMap = {};
  for (const r of rows) {
    const [mm, dd, yyyy] = String(r?.date || "").split("/");
    const close = parseFloat(String(r?.close || "").replace(/[$,]/g, ""));
    if (yyyy && mm && dd && Number.isFinite(close)) days[`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`] = Math.round(close * 10000) / 10000;
  }
  return Object.keys(days).length ? days : null;
}

async function fromNasdaq(symbol: string, p1: number, p2: number): Promise<SymResult> {
  const from = iso(p1), to = iso(p2);
  // Class shares: Nasdaq writes BRK-B as BRK.B in its API path. Try the app's dash form
  // first, then the dotted form. ETFs need assetclass=etf, so try stocks then etf.
  const symVariants = symbol.includes("-") ? [symbol, symbol.replace(/-/g, ".")] : [symbol];
  let lastErr = "nasdaq no data";
  for (const sym of symVariants) {
    for (const ac of ["stocks", "etf"]) {
      try {
        const days = await nasdaqTry(sym, ac, from, to);
        if (days) return { symbol, days };
      } catch (e: any) { lastErr = e?.message || "nasdaq failed"; }
    }
  }
  return { symbol, error: lastErr };
}

// ── Yahoo (fallback): crumb-authenticated v8 chart ────────────────────────────
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
  if (lines.length < 2 || !/^date,/i.test(lines[0])) return { symbol, error: `stooq: ${csv.slice(0, 50).replace(/\s+/g, " ")}` };
  const days: DayMap = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[0], close = parseFloat(cols[4]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close)) days[date] = Math.round(close * 10000) / 10000;
  }
  return Object.keys(days).length ? { symbol, days } : { symbol, error: "stooq empty" };
}

// ── CNBC (reachable from Vercel): time-series chart ───────────────────────────
// ts-api.cnbc.com answers from datacenter IPs (returns 400 on a bad path rather than
// refusing the connection), so it's our primary historical source. The harmony chart
// path shape varies, so try the known variants until one returns priceBars. Items look
// like { tradeTime:"20240102", tradeTimeinMills:1704...e12, open/high/low/close }.
function parseCnbcBars(json: any): DayMap {
  const bars = json?.barData?.priceBars ?? json?.priceBars ?? json?.data?.priceBars ?? [];
  const days: DayMap = {};
  if (!Array.isArray(bars)) return days;
  for (const b of bars) {
    let ms = NaN;
    const mills = b?.tradeTimeinMills;
    const tt = b?.tradeTime;
    if (mills != null && Number.isFinite(Number(mills))) ms = Number(mills);
    else if (typeof tt === "string" && /^\d{8}$/.test(tt)) ms = Date.parse(`${tt.slice(0, 4)}-${tt.slice(4, 6)}-${tt.slice(6, 8)}T00:00:00Z`);
    else if (tt != null) ms = Date.parse(String(tt));
    const close = parseFloat(b?.close);
    if (Number.isFinite(ms) && Number.isFinite(close)) days[iso(ms)] = Math.round(close * 10000) / 10000;
  }
  return days;
}

async function fromCnbc(symbol: string, p1: number, _p2: number): Promise<SymResult> {
  const years = Math.max(1, Math.ceil((Date.now() - p1) / (365 * 86400000)));
  const range = years <= 1 ? "1Y" : years <= 2 ? "2Y" : years <= 5 ? "5Y" : "ALL";
  const sym = encodeURIComponent(symbol);
  const urls = [
    `https://ts-api.cnbc.com/harmony/app/charts/${range}.json?symbol=${sym}`,
    `https://ts-api.cnbc.com/harmony/app/charts/${range}/${sym}.json`,
    `https://ts-api.cnbc.com/harmony/app/bars/${sym}/1/day/${range}.json`,
  ];
  let lastErr = "cnbc no data";
  for (const url of urls) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 90).replace(/\s+/g, " ");
      lastErr = `cnbc ${res.status} ${body}`;
      continue;
    }
    const json = await res.json().catch(() => null);
    const days = parseCnbcBars(json);
    if (Object.keys(days).length) return { symbol, days };
    lastErr = "cnbc empty";
  }
  return { symbol, error: lastErr };
}

async function fetchSymbol(symbol: string, p1: number, p2: number): Promise<SymResult> {
  // Nasdaq first (official historical API, datacenter-friendly); others as fallback.
  const providers = [fromNasdaq, fromCnbc, fromYahoo, fromStooq];
  const errs: string[] = [];
  for (const p of providers) {
    try {
      const r = await p(symbol, p1, p2);
      if (r.days && Object.keys(r.days).length) return r;
      if (r.error) errs.push(r.error);
    } catch (e: any) {
      errs.push(e?.name === "AbortError" ? "timeout" : (e?.message || "fetch failed"));
    }
  }
  return { symbol, error: errs.join(" | ") || "no data" };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// ── Vercel Blob shard cache (px/{SYMBOL}/{YEAR}.json) ─────────────────────────
// Closes for a past year never change, so each (symbol, year) is cached once and shared
// by every user/device. Past-year shards are immutable (1-year CDN cache); the current
// year is short-lived and refreshed when its tail goes stale.
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const curYear = () => new Date().getUTCFullYear();

function splitByYear(days: DayMap): Record<string, DayMap> {
  const out: Record<string, DayMap> = {};
  for (const d in days) { const y = d.slice(0, 4); (out[y] ||= {})[d] = days[d]; }
  return out;
}

async function listShards(sym: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const { blobs } = await list({ prefix: `px/${sym}/` });
    for (const b of blobs) { const m = b.pathname.match(/\/(\d{4})\.json$/); if (m) out[m[1]] = b.url; }
  } catch {}
  return out;
}

async function readShard(url: string): Promise<DayMap> {
  try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? await r.json() : {}; } catch { return {}; }
}

async function writeShard(sym: string, year: number, days: DayMap) {
  try {
    await put(`px/${sym}/${year}.json`, JSON.stringify(days), {
      access: "public", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: year < curYear() ? 31536000 : 3600,
    });
  } catch {}
}

// Resolve one symbol over [p1,p2] from Blob shards, filling misses from the providers and
// persisting new shards. Falls back to direct provider fetch when no Blob store is wired.
async function resolveSymbol(sym: string, p1: number, p2: number): Promise<SymResult> {
  if (!hasBlob()) return fetchSymbol(sym, p1, p2);

  const y1 = new Date(p1).getUTCFullYear(), y2 = new Date(p2).getUTCFullYear(), cur = curYear();
  const shards = await listShards(sym);
  const result: DayMap = {};
  const missing: number[] = [];

  for (let y = y1; y <= y2; y++) {
    if (shards[String(y)]) {
      const dm = await readShard(shards[String(y)]);
      Object.assign(result, dm);
      if (y === cur) { // current-year shard may be stale
        const last = Object.keys(dm).sort().pop();
        if (!last || Date.parse(last) < Date.now() - 3 * 86400000) missing.push(y);
      }
    } else missing.push(y);
  }

  if (missing.length) {
    // Fetch a wide range (earliest-missing → today) so Nasdaq returns DAILY granularity,
    // then shard by year. Short single-year ranges make Nasdaq return coarse/empty data.
    const lo = Math.min(...missing);
    const nas = await fetchSymbol(sym, Date.parse(`${lo}-01-01T00:00:00Z`), Date.now());
    if (nas.days) {
      const byYear = splitByYear(nas.days);
      for (let y = lo; y <= cur; y++) {
        if (!missing.includes(y) && y !== cur) continue;
        const dm = byYear[String(y)] || {};
        if (Object.keys(dm).length || y < cur) await writeShard(sym, y, dm); // empty past = known-no-data
        if (y >= y1 && y <= y2) Object.assign(result, dm);
      }
    } else if (!Object.keys(result).length) {
      return { symbol: sym, error: nas.error };
    }
  }

  const from = new Date(p1).toISOString().slice(0, 10), to = new Date(p2).toISOString().slice(0, 10);
  const filtered: DayMap = {};
  for (const d in result) if (d >= from && d <= to) filtered[d] = result[d];
  return Object.keys(filtered).length ? { symbol: sym, days: filtered } : { symbol: sym, error: "no data" };
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const symbols = (q.get("symbols") ?? "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return Response.json({ results: {}, errors: {} });

  const fromStr = q.get("from"); // YYYY-MM-DD
  const toStr = q.get("to");
  const p1 = fromStr ? Date.parse(fromStr + "T00:00:00Z") : Date.now() - 3 * 365 * 86400000;
  const p2 = toStr ? Date.parse(toStr + "T23:59:59Z") : Date.now();

  const settled = await mapLimit(symbols, 4, s => resolveSymbol(s, p1, p2));
  const results: Record<string, DayMap> = {};
  const errors: Record<string, string> = {};
  for (const r of settled) {
    if (r.days) results[r.symbol] = r.days;
    else errors[r.symbol] = r.error || "no data";
  }
  return Response.json({ results, errors, cached: hasBlob() });
}
