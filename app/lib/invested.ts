// Cumulative invested-capital time series, derived purely from buyHistory.
// Mirrors the hero's "ลงทุนสะสมทั้งหมด" stat: every buy ever made accumulates and
// sells never subtract, so the line always ends at exactly that number.

export type InvestedPoint = { t: number; v: number };

// Entries without buyHistory (imported with a starting basis only) have no dates —
// their shares×avgCost enters as a flat baseline under the whole line. Dated buys
// with an unparseable date fold into the baseline too rather than being dropped.
export function investedSeries(holdings: any[]): InvestedPoint[] {
  let baseline = 0;
  const events: InvestedPoint[] = [];
  for (const h of holdings || []) {
    const buys = h?.buyHistory || [];
    if (!buys.length) { baseline += (h?.shares * h?.avgCost) || 0; continue; }
    for (const b of buys) {
      const amt = (b?.qty * b?.price) || 0;
      if (amt <= 0) continue;
      const t = Date.parse(b?.date);
      if (Number.isFinite(t)) events.push({ t, v: amt });
      else baseline += amt;
    }
  }
  events.sort((a, b) => a.t - b.t);
  let cum = baseline;
  const points: InvestedPoint[] = [];
  for (const e of events) { cum += e.v; points.push({ t: e.t, v: cum }); }
  return points;
}
