"use client";
import { useState } from "react";
import { IconClock, IconArrowDown, IconArrowUp, IconSplit } from "./icons";
import { btn, btnGhost } from "../lib/ui";
import ToolsMenu from "./ToolsMenu";

type UnifiedTx = { symbol: string; date: string; kind: "buy"|"sell"|"split"; qty?: number; price?: number; avgCostAtSale?: number; gain?: number; gainPct?: number; ratio?: string; sector: string; fees?: number; grossGain?: number; proceeds?: number; idx: number };

// History tab rewrite (§5.7) — restyled + grouped by month. All the tx-building
// math (allTx, avgCostAtBuy FIFO replay) is moved here verbatim from the old
// inline IIFE in page.tsx; not a single calculation changed.
export default function HistoryTab({
  holdings, pc,
  txFilterSymbol, setTxFilterSymbol,
  showTxImport, setShowTxImport, txImportText, setTxImportText, importTxCSV,
  recalcRealizedFIFO, restoreBackup, makeBackup, setAndSave, msg, computeFromHistory,
  openEditTx, deleteTx,
}: {
  holdings: any[];
  pc: (v: number) => string;
  txFilterSymbol: string;
  setTxFilterSymbol: (s: string) => void;
  showTxImport: boolean;
  setShowTxImport: (v: boolean | ((v: boolean) => boolean)) => void;
  txImportText: string;
  setTxImportText: (s: string) => void;
  importTxCSV: () => void;
  recalcRealizedFIFO: () => void;
  restoreBackup: () => void;
  makeBackup: (label: string) => void;
  setAndSave: (h: any[]) => void;
  msg: (m: string, ms?: number) => void;
  computeFromHistory: (h: any) => { shares: number; avgCost: number };
  openEditTx: (symbol: string, kind: string, idx: number) => void;
  deleteTx: (symbol: string, kind: string, idx: number) => void;
}) {
  const [txKindFilter, setTxKindFilter] = useState<"all"|"buy"|"sell"|"split">("all");

  const allTx: UnifiedTx[] = [];
  holdings.forEach((h: any) => {
    (h.buyHistory||[]).forEach((b:any,i:number) => allTx.push({ symbol:h.symbol, date:b.date, kind:"buy", qty:b.qty, price:b.price, sector:h.sector||"", idx:i }));
    (h.realizedHistory||[]).forEach((r:any,i:number) => allTx.push({ symbol:h.symbol, date:r.date, kind:"sell", qty:r.qty, price:r.sellPrice, avgCostAtSale:r.avgCostAtSale, gain:r.gain, gainPct:r.gainPct, fees:r.fees, grossGain:r.grossGain, proceeds:r.proceeds, sector:h.sector||"", idx:i }));
    (h.splitHistory||[]).forEach((s:any,i:number) => allTx.push({ symbol:h.symbol, date:s.date, kind:"split", ratio:s.ratio, sector:h.sector||"", idx:i }));
  });
  allTx.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Running avgCost after each buy (per symbol, by buyHistory index) — FIFO lots, same as computeFromHistory.
  // Also captures per-split before/after shares for display: splitHistory.ratio stores the
  // TOTAL share count after the split, not a factor, so the 1:N badge needs the replay.
  const avgCostAtBuy: Map<string, number[]> = new Map();
  const splitInfo: Map<string, { before: number; after: number }[]> = new Map();
  holdings.forEach((h:any) => {
    const buys = (h.buyHistory||[]);
    const sells = (h.realizedHistory||[]);
    const splits = (h.splitHistory||[]);
    const events = [
      ...buys.map((b:any,i:number)=>({ date:b.date, type:"buy" as const, qty:b.qty, price:b.price, buyIdx:i, splitIdx:-1, targetShares:0 })),
      ...sells.map((s:any)=>({ date:s.date, type:"sell" as const, qty:s.qty, price:0, buyIdx:-1, splitIdx:-1, targetShares:0 })),
      ...splits.map((sp:any,i:number)=>({ date:sp.date, type:"split" as const, qty:0, price:0, buyIdx:-1, splitIdx:i, targetShares:parseFloat(sp.ratio)||0 })),
    ].sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime());
    const lots: {qty:number,price:number}[] = [];
    const avgArr: number[] = new Array(buys.length).fill(0);
    const splitArr: { before: number; after: number }[] = new Array(splits.length).fill(null).map(()=>({ before: 0, after: 0 }));
    for (const e of events) {
      if (e.type==="buy") {
        lots.push({ qty:e.qty, price:e.price });
        const sh = lots.reduce((s,l)=>s+l.qty,0);
        avgArr[e.buyIdx] = sh>0 ? lots.reduce((s,l)=>s+l.qty*l.price,0)/sh : 0;
      } else if (e.type==="sell") {
        let rem = e.qty;
        while (rem > 1e-12 && lots.length) {
          const take = Math.min(lots[0].qty, rem);
          lots[0].qty -= take; rem -= take;
          if (lots[0].qty <= 1e-12) lots.shift();
        }
      } else if (e.targetShares > 0) {
        const cur = lots.reduce((s,l)=>s+l.qty,0);
        if (e.splitIdx >= 0) splitArr[e.splitIdx] = { before: cur, after: e.targetShares };
        if (cur > 0) { const f = e.targetShares/cur; for (const l of lots) { l.qty *= f; l.price /= f; } }
      }
    }
    avgCostAtBuy.set(h.symbol, avgArr);
    splitInfo.set(h.symbol, splitArr);
  });

  // "1 : 4" for a forward split, "4 : 1" for a reverse split, nice-rounded
  const splitBadge = (before: number, after: number) => {
    if (before <= 0 || after <= 0) return null;
    const f = after / before;
    const nice = (v: number) => Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(2);
    return f >= 1 ? `1 : ${nice(f)}` : `${nice(1 / f)} : 1`;
  };

  const bySymbol = txFilterSymbol==="ALL" || !txFilterSymbol ? allTx : allTx.filter(t=>t.symbol.toUpperCase().includes(txFilterSymbol.toUpperCase()));
  const filteredTx = txKindFilter==="all" ? bySymbol : bySymbol.filter(t=>t.kind===txKindFilter);

  const sellTxAll = bySymbol.filter(t=>t.kind==="sell");
  const winCount = sellTxAll.filter(t=>(t.gain||0)>=0).length;
  const lossCount = sellTxAll.filter(t=>(t.gain||0)<0).length;
  const winRate = sellTxAll.length>0 ? (winCount/sellTxAll.length*100) : 0;
  const buyCount = bySymbol.filter(t=>t.kind==="buy").length;
  const splitCount = bySymbol.filter(t=>t.kind==="split").length;
  const totalRealized = sellTxAll.reduce((s,t)=>s+(t.gain||0),0);
  const txCount = buyCount + sellTxAll.length + splitCount;

  const kindColor = (k:string) => k==="buy"?"var(--gain)":k==="sell"?"var(--loss)":"var(--c4)";
  const kindLabel = (k:string) => k==="buy"?"ซื้อ":k==="sell"?"ขาย":"แตกพาร์";
  const KindIcon = (k:string) => k==="buy"?IconArrowDown:k==="sell"?IconArrowUp:IconSplit;

  // Group by Thai month
  const groups: { label: string; items: UnifiedTx[] }[] = [];
  filteredTx.forEach(t => {
    const label = new Date(t.date).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
    let g = groups.find(g => g.label === label);
    if (!g) { g = { label, items: [] }; groups.push(g); }
    g.items.push(t);
  });

  const clearFilters = () => { setTxFilterSymbol("ALL"); setTxKindFilter("all"); };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ fontSize:16, fontWeight:700, color:"var(--ink)" }}>ประวัติ</div>
        <ToolsMenu items={[
          { label:"Import ประวัติ CSV", onClick:()=>setShowTxImport(v=>!v) },
          { label:"Recalc FIFO", onClick:recalcRealizedFIFO },
          { label:"กู้คืน backup", onClick:restoreBackup },
          { label:"Clear ประวัติ", danger:true, onClick:()=>{
              if(!window.confirm("ลบประวัติ transaction ทั้งหมด?\n(จำนวนหุ้น/ต้นทุนปัจจุบันจะถูกบันทึกไว้ก่อนลบ)")) return;
              makeBackup("Clear ประวัติ");
              const updated = holdings.map((h:any)=>{
                const eff = computeFromHistory(h);
                return { ...h, shares: eff.shares, avgCost: eff.avgCost, buyHistory:[], realizedHistory:[], splitHistory:[] };
              });
              setAndSave(updated); msg("ลบประวัติทั้งหมดแล้ว ✓");
            } },
        ]}/>
      </div>

      {showTxImport&&(
        <div style={{background:"var(--card)",borderRadius:8,padding:16,marginBottom:12,border:"1px solid var(--line)"}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--brass)",marginBottom:6}}>Import ประวัติ ซื้อ/ขาย</div>
          <div style={{fontSize:12,color:"var(--mut)",marginBottom:8}}>Format: <code style={{color:"var(--brass)"}}>DD/MM/YYYY HH:MM,Side(B/S),Symbol,จำนวน,ราคา</code> — เวลาใส่หรือไม่ใส่ก็ได้, <code style={{color:"var(--brass)"}}>BRK.B → BRK-B</code> อัตโนมัติ</div>
          <textarea value={txImportText} onChange={e=>setTxImportText(e.target.value)}
            placeholder={"01/11/2025 21:21,B,ACLS,0.1499694,81.95\n18/06/2026 07:20,S,ACLS,0.0445361,184.12\n02/07/2026 15:03,SPLIT,CRWD,4\n02/07/2026 15:03,+,CRWD,0.5311213,0\n02/07/2026 15:03,-,CRWD,0.1327803"}
            style={{width:"100%",minHeight:140,background:"var(--bg)",color:"var(--ink)",border:"1px solid var(--line)",borderRadius:6,padding:10,fontSize:12,resize:"vertical",fontFamily:"monospace",boxSizing:"border-box"}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={importTxCSV} disabled={!txImportText.trim()} style={btn("var(--brass)","var(--on-brass)",{opacity:!txImportText.trim()?0.5:1})}>นำเข้า</button>
            <button onClick={()=>{setShowTxImport(false);setTxImportText("");}} style={btn("var(--line)","var(--mut)")}>ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Summary card: 3 stats (§5.7) */}
      <div style={{background:"var(--card)",borderRadius:"var(--r-md)",padding:16,marginBottom:12,border:"1px solid var(--line)",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--faint)",marginBottom:4}}>Realized รวม</div>
          <div style={{fontSize:15,fontWeight:700,color:pc(totalRealized)}}>{totalRealized>=0?"+":""}${totalRealized.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--faint)",marginBottom:4}}>Win rate</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--ink)"}}>{winRate.toFixed(0)}% <span style={{fontSize:11,color:"var(--faint)"}}>({winCount}W/{lossCount}L)</span></div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--faint)",marginBottom:4}}>ธุรกรรม</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--ink)"}}>{txCount}</div>
        </div>
      </div>

      {/* Search + kind filter chips */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <input value={txFilterSymbol==="ALL"?"":txFilterSymbol} onChange={e=>setTxFilterSymbol(e.target.value?e.target.value.toUpperCase():"ALL")}
          placeholder="ค้นหา symbol..."
          style={{flex:1,minWidth:140,background:"var(--card)",border:"1px solid var(--line)",borderRadius:8,padding:"8px 12px",color:"var(--ink)",fontSize:13}}/>
        {([["all","ทั้งหมด"],["buy","ซื้อ"],["sell","ขาย"],["split","แตกพาร์"]] as const).map(([key,label])=>(
          <button key={key} onClick={()=>setTxKindFilter(key)}
            style={{fontSize:11,fontWeight:600,padding:"6px 12px",borderRadius:999,cursor:"pointer",border:"none",
              background:txKindFilter===key?"var(--brass)":"var(--card2)", color:txKindFilter===key?"var(--on-brass)":"var(--mut)"}}>
            {label}
          </button>
        ))}
      </div>

      {allTx.length===0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--faint)"}}>
          <IconClock size={28}/>
          <div style={{marginTop:8}}>ยังไม่มีประวัติ</div>
          <button onClick={()=>setShowTxImport(true)} style={{...btnGhost({fontSize:13,marginTop:12})}}>Import ประวัติ CSV</button>
        </div>
      ) : filteredTx.length===0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--faint)"}}>
          <div>ไม่พบธุรกรรมตามเงื่อนไข</div>
          <button onClick={clearFilters} style={{...btnGhost({fontSize:13,marginTop:12})}}>ล้างตัวกรอง</button>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {groups.map(g => (
            <div key={g.label}>
              <div style={{fontSize:11.5,fontWeight:700,color:"var(--faint)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>{g.label}</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {g.items.map((t,i)=>{
                  const Icon = KindIcon(t.kind);
                  return (
                    <div key={i} style={{background:"var(--card)",borderRadius:8,padding:"10px 14px",border:"1px solid var(--line)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{width:26,height:26,borderRadius:8,background:"var(--card2)",display:"flex",alignItems:"center",justifyContent:"center",color:kindColor(t.kind),flexShrink:0}}>
                          <Icon size={14}/>
                        </span>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontWeight:700,color:"var(--ink)",fontSize:13}}>{kindLabel(t.kind)} {t.symbol}</span>
                          </div>
                          <div style={{fontSize:11,color:"var(--faint)"}}>{new Date(t.date).toLocaleDateString("en-GB",{year:"numeric",month:"short",day:"numeric"})} {new Date(t.date).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false})}</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        {t.kind==="split" ? (() => {
                          const info = splitInfo.get(t.symbol)?.[t.idx];
                          const badge = info ? splitBadge(info.before, info.after) : null;
                          return (
                            <div>
                              <span style={{fontSize:13,color:"var(--c4)",fontWeight:600}}>{badge ?? `→ ${parseFloat(t.ratio||"0").toFixed(4)} หุ้น`}</span>
                              {badge && info && <div style={{fontSize:11,color:"var(--mut)"}}>{info.before.toFixed(4)} → {info.after.toFixed(4)} หุ้น</div>}
                            </div>
                          );
                        })() : (
                          <>
                            <div style={{fontSize:13,color:"var(--ink)"}}>{t.qty?.toFixed(4)} หุ้น @ ${t.price?.toFixed(2)}</div>
                            {t.kind==="buy" && (() => { const avg = avgCostAtBuy.get(t.symbol)?.[t.idx]; return avg!=null ? <div style={{fontSize:11,color:"var(--mut)"}}>ทุนเฉลี่ย ${avg.toFixed(2)}</div> : null; })()}
                            {t.kind==="sell" && (
                              <div>
                                <div style={{fontSize:12,fontWeight:700,color:pc(t.gain||0)}}>
                                  {(t.gain||0)>=0?"+":""}${(t.gain||0).toFixed(2)} ({(t.gainPct||0)>=0?"+":""}{(t.gainPct||0).toFixed(1)}%)
                                </div>
                                {t.fees!=null && t.fees>0 && <div style={{fontSize:10,color:"var(--loss)"}}>fee −${t.fees.toFixed(2)}</div>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={()=>openEditTx(t.symbol,t.kind,t.idx)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"var(--faint)",padding:"4px 6px"}} title="แก้ไข">✎</button>
                        <button onClick={()=>deleteTx(t.symbol,t.kind,t.idx)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"var(--loss)",padding:"4px 6px"}} title="ลบ">✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
