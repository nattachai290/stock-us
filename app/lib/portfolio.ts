// ── portfolio helpers: CSV, clipboard, FIFO lot accounting ────────────────────

export function parseCSV(csvText: string) {
  const lines = csvText.trim().split("\n").filter(l => l.trim());
  if (!lines.length) return [];
  const dataLines = lines[0].toLowerCase().startsWith("symbol") ? lines.slice(1) : lines;
  return dataLines.map((line, i) => {
    const p = line.split(",").map(s => s.trim());
    return {
      id: Date.now() + i + Math.random(),
      symbol: (p[0] || "").toUpperCase(),
      shares: parseFloat(p[1]) || 0,
      avgCost: parseFloat(p[2]) || 0,
      currentPrice: parseFloat(p[3]) || 0,
      sector: p[4] || "",
      note: p[5] || "",
      changePct: null as number | null,
      targetPct: 0,
    };
  }).filter(h => h.symbol && h.symbol.toLowerCase() !== "symbol");
}

export function toCSV(holdings: any[]) {
  return ["symbol,shares,avgCost,currentPrice,sector,note",
    ...holdings.map(h => `${h.symbol},${h.shares},${h.avgCost},${h.currentPrice},${h.sector||""},${h.note||""}`)
  ].join("\n");
}

export function copyToClipboard(text: string) {
  try {
    const el = document.createElement("textarea");
    el.value = text; el.style.cssText = "position:fixed;top:-9999px;opacity:0";
    document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
  } catch { navigator.clipboard?.writeText(text).catch(() => {}); }
}

// FIFO lot accounting (matches broker): sells consume the oldest lots first, so the
// remaining cost basis is the cost of the newest lots — not the running average.
// Splits are NOT baked into buyHistory — they rescale each remaining lot here.
export function replayLots(h: any): { qty: number; price: number }[] {
  const buys = h.buyHistory || [];
  const sells = h.realizedHistory || [];
  const splits = h.splitHistory || [];
  const events = [
    ...buys.map((b:any) => ({ date: b.date, type: "buy", qty: b.qty, price: b.price, targetShares: 0 })),
    ...sells.map((s:any) => ({ date: s.date, type: "sell", qty: s.qty, price: 0, targetShares: 0 })),
    ...splits.map((sp:any) => ({ date: sp.date, type: "split", qty: 0, price: 0, targetShares: parseFloat(sp.ratio) || 0 })),
  ].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const lots: { qty: number; price: number }[] = [];
  for (const e of events) {
    if (e.type === "buy") {
      lots.push({ qty: e.qty, price: e.price });
    } else if (e.type === "sell") {
      let rem = e.qty;
      while (rem > 1e-12 && lots.length) {
        const take = Math.min(lots[0].qty, rem);
        lots[0].qty -= take; rem -= take;
        if (lots[0].qty <= 1e-12) lots.shift();
      }
    } else if (e.targetShares > 0) {
      // split: rescale every remaining lot to the new total; lot cost unchanged
      const cur = lots.reduce((s, l) => s + l.qty, 0);
      if (cur > 0) {
        const f = e.targetShares / cur;
        for (const l of lots) { l.qty *= f; l.price /= f; }
      }
    }
  }
  return lots;
}

// FIFO cost basis per share for selling `qty` from the current lots
export function fifoBasisForSale(h: any, qty: number): number {
  const lots = replayLots(h);
  let rem = qty, cost = 0, got = 0;
  for (const l of lots) {
    const take = Math.min(l.qty, rem);
    cost += take * l.price; got += take; rem -= take;
    if (rem <= 1e-12) break;
  }
  return got > 0 ? cost / got : 0;
}

// Compute effective shares & avgCost from transaction history, fallback to stored fields if no history
export function computeFromHistory(h: any): { shares: number; avgCost: number } {
  const buys = h.buyHistory || [];
  const sells = h.realizedHistory || [];
  if (buys.length === 0 && sells.length === 0) {
    return { shares: h.shares || 0, avgCost: h.avgCost || 0 };
  }
  const lots = replayLots(h);
  const shares = lots.reduce((s, l) => s + l.qty, 0);
  const totalCost = lots.reduce((s, l) => s + l.qty * l.price, 0);
  return { shares: Math.max(shares, 0), avgCost: shares > 0 ? totalCost / shares : 0 };
}

export function formatDDMMYYYY(iso: string): string {
  if (!iso) return "";
  const [datePart, timePart] = iso.split("T");
  const [y,m,d] = datePart.split("-");
  return `${d}/${m}/${y} ${timePart||""}`;
}

// How much of an over-target position can be trimmed, in dollars and shares. The amount is
// capped at the position's unrealized GAIN so trimming only ever realises profit and never
// dips into the original capital: $30 above target with $3 of gain is a $3 sell, not $30.
// Zero when there is no target, no drift above it, or the position is at a loss — there is
// no profit to take then. Shared by the holdings cards, the detail sheet and the filter so
// all three agree on what "แนะนำขาย" means.
// Trim an over-target position down to its target weight. `shares` is how many to sell,
// `proceeds` the cash that returns, and `amount` the profit LOCKED IN by that sale — which
// is exactly how much the position's unrealized gain drops. Only suggested when the
// position is both over target AND in profit (so trimming realises a gain, not a loss).
export function trimSuggestion(h: any, totalValue: number): { amount: number; shares: number; proceeds: number; overAmount: number } {
  const target = h.targetPct || 0;
  const value = h.shares * h.currentPrice;
  const weight = totalValue > 0 ? value / totalValue * 100 : 0;
  const overAmount = target > 0 && weight > target ? (weight - target) / 100 * totalValue : 0;
  const gainPerShare = h.currentPrice - h.avgCost;
  if (overAmount <= 0 || gainPerShare <= 0 || h.currentPrice <= 0) return { amount: 0, shares: 0, proceeds: 0, overAmount };
  const shares = Math.min(h.shares, overAmount / h.currentPrice); // sell down to target weight
  const proceeds = shares * h.currentPrice;
  const amount = shares * gainPerShare;                            // realised gain = unrealized reduction
  return { amount, shares, proceeds, overAmount };
}
