// ── Dividends: pulled automatically, never typed in ───────────────────────────
//
// /api/dividends returns each symbol's dividend history per share, and the app works out
// what this portfolio received from its own transactions: shares held going into each
// ex-date × the cash amount, less the US withholding tax. Editing a buy or a sell
// re-prices every dividend it touches.
//
// The per-share history is also kept in the portfolio file (each holding's `divHistory`,
// so it travels with Drive): the providers only reach back so far — stockanalysis.com
// ~5 years — and a dividend must not drop out of "received" just because it got old or
// a provider went away. Only the per-share facts are stored, never the computed totals.

import { sharesAtDate } from "./pricehistory";

// dates "YYYY-MM-DD"; amount $/share as paid — unless `adj`, when it's restated for every
// split since (stockanalysis), and asPaid() undoes that from the holding's own splits
export type DivEvent = { ex: string; pay: string | null; amount: number; adj?: boolean };
export type DivMap = Record<string, DivEvent[]>;                             // symbol -> events, oldest first

// US tax withheld at source on dividends paid to a Thai resident who has filed a W-8BEN
// (US–Thailand treaty rate). Without the form it's 30% — the broker's statement is the
// final word; this is an estimate.
export const WITHHOLDING = 0.15;

const usDate = (s: string) => { // "MM/DD/YYYY" -> "YYYY-MM-DD", else null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "").trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
const isoDay = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

// Nasdaq /api/quote/{SYM}/dividends → rows of { exOrEffDate, amount:"$0.98", paymentDate, type }.
// Amounts are as paid (NVDA's pre-split 2024 dividend reads $0.04, not $0.004). Returns null
// when Nasdaq has no table for the symbol (non-Nasdaq listings), [] for "no dividends".
export function parseNasdaqDividends(json: any): DivEvent[] | null {
  const rows = json?.data?.dividends?.rows;
  if (!Array.isArray(rows)) return null;
  const out: DivEvent[] = [];
  for (const r of rows) {
    const ex = usDate(r?.exOrEffDate);
    const amount = parseFloat(String(r?.amount || "").replace(/[$,]/g, ""));
    if (!ex || !(amount > 0)) continue;
    if (r?.type && !/cash/i.test(String(r.type))) continue; // stock dividends etc. aren't cash
    out.push({ ex, pay: usDate(r?.paymentDate), amount: r6(amount) });
  }
  return out.sort((a, b) => a.ex.localeCompare(b.ex));
}

// Yahoo v8 chart with events=div|split → { dividends:{ts:{amount,date}}, splits:{ts:{date,numerator,denominator}} }.
// Yahoo's dividend amounts are split-ADJUSTED to today's share count, but the app counts
// shares as they were on each date, so undo every split that came after the ex-date
// (NVDA: $0.004 × 10 = the $0.04 actually paid in March 2024). No payment dates.
export function parseYahooDividends(json: any): DivEvent[] | null {
  const r = json?.chart?.result?.[0];
  if (!r) return null;
  const divs = Object.values(r.events?.dividends || {}) as any[];
  const splits = (Object.values(r.events?.splits || {}) as any[])
    .map(s => ({ t: +s.date, f: (+s.numerator || 0) / (+s.denominator || 0) }))
    .filter(s => Number.isFinite(s.t) && s.f > 0 && Number.isFinite(s.f));
  const out: DivEvent[] = [];
  for (const d of divs) {
    const t = +d?.date, amount = +d?.amount;
    if (!Number.isFinite(t) || !(amount > 0)) continue;
    const later = splits.filter(s => s.t > t).reduce((p, s) => p * s.f, 1);
    // Yahoo rounds the adjusted figure, so the multiplied-back one carries float noise
    // (0.824001) — cash dividends are declared to 4 decimals at most in practice.
    out.push({ ex: isoDay(t), pay: null, amount: later === 1 ? r6(amount) : Math.round(amount * later * 1e4) / 1e4 });
  }
  return out.sort((a, b) => a.ex.localeCompare(b.ex));
}

// stockanalysis.com /api/symbol/{s|e}/{sym}/dividend → data.history[] of { dt, amt:"$0.2747", pay }.
// Answers from datacenter IPs where Yahoo returns 429, and has payment dates, but covers the
// last ~5 years only and its amounts are split-ADJUSTED with no split list alongside — so
// the events are flagged `adj` and converted per holding (asPaid).
export function parseStockAnalysisDividends(json: any): DivEvent[] | null {
  const rows = json?.data?.history;
  if (json?.status !== 200 || !Array.isArray(rows)) return null;
  const out: DivEvent[] = [];
  for (const r of rows) {
    const ex = /^\d{4}-\d{2}-\d{2}$/.test(r?.dt) ? r.dt : null;
    const amount = parseFloat(String(r?.amt || "").replace(/[$,]/g, ""));
    if (!ex || !(amount > 0)) continue;
    out.push({ ex, pay: /^\d{4}-\d{2}-\d{2}$/.test(r?.pay) ? r.pay : null, amount: r6(amount), adj: true });
  }
  return out.sort((a, b) => a.ex.localeCompare(b.ex));
}

// Undo split adjustment for one holding: each split it went through after `t` multiplied
// the share count by (new total ÷ shares just before), and divided a restated dividend by
// the same. Splits after the position was sold out aren't in its history — but then the
// adjusted figure is as good as anything the app could know.
function splitFactorAfter(h: any, t: number): number {
  let f = 1;
  for (const sp of h.splitHistory || []) {
    const st = Date.parse(sp.date), target = parseFloat(sp.ratio) || 0;
    if (!Number.isFinite(st) || st <= t || !(target > 0)) continue;
    const before = sharesAtDate(h, st - 1);
    if (before > 1e-9) f *= target / before;
  }
  return f;
}

// Buying ON the ex-date doesn't earn the dividend; holding at the open does. Counting
// shares at 08:00 UTC on the ex-date (4:00 New York time in summer, 3:00 in winter, before
// pre-market) takes everything traded up to the previous US session — which is the day
// before in Thai time too, since US sessions end at 03:00–04:00 Thai time.
export const exCutoff = (ex: string) => Date.parse(ex + "T08:00:00Z");

// The amount a holding was actually paid per share: split-adjusted figures are converted
// back through the holding's own splits after the ex-date.
const asPaid = (h: any, e: DivEvent): number => e.adj ? r6(e.amount * splitFactorAfter(h, exCutoff(e.ex))) : e.amount;

// A fetched figure replaces a stored one only when it adds something: a payment date the
// stored row lacked, or an amount that really differs (a correction) — not the rounding
// wobble between two providers, which would otherwise rewrite Drive back and forth.
const improves = (stored: DivEvent, fresh: DivEvent) =>
  (!stored.pay && !!fresh.pay) || Math.abs(fresh.amount - stored.amount) > Math.max(1e-6, stored.amount * 0.005);

// Every dividend event for one holding, as paid per share, oldest first: what's stored in
// its divHistory, plus/updated by what was just fetched (announced future ones included).
export function holdingEvents(h: any, fetched?: DivEvent[]): DivEvent[] {
  const byEx = new Map<string, DivEvent>();
  for (const e of h.divHistory || []) if (e?.ex && e.amount > 0) byEx.set(e.ex, { ex: e.ex, pay: e.pay ?? null, amount: +e.amount });
  for (const f of fetched || []) {
    const fresh: DivEvent = { ex: f.ex, pay: f.pay, amount: asPaid(h, f) };
    const stored = byEx.get(f.ex);
    if (!stored || improves(stored, fresh)) byEx.set(f.ex, fresh);
  }
  return [...byEx.values()].sort((a, b) => a.ex.localeCompare(b.ex));
}

// What the holding's divHistory should become after a fetch, or null when nothing changes
// (so a save to Drive happens only when a dividend is actually new or corrected). Keeps
// only dividends already past their ex-date that the holding was entitled to; stored rows
// a provider no longer returns are kept — that is the point of storing them.
export function mergeDivHistory(h: any, fetched: DivEvent[] | undefined, now = Date.now()): DivEvent[] | null {
  if (!fetched) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  const prevEx = new Set((h.divHistory || []).map((e: DivEvent) => e.ex));
  const next = holdingEvents(h, fetched).filter(e => e.ex <= today &&
    (prevEx.has(e.ex) || sharesAtDate(h, exCutoff(e.ex) - 1) > 1e-9));
  const norm = (l: DivEvent[]) => JSON.stringify(l.map(e => [e.ex, e.pay ?? null, e.amount]));
  const prev = [...(h.divHistory || [])].sort((a: DivEvent, b: DivEvent) => a.ex.localeCompare(b.ex));
  return norm(next) === norm(prev) ? null : next;
}

// Union of stored dividend rows from another copy of the portfolio, so pushing this
// device's copy over Drive's never drops rows only Drive had. Matched by holding id.
export function unionDivHistory(base: any[], other: any[]): any[] {
  const theirs = new Map((other || []).map((h: any) => [h.id, h.divHistory || []]));
  return (base || []).map((h: any) => {
    const extra = (theirs.get(h.id) || []).filter((e: DivEvent) => !(h.divHistory || []).some((m: DivEvent) => m.ex === e.ex));
    return extra.length ? { ...h, divHistory: [...(h.divHistory || []), ...extra].sort((a, b) => a.ex.localeCompare(b.ex)) } : h;
  });
}

export type DivRow = {
  symbol: string; ex: string; pay: string | null;
  perShare: number; shares: number; gross: number; net: number;
  status: "paid" | "pending" | "upcoming"; // paid · ex passed, payment still to come · announced, ex ahead
};

// Every dividend this portfolio earned (or has coming), newest first: stored history plus
// what was just fetched. `holdings` should include hidden (deleted) positions — dividends
// they earned before being sold still count.
export function dividendRows(holdings: any[], divs: DivMap, now = Date.now()): DivRow[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const out: DivRow[] = [];
  for (const h of holdings || []) {
    for (const e of holdingEvents(h, divs[h.symbol])) {
      const upcoming = e.ex > today;
      // announced but not yet ex: what the CURRENT holding would collect
      const shares = upcoming ? sharesAtDate(h, now) : sharesAtDate(h, exCutoff(e.ex) - 1);
      if (!(shares > 1e-9)) continue;
      const gross = shares * e.amount;
      out.push({
        symbol: h.symbol, ex: e.ex, pay: e.pay, perShare: e.amount, shares, gross, net: gross * (1 - WITHHOLDING),
        status: upcoming ? "upcoming" : e.pay && e.pay > today ? "pending" : "paid",
      });
    }
  }
  return out.sort((a, b) => b.ex.localeCompare(a.ex) || a.symbol.localeCompare(b.symbol));
}

export type DivSummary = {
  received: number;   // net, everything paid so far
  thisYear: number;   // net, paid in the current calendar year
  last12m: number;    // net, paid in the last 365 days
  coming: number;     // net, ex passed or announced but not paid yet
  forward: number;    // net, next 12 months if the last 12 months' payouts repeat on today's shares
  byYear: { year: string; net: number }[]; // newest first
};

// Totals for the card. "Paid in" uses the payment date when known, else the ex-date.
export function dividendSummary(rows: DivRow[], holdings: any[], divs: DivMap, now = Date.now()): DivSummary {
  const today = new Date(now).toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const yearAgo = new Date(now - 365 * 86400000).toISOString().slice(0, 10);
  let received = 0, thisYear = 0, last12m = 0, coming = 0;
  const byYear: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== "paid") { coming += r.net; continue; }
    const d = r.pay || r.ex;
    received += r.net;
    byYear[d.slice(0, 4)] = (byYear[d.slice(0, 4)] || 0) + r.net;
    if (d.startsWith(year)) thisYear += r.net;
    if (d > yearAgo) last12m += r.net;
  }
  // Trailing-12-month payout per share × shares held now. Holdings are per symbol, but
  // sum by symbol anyway so a duplicated row can't double the per-share rate.
  let forward = 0;
  const seen = new Set<string>();
  for (const h of holdings || []) {
    if (seen.has(h.symbol)) continue;
    seen.add(h.symbol);
    const shares = (holdings || []).filter((x: any) => x.symbol === h.symbol).reduce((s: number, x: any) => s + sharesAtDate(x, now), 0);
    if (!(shares > 1e-9)) continue;
    // per share in TODAY's share terms: an as-paid amount from before a split is divided back
    const ttm = holdingEvents(h, divs[h.symbol]).filter(e => e.ex > yearAgo && e.ex <= today)
      .reduce((s, e) => s + e.amount / splitFactorAfter(h, exCutoff(e.ex)), 0);
    forward += shares * ttm * (1 - WITHHOLDING);
  }
  return {
    received, thisYear, last12m, coming, forward,
    byYear: Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).map(([year, net]) => ({ year, net })),
  };
}

export type DivMonth = {
  ym: string;                 // "YYYY-MM"
  paid: number;               // net received that month
  coming: number;             // net still to come that month (pending + announced)
  items: { symbol: string; net: number; paid: boolean }[]; // per symbol, biggest first
};

// Net dividends per calendar month, by payment date (ex-date when no payment date is known),
// for every month from `fromYm` to `toYm` inclusive — empty months included, so a bar chart
// shows the gaps. Within a month each symbol is summed once per status.
export function monthlyDividends(rows: DivRow[], fromYm: string, toYm: string): DivMonth[] {
  const out: DivMonth[] = [];
  const idx = new Map<string, DivMonth>();
  let [y, m] = fromYm.split("-").map(Number);
  for (let guard = 0; guard < 1200; guard++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > toYm) break;
    const mo: DivMonth = { ym, paid: 0, coming: 0, items: [] };
    out.push(mo); idx.set(ym, mo);
    if (++m > 12) { m = 1; y++; }
  }
  for (const r of rows) {
    const mo = idx.get((r.pay || r.ex).slice(0, 7));
    if (!mo) continue;
    const paid = r.status === "paid";
    if (paid) mo.paid += r.net; else mo.coming += r.net;
    const it = mo.items.find(i => i.symbol === r.symbol && i.paid === paid);
    if (it) it.net += r.net; else mo.items.push({ symbol: r.symbol, net: r.net, paid });
  }
  for (const mo of out) mo.items.sort((a, b) => b.net - a.net);
  return out;
}

// Client cache: dividend histories change at most a few times a year, so each symbol is
// kept for 12 hours in localStorage and only stale/new symbols hit /api/dividends.
const CACHE_KEY = "div-cache-v2"; // v2: events may carry `adj`
const TTL = 12 * 3600 * 1000;

export async function ensureDividends(symbols: string[], force = false): Promise<{ divs: DivMap; errors: Record<string, string> }> {
  let cache: Record<string, { at: number; events: DivEvent[] }> = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch {}
  const now = Date.now();
  const want = [...new Set(symbols.filter(Boolean))];
  const stale = want.filter(s => force || !cache[s] || now - cache[s].at > TTL);
  const errors: Record<string, string> = {};
  for (let i = 0; i < stale.length; i += 15) {
    const batch = stale.slice(i, i + 15);
    try {
      const res = await fetch(`/api/dividends?symbols=${batch.map(encodeURIComponent).join(",")}`, { cache: "no-store" });
      const j = await res.json();
      for (const s of batch) {
        if (Array.isArray(j.results?.[s])) cache[s] = { at: now, events: j.results[s] };
        else errors[s] = j.errors?.[s] || "no data";
      }
    } catch (e: any) { for (const s of batch) errors[s] = e?.message || "fetch failed"; }
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  const divs: DivMap = {};
  for (const s of want) if (cache[s]) divs[s] = cache[s].events; // a failed refresh keeps the older copy
  return { divs, errors };
}
