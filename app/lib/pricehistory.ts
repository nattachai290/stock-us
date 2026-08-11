// ── Shared historical-close cache (Drive) + portfolio-value series ────────────
//
// Closing prices for a past (symbol, date) never change, so they're cached once in a
// single Drive file shared by EVERY portfolio: switching ports reuses closes already
// fetched, and only genuinely-missing symbols hit the network. The file lives beside
// the portfolio-*.json files as `pricehistory.json`.

export type DayMap = Record<string, number>;            // "YYYY-MM-DD" -> close
export type PriceHistory = Record<string, DayMap>;      // symbol -> DayMap

const FILE_NAME = "pricehistory.json";

async function driveReq(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return res;
}

// Returns { fileId, data } — fileId null when the cache file doesn't exist yet.
export async function loadPriceHistory(token: string): Promise<{ fileId: string | null; data: PriceHistory }> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and mimeType='application/json' and trashed=false`);
  const res = await driveReq(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, token);
  const list = await res.json();
  const file = list.files?.[0];
  if (!file) return { fileId: null, data: {} };
  const dl = await driveReq(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, token);
  const data = await dl.json().catch(() => ({}));
  return { fileId: file.id, data: data && typeof data === "object" ? data : {} };
}

export async function savePriceHistory(token: string, fileId: string | null, data: PriceHistory): Promise<string> {
  const json = JSON.stringify(data);
  if (fileId) {
    await driveReq(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, token, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: json,
    });
    return fileId;
  }
  const meta = JSON.stringify({ name: FILE_NAME, mimeType: "application/json" });
  const boundary = "pb";
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const res = await driveReq("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", token, {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  return (await res.json()).id;
}

// ── local computation ─────────────────────────────────────────────────────────

const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

// Shares held at time `t` (ms): replays buys/sells/splits chronologically up to t.
// Splits set the running count to their target share number (same rule as the app's
// computeFromHistory), so the count is always in "as-of-t" share terms.
export function sharesAtDate(h: any, t: number): number {
  const events = [
    ...(h.buyHistory || []).map((b: any) => ({ t: Date.parse(b.date), kind: "buy", qty: +b.qty || 0, target: 0 })),
    ...(h.realizedHistory || []).map((s: any) => ({ t: Date.parse(s.date), kind: "sell", qty: +s.qty || 0, target: 0 })),
    ...(h.splitHistory || []).map((sp: any) => ({ t: Date.parse(sp.date), kind: "split", qty: 0, target: parseFloat(sp.ratio) || 0 })),
  ].filter(e => Number.isFinite(e.t) && e.t <= t).sort((a, b) => a.t - b.t);
  let shares = 0;
  for (const e of events) {
    if (e.kind === "buy") shares += e.qty;
    else if (e.kind === "sell") shares -= e.qty;
    else if (e.target > 0) shares = e.target;
  }
  return Math.max(shares, 0);
}

// Symbols + date range each one needs closes for: from its first dated transaction to today.
export function neededRanges(holdings: any[]): { symbol: string; from: string; to: string }[] {
  const today = dayStr(Date.now());
  const out: { symbol: string; from: string; to: string }[] = [];
  for (const h of holdings || []) {
    const dates: number[] = [
      ...(h.buyHistory || []).map((b: any) => Date.parse(b.date)),
      ...(h.realizedHistory || []).map((s: any) => Date.parse(s.date)),
      ...(h.splitHistory || []).map((sp: any) => Date.parse(sp.date)),
    ].filter(Number.isFinite);
    if (!dates.length || !h.symbol) continue;
    out.push({ symbol: h.symbol, from: dayStr(Math.min(...dates)), to: today });
  }
  return out;
}

// A symbol is "covered" if the cache has at least one close on/before its first needed
// date and one within the last ~10 days (so today's tail is present). Cheap heuristic
// to decide whether to skip a re-fetch.
export function isCovered(cache: PriceHistory, symbol: string, from: string): boolean {
  const days = cache[symbol];
  if (!days) return false;
  const keys = Object.keys(days).sort();
  if (!keys.length) return false;
  const recentEnough = Date.parse(keys[keys.length - 1] + "T00:00:00Z") >= Date.now() - 12 * 86400000;
  return keys[0] <= from && recentEnough;
}

// Close for `symbol` on the trading day at/just before `date` (weekends/holidays fall
// back to the previous available close).
function closeOnOrBefore(days: DayMap | undefined, date: string): number | null {
  if (!days) return null;
  if (days[date] != null) return days[date];
  let best: string | null = null;
  for (const d in days) if (d <= date && (best === null || d > best)) best = d;
  return best ? days[best] : null;
}

export const BENCHMARK_SYMBOL = "SPY"; // S&P 500 proxy (Nasdaq serves the ETF)
export const todayStr = () => dayStr(Date.now());

// "Same cash into S&P 500" counterfactual, valued at each point's date.
//
// The portfolio grows mostly by CONTRIBUTIONS, not price, so comparing its raw %
// gain to the index is apples-to-oranges (a portfolio that starts at one $9 buy and
// accumulates more buys shows a meaningless +60000%). Instead we replay the exact
// cash flows — every buy is dollars in, every sell is dollars out — into SPY at that
// day's close, then value the resulting SPY position on each point's date. Both lines
// then represent real dollars, so "am I beating the index with my actual buying
// schedule?" is answered by comparing the two end values.
export function benchmarkSeries(points: ValuePoint[], holdings: any[], cache: PriceHistory, sym: string = BENCHMARK_SYMBOL): (number | null)[] {
  const days = cache[sym];
  if (!days || !points.length) return points.map(() => null);

  const flows: { t: number; cash: number; sign: 1 | -1 }[] = [];
  for (const h of holdings || []) {
    for (const b of h.buyHistory || []) {
      const t = Date.parse(b.date), cash = (+b.qty || 0) * (+b.price || 0);
      if (Number.isFinite(t) && cash > 0) flows.push({ t, cash, sign: 1 });
    }
    for (const s of h.realizedHistory || []) {
      const t = Date.parse(s.date), cash = (+s.qty || 0) * (+s.sellPrice || 0);
      if (Number.isFinite(t) && cash > 0) flows.push({ t, cash, sign: -1 });
    }
  }
  flows.sort((a, b) => a.t - b.t);

  const out: (number | null)[] = [];
  let fi = 0, spyShares = 0;
  for (const p of points) {
    // Apply every cash flow up to this point's date (including any before the visible
    // range, so switching ranges never drops earlier contributions).
    while (fi < flows.length && flows[fi].t <= p.t) {
      const f = flows[fi++];
      const c = closeOnOrBefore(days, dayStr(f.t));
      if (c && c > 0) spyShares += f.sign * (f.cash / c);
    }
    const c = closeOnOrBefore(days, dayStr(p.t));
    out.push(c != null ? Math.max(spyShares, 0) * c : null);
  }
  return out;
}

export type ValuePoint = { t: number; v: number; missing: string[] };

// Portfolio market value at each transaction date (+ today). Each point sums, over every
// holding, sharesAtDate × close-on-or-before-that-date. Symbols with no cached close for
// a point are listed in `missing` so the UI can flag partial coverage.
export function portfolioValueSeries(holdings: any[], cache: PriceHistory): ValuePoint[] {
  const dateSet = new Set<string>();
  for (const h of holdings || []) {
    for (const b of h.buyHistory || []) { const t = Date.parse(b.date); if (Number.isFinite(t)) dateSet.add(dayStr(t)); }
    for (const s of h.realizedHistory || []) { const t = Date.parse(s.date); if (Number.isFinite(t)) dateSet.add(dayStr(t)); }
    for (const sp of h.splitHistory || []) { const t = Date.parse(sp.date); if (Number.isFinite(t)) dateSet.add(dayStr(t)); }
  }
  const todayStr = dayStr(Date.now());
  dateSet.add(todayStr);
  const dates = [...dateSet].sort();

  const points: ValuePoint[] = [];
  for (const d of dates) {
    const t = Date.parse(d + "T00:00:00Z");
    const isToday = d === todayStr;
    let v = 0;
    const missing: string[] = [];
    for (const h of holdings || []) {
      const sh = sharesAtDate(h, t);
      if (sh <= 0) continue;
      // Today's point uses the live currentPrice (the weekly close can lag ~a week),
      // so the chart ends on the same total the rest of the app shows.
      const live = isToday && h.currentPrice > 0 ? h.currentPrice : null;
      const close = live ?? closeOnOrBefore(cache[h.symbol], d);
      if (close == null) { missing.push(h.symbol); continue; }
      v += sh * close;
    }
    points.push({ t, v, missing });
  }
  return points;
}
