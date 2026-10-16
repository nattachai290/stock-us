// ── Device ↔ Drive reconciliation ───────────────────────────────────────────────
// Each device keeps its own copy of a portfolio (localStorage) and Drive holds the shared
// one. The app used to trust whichever it touched last: opening the app showed the local
// copy and never asked Drive, so a second device kept showing days-old data; and logging
// in or switching portfolio wrote Drive over the local copy unconditionally, which would
// have destroyed anything a failed save had left only on the device.
//
// Now every portfolio has a per-device stamp: the content hash of the last copy this
// device KNOWS matched Drive (written on every successful save or load). With it, both
// sides can be classified: whichever one still equals the stamp is the one that has NOT
// changed since, so the other one is newer. Without a stamp (a device that last synced
// before stamps existed), the transaction histories decide: a side whose every
// transaction is in the other's, with nothing else differing, is simply older.
// Anything else is a real divergence, and that is the user's call, never a silent overwrite.

type H = Record<string, any>;

// Prices are refreshed by polling and written locally every minute without a Drive save,
// so they are not "edits": compare everything except them.
const VOLATILE = new Set(["currentPrice", "changePct", "priceTime"]);
const HISTORY = ["buyHistory", "realizedHistory", "splitHistory"] as const;
// Per-share dividend history the app fills in by itself (lib/dividends). It's synced like
// anything else, but it's a cache of public facts, not an edit: it must not make one side
// look "not behind" the other and raise a conflict card. Rows only one side has are
// carried over when the other side is pushed (unionDivHistory).
const DERIVED = new Set(["divHistory"]);

const strip = (h: H) => Object.fromEntries(Object.entries(h).filter(([k]) => !VOLATILE.has(k)));
// stable stringify: key order must not make two equal portfolios look different
const stable = (v: any): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
  : JSON.stringify(v);

export function contentKey(holdings: H[]): string {
  return hash(stable([...holdings].map(strip).sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)) || String(a.id).localeCompare(String(b.id)))));
}

// FNV-1a over the string — a fingerprint, not security
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16) + ":" + s.length;
}

// Every transaction as a comparable key (prices excluded — they are not history)
function txSet(holdings: H[]): Set<string> {
  const out = new Set<string>();
  for (const h of holdings) for (const k of HISTORY) for (const e of h[k] ?? [])
    out.add(`${h.symbol}|${k}|${stable(e)}`);
  return out;
}
// Everything about a position that is not history or a price (targets, notes, hidden…)
function metaOf(holdings: H[]): Map<string, string> {
  return new Map(holdings.map(h => [String(h.symbol), stable(Object.fromEntries(
    Object.entries(h).filter(([k]) => !VOLATILE.has(k) && !DERIVED.has(k) && !(HISTORY as readonly string[]).includes(k))))]));
}
const subset = (a: Set<string>, b: Set<string>) => [...a].every(x => b.has(x));
// `older` is strictly behind `newer`: all its transactions are in `newer`, and every
// position it has looks the same in `newer` apart from history.
function behind(older: H[], newer: H[]): boolean {
  if (!subset(txSet(older), txSet(newer))) return false;
  const mn = metaOf(newer);
  for (const [sym, m] of metaOf(older)) if (mn.get(sym) !== m) return false;
  return true;
}

export type SyncDecision = "same" | "pull" | "push" | "conflict";

export function decide(local: H[] | null, drive: H[], stamp: string | null): SyncDecision {
  if (!local) return "pull";
  const lk = contentKey(local), dk = contentKey(drive);
  if (lk === dk) return "same";
  if (stamp) {
    if (lk === stamp) return "pull";   // this device hasn't changed since the last sync
    if (dk === stamp) return "push";   // Drive hasn't — this device has unsaved work
  }
  if (behind(local, drive)) return "pull";
  if (behind(drive, local)) return "push";
  return "conflict";
}

// What the conflict card shows for each side
export function summarize(holdings: H[]): { positions: number; transactions: number; latest: string | null } {
  let transactions = 0, latest: string | null = null;
  for (const h of holdings) for (const k of HISTORY) for (const e of h[k] ?? []) {
    transactions++;
    if (e?.date && (!latest || e.date > latest)) latest = e.date;
  }
  return { positions: holdings.filter(h => !h.hidden).length, transactions, latest };
}
