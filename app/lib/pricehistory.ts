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

export const BENCHMARK_SYMBOL = "SPY";  // default index for benchmarkSeries()
export const todayStr = () => dayStr(Date.now());

// Selectable index benchmarks (each an ETF Nasdaq's historical API serves). `color`
// is the chart line + chip colour; `dash` its stroke pattern.
export type BenchDef = { sym: string; label: string; color: string; dash: string };
export const BENCHMARK_DEFS: BenchDef[] = [
  { sym: "SPY", label: "S&P 500", color: "#8b93a7", dash: "4 3" },
  { sym: "QQQ", label: "Nasdaq", color: "#6ea8ff", dash: "2 3" },
  { sym: "DIA", label: "Dow Jones", color: "#c79cff", dash: "6 3" },
  { sym: "IWM", label: "Russell 2000", color: "#5fd08a", dash: "1 3" },
];
export const BENCHMARKS = BENCHMARK_DEFS.map(b => b.sym);

// "Same money into S&P 500 over the visible window" counterfactual.
//
// Comparing the portfolio's raw % gain to the index is apples-to-oranges — a portfolio
// grows mostly by CONTRIBUTIONS, not price. Instead the benchmark line starts at the
// SAME value as the portfolio at the window's left edge (prior contributions baked into
// that seed), then applies only the buy/sell cash flows INSIDE the window into SPY. Both
// lines are real dollars starting equal, so their ending gap is a fair, range-aware
// "am I beating the S&P over this period?" — and it re-anchors when the range changes.
export function benchmarkSeries(points: ValuePoint[], holdings: any[], cache: PriceHistory, sym: string = BENCHMARK_SYMBOL): (number | null)[] {
  const days = cache[sym];
  if (!days || !points.length) return points.map(() => null);

  // Seed at the first point that has both a portfolio value and an index close.
  let i0 = -1, seedClose = 0;
  for (let i = 0; i < points.length; i++) {
    const c = closeOnOrBefore(days, dayStr(points[i].t));
    if (points[i].v > 0 && c != null && c > 0) { i0 = i; seedClose = c; break; }
  }
  if (i0 < 0) return points.map(() => null);
  const startT = points[i0].t;

  const flows: { t: number; cash: number; sign: 1 | -1 }[] = [];
  for (const h of holdings || []) {
    for (const b of h.buyHistory || []) {
      const t = Date.parse(b.date), cash = (+b.qty || 0) * (+b.price || 0);
      if (Number.isFinite(t) && t > startT && cash > 0) flows.push({ t, cash, sign: 1 });
    }
    for (const s of h.realizedHistory || []) {
      const t = Date.parse(s.date), cash = (+s.qty || 0) * (+s.sellPrice || 0);
      if (Number.isFinite(t) && t > startT && cash > 0) flows.push({ t, cash, sign: -1 });
    }
  }
  flows.sort((a, b) => a.t - b.t);

  const out: (number | null)[] = points.map(() => null);
  let fi = 0, spyShares = points[i0].v / seedClose; // seed: bench starts on the portfolio line
  for (let i = i0; i < points.length; i++) {
    while (fi < flows.length && flows[fi].t <= points[i].t) {
      const f = flows[fi++];
      const c = closeOnOrBefore(days, dayStr(f.t));
      if (c && c > 0) spyShares += f.sign * (f.cash / c);
    }
    const c = closeOnOrBefore(days, dayStr(points[i].t));
    out[i] = c != null ? Math.max(spyShares, 0) * c : null;
  }
  return out;
}

export type ValuePoint = { t: number; v: number; missing: string[] };

// Portfolio market value on a DENSE daily grid — one point per trading day the cache
// carries (union of every held symbol's close dates), from the first transaction to
// today. A dense line makes short ranges (7/30/90d) meaningful and the curve smooth.
//
// Swept in one ascending pass with per-holding pointers (events + close index), so it
// stays O(days × holdings) instead of re-sorting/scanning inside every cell.
export function portfolioValueSeries(holdings: any[], cache: PriceHistory): ValuePoint[] {
  const hs = holdings || [];

  // Earliest dated transaction — the grid never starts before the portfolio existed.
  let minT = Infinity;
  for (const h of hs) {
    for (const arr of [h.buyHistory, h.realizedHistory, h.splitHistory]) {
      for (const e of arr || []) { const t = Date.parse(e.date); if (Number.isFinite(t) && t < minT) minT = t; }
    }
  }
  if (!Number.isFinite(minT)) return [];
  const minDay = dayStr(minT);
  const today = dayStr(Date.now());

  // Grid = union of all cached close dates >= first transaction, plus today.
  const gridSet = new Set<string>([today]);
  for (const h of hs) {
    const dm = cache[h.symbol];
    if (!dm) continue;
    for (const d in dm) if (d >= minDay) gridSet.add(d);
  }
  const dates = [...gridSet].sort();
  if (dates.length < 2) return [];

  // Per-holding cursors: sorted events (for share count) and sorted (date,close) pairs.
  const cursors = hs.map(h => {
    const events = [
      ...(h.buyHistory || []).map((b: any) => ({ t: Date.parse(b.date), kind: "buy", qty: +b.qty || 0, target: 0 })),
      ...(h.realizedHistory || []).map((s: any) => ({ t: Date.parse(s.date), kind: "sell", qty: +s.qty || 0, target: 0 })),
      ...(h.splitHistory || []).map((sp: any) => ({ t: Date.parse(sp.date), kind: "split", qty: 0, target: parseFloat(sp.ratio) || 0 })),
    ].filter(e => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
    const dm = cache[h.symbol] || {};
    const closeDates = Object.keys(dm).sort();
    return { h, events, ei: 0, shares: 0, closeDates, dm, ci: -1, lastClose: null as number | null };
  });

  const points: ValuePoint[] = [];
  for (const d of dates) {
    const t = Date.parse(d + "T00:00:00Z");
    const isToday = d === today;
    let v = 0;
    const missing: string[] = [];
    for (const c of cursors) {
      while (c.ei < c.events.length && c.events[c.ei].t <= t) {
        const e = c.events[c.ei++];
        if (e.kind === "buy") c.shares += e.qty;
        else if (e.kind === "sell") c.shares -= e.qty;
        else if (e.target > 0) c.shares = e.target;
      }
      if (c.shares <= 0) continue;
      while (c.ci + 1 < c.closeDates.length && c.closeDates[c.ci + 1] <= d) { c.ci++; c.lastClose = c.dm[c.closeDates[c.ci]]; }
      // Today uses the live currentPrice so the line ends on the app's shown total.
      const live = isToday && c.h.currentPrice > 0 ? c.h.currentPrice : null;
      const close = live ?? c.lastClose;
      if (close == null) { missing.push(c.h.symbol); continue; }
      v += Math.max(c.shares, 0) * close;
    }
    points.push({ t, v, missing });
  }
  return points;
}
