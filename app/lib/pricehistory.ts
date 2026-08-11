// ── Historical closes: IndexedDB shard cache + /api/history (Vercel Blob) ──────
//
// Closes are sharded by (symbol, year). Past-year shards never change → cached forever
// in IndexedDB, so repeat sessions read them instantly and never re-download. Only the
// current year (and brand-new symbols) hit /api/history, which itself serves shared
// shards from Vercel Blob and only calls Nasdaq for genuinely-missing (symbol, year).

import { getShards, putShards } from "./shardstore";

export type DayMap = Record<string, number>;            // "YYYY-MM-DD" -> close
export type PriceHistory = Record<string, DayMap>;      // symbol -> DayMap

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

// First year each symbol needs closes for (its earliest transaction). Benchmarks passed
// via `extra` inherit the portfolio's global earliest year so they align on the chart.
function firstYears(holdings: any[], extra: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of holdings || []) {
    if (!h.symbol) continue;
    const dates = [...(h.buyHistory || []), ...(h.realizedHistory || []), ...(h.splitHistory || [])]
      .map((e: any) => Date.parse(e.date)).filter(Number.isFinite);
    if (!dates.length) continue;
    const y = new Date(Math.min(...dates)).getUTCFullYear();
    out[h.symbol] = Math.min(out[h.symbol] ?? y, y);
  }
  const globalFirst = Object.values(out).length ? Math.min(...Object.values(out)) : new Date().getUTCFullYear();
  for (const s of extra) if (s) out[s] = Math.min(out[s] ?? globalFirst, globalFirst);
  return out;
}

// Load closes for all held symbols + `extra` benchmarks. Reads shards from IndexedDB,
// fetches only missing past shards + a stale/absent current year via /api/history, stores
// new shards back, and returns the assembled in-memory cache. `force` re-fetches the
// current year even if a recent shard is present.
export async function ensurePrices(
  holdings: any[], extra: string[] = [], force = false
): Promise<{ cache: PriceHistory; errors: Record<string, string> }> {
  const cur = new Date().getUTCFullYear();
  const firstY = firstYears(holdings, extra);
  const symbols = Object.keys(firstY);
  if (!symbols.length) return { cache: {}, errors: {} };

  const keys: string[] = [];
  for (const s of symbols) for (let y = firstY[s]; y <= cur; y++) keys.push(`${s}:${y}`);
  const cached = await getShards(keys);

  // Decide the earliest year to fetch per symbol: any missing shard, or a stale/forced current year.
  const staleDay = dayStr(Date.now() - 4 * 86400000);
  const fetchFrom: Record<string, number> = {};
  for (const s of symbols) {
    let need = Infinity;
    for (let y = firstY[s]; y <= cur; y++) {
      const sh = cached[`${s}:${y}`];
      const staleCur = y === cur && (force || !sh || (Object.keys(sh).sort().pop() || "") < staleDay);
      if (!sh || staleCur) need = Math.min(need, y);
    }
    if (need !== Infinity) fetchFrom[s] = need;
  }

  // Group by fetch-from year → one /api/history call per group (batched by 25 symbols).
  const groups: Record<number, string[]> = {};
  for (const s in fetchFrom) (groups[fetchFrom[s]] ||= []).push(s);

  const errors: Record<string, string> = {};
  const fetched: Record<string, DayMap> = {};      // "SYM:YEAR" -> DayMap
  const today = dayStr(Date.now());
  for (const yStr in groups) {
    const syms = groups[yStr];
    for (let i = 0; i < syms.length; i += 25) {
      const batch = syms.slice(i, i + 25);
      try {
        const res = await fetch(`/api/history?symbols=${batch.join(",")}&from=${yStr}-01-01&to=${today}&t=${Date.now()}`, { cache: "no-store" });
        const j = await res.json();
        for (const s of batch) {
          const dm = j.results?.[s];
          if (dm && Object.keys(dm).length) {
            for (const d in dm) { const y = d.slice(0, 4); (fetched[`${s}:${y}`] ||= {})[d] = dm[d]; }
          } else if (j.errors?.[s]) errors[s] = j.errors[s];
        }
      } catch (e: any) { for (const s of batch) errors[s] = e?.message || "fetch failed"; }
    }
  }

  if (Object.keys(fetched).length) await putShards(fetched);

  const cache: PriceHistory = {};
  const merge = (src: Record<string, DayMap>) => {
    for (const k in src) { const s = k.slice(0, k.indexOf(":")); (cache[s] ||= {}); Object.assign(cache[s], src[k]); }
  };
  merge(cached); merge(fetched); // fetched (fresh current year) overlays cached
  return { cache, errors };
}

// Sorted view of a DayMap for O(log n) lookups. Built once, reused for many queries so
// the search stays fast no matter how many years the symbol carries.
type Sorted = { d: string[]; c: number[] };
function toSorted(days: DayMap | undefined): Sorted {
  if (!days) return { d: [], c: [] };
  const d = Object.keys(days).sort();
  return { d, c: d.map(k => days[k]) };
}
// Close on the trading day at/just before `date` (binary search; weekends/holidays fall
// back to the previous available close).
function closeAt(s: Sorted, date: string): number | null {
  const { d, c } = s;
  let lo = 0, hi = d.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m] <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? c[ans] : null;
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
  const sorted = toSorted(days);

  // Seed at the first point that has both a portfolio value and an index close.
  let i0 = -1, seedClose = 0;
  for (let i = 0; i < points.length; i++) {
    const c = closeAt(sorted, dayStr(points[i].t));
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
      const c = closeAt(sorted, dayStr(f.t));
      if (c && c > 0) spyShares += f.sign * (f.cash / c);
    }
    const c = closeAt(sorted, dayStr(points[i].t));
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
