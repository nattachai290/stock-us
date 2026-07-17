"use client";
import { IconBars } from "./icons";

// Charts tab rewrite (§5.6) — 3 cards replacing the old recharts pie charts.
// All data comes from activeHoldings only; math is the same per-row math used
// elsewhere (value = shares*currentPrice, weight = value/tv), just aggregated.
const SEGMENT_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];
const OTHER_COLOR = "var(--c6)";

export default function ChartsTab({ activeHoldings, tv, onFilterSector, onOpenDetail }: {
  activeHoldings: any[];
  tv: number;
  onFilterSector: (sector: string) => void;
  onOpenDetail: (id: number) => void;
}) {
  if (activeHoldings.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--faint)" }}>
        <IconBars size={28} />
        <div style={{ marginTop: 8 }}>ยังไม่มีข้อมูลให้แสดง — เพิ่มหุ้นก่อน</div>
      </div>
    );
  }
  // Holdings exist but no prices fetched yet — every weight would divide by zero
  if (tv === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--faint)" }}>
        <IconBars size={28} />
        <div style={{ marginTop: 8 }}>ยังไม่มีราคา — กด "อัพเดทราคา" ในแท็บพอร์ตก่อน</div>
      </div>
    );
  }

  // 1. Sector breakdown
  const sectorMap: Record<string, number> = {};
  activeHoldings.forEach((h: any) => {
    const val = h.shares * h.currentPrice;
    const s = h.sector || "ไม่ระบุ";
    sectorMap[s] = (sectorMap[s] || 0) + val;
  });
  const sectorSorted = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]);
  const topSectors = sectorSorted.slice(0, 5);
  const otherSectorsTotal = sectorSorted.slice(5).reduce((s, [, v]) => s + v, 0);
  const sectorSegments = [
    ...topSectors.map(([name, value], i) => ({ name, value, color: SEGMENT_COLORS[i] })),
    ...(otherSectorsTotal > 0 ? [{ name: "อื่นๆ", value: otherSectorsTotal, color: OTHER_COLOR }] : []),
  ];

  // 2. Top 10 by weight
  const top10 = [...activeHoldings].sort((a: any, b: any) => (b.shares * b.currentPrice) - (a.shares * a.currentPrice)).slice(0, 10);
  const top10Max = top10.length ? top10[0].shares * top10[0].currentPrice : 0;

  // 3. Top movers by P&L %
  const withPP = activeHoldings.filter((h: any) => h.avgCost > 0).map((h: any) => ({ h, pp: (h.currentPrice - h.avgCost) / h.avgCost * 100 }));
  const winners = [...withPP].filter(x => x.pp >= 0).sort((a, b) => b.pp - a.pp).slice(0, 3);
  const losers = [...withPP].filter(x => x.pp < 0).sort((a, b) => a.pp - b.pp).slice(0, 3);
  const maxAbsPP = Math.max(1, ...winners.map(x => x.pp), ...losers.map(x => Math.abs(x.pp)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Sector breakdown */}
      <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>สัดส่วนตาม Sector</div>
        <div style={{ display: "flex", height: 14, borderRadius: 5, overflow: "hidden", gap: 2 }}>
          {sectorSegments.map(seg => (
            <div key={seg.name} style={{ width: `${seg.value / tv * 100}%`, background: seg.color, minWidth: 2 }} title={seg.name} />
          ))}
        </div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {sectorSegments.map(seg => {
            // "อื่นๆ" is an aggregate and "ไม่ระบุ" holdings have sector:"" — neither
            // matches the portfolio-tab query filter, so don't offer tap-to-filter
            const filterable = seg.name !== "อื่นๆ" && seg.name !== "ไม่ระบุ";
            return (
            <div key={seg.name} onClick={() => filterable && onFilterSector(seg.name)}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: filterable ? "pointer" : "default" }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "var(--ink)" }}>{seg.name}</span>
              <span style={{ color: "var(--mut)" }}>${seg.value.toLocaleString("en", { maximumFractionDigits: 0 })}</span>
              <span style={{ color: "var(--faint)", width: 44, textAlign: "right" }}>{(seg.value / tv * 100).toFixed(1)}%</span>
            </div>
            );
          })}
        </div>
      </div>

      {/* Top 10 by weight */}
      <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>Top 10 น้ำหนักพอร์ต</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {top10.map((h: any) => {
            const val = h.shares * h.currentPrice;
            return (
              <div key={h.id} onClick={() => onOpenDetail(h.id)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: "var(--brass)", flexShrink: 0 }}>{h.symbol}</span>
                <span style={{ flex: 1, background: "var(--line)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                  <span style={{ display: "block", width: `${top10Max > 0 ? val / top10Max * 100 : 0}%`, height: "100%", background: "var(--brass)", borderRadius: 3 }} />
                </span>
                <span style={{ fontSize: 12, color: "var(--mut)", width: 44, textAlign: "right", flexShrink: 0 }}>{tv > 0 ? (val / tv * 100).toFixed(1) : "0"}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top movers by P&L % */}
      <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>กำไร/ขาดทุนสูงสุด (P&L %)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...winners, ...losers].map(({ h, pp }) => (
            <div key={h.id} onClick={() => onOpenDetail(h.id)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: "var(--brass)", flexShrink: 0 }}>{h.symbol}</span>
              <span style={{ flex: 1, background: "var(--line)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${Math.abs(pp) / maxAbsPP * 100}%`, height: "100%", background: pp >= 0 ? "var(--gain)" : "var(--loss)", borderRadius: 3 }} />
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: pp >= 0 ? "var(--gain)" : "var(--loss)", width: 56, textAlign: "right", flexShrink: 0 }}>{pp >= 0 ? "+" : ""}{pp.toFixed(1)}%</span>
            </div>
          ))}
          {winners.length === 0 && losers.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>ยังไม่มีข้อมูลต้นทุนให้เทียบ</div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>เฟสถัดไป: กราฟมูลค่าพอร์ตย้อนหลัง (ต้องเริ่มเก็บ snapshot รายวัน)</div>
    </div>
  );
}
