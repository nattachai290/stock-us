"use client";

// Mobile card list for the portfolio tab (§5.3). Presentational only — all the
// numbers here are the same per-row math the old table already computed; this
// just renders them as cards instead of table cells, and taps open DetailSheet.
export default function HoldingsList({ holdings, tv, pc, onSelect }: {
  holdings: any[];
  tv: number;
  pc: (v: number) => string;
  onSelect: (id: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {holdings.map((h: any) => {
        const val = h.shares * h.currentPrice;
        const w = tv > 0 ? val / tv * 100 : 0;
        const target = h.targetPct || 0;
        const pp = h.avgCost > 0 ? (h.currentPrice - h.avgCost) / h.avgCost * 100 : 0;
        const isAlert = h.changePct != null && Math.abs(h.changePct) >= 3;
        const isStale = h.priceTime && (Date.now() - h.priceTime > 24 * 3600 * 1000);
        const barPct = target > 0 ? Math.min(w / target * 100, 100) : 0;

        return (
          <div key={h.id} onClick={() => onSelect(h.id)}
            style={{ background: "var(--card)", border: "1px solid var(--line)", borderLeft: isAlert ? "3px solid var(--warn)" : "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "10px 12px", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--brass)" }}>{h.symbol}</span>
                {h.sector && <span style={{ fontSize: 10, color: "var(--mut)", background: "var(--card2)", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>{h.sector}</span>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>${h.currentPrice.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 11, color: "var(--mut)" }}>${val.toLocaleString("en", { maximumFractionDigits: 0 })} · {w.toFixed(1)}%</span>
                {target > 0 && (
                  <span style={{ display: "inline-block", width: 52, height: 3.5, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${barPct}%`, height: "100%", background: "var(--brass)" }} />
                  </span>
                )}
              </div>
              <div style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>
                {isAlert && <span style={{ color: pc(h.changePct), marginRight: 6 }}>วันนี้ {h.changePct > 0 ? "+" : ""}{h.changePct}%</span>}
                <span style={{ color: pc(pp) }}>P&L {pp >= 0 ? "+" : ""}{pp.toFixed(1)}%</span>
              </div>
            </div>

            {isStale && (
              <div style={{ fontSize: 10, color: "var(--warn)", marginTop: 4 }}>
                ⚠ ราคาเมื่อ {new Date(h.priceTime).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" })} — เก่ากว่า 24 ชม.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
