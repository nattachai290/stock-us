"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

const PROXY_URL = "/api/price";
const GOOGLE_CLIENT_ID = "45222114320-2r8rh69n1mt4jd4138v90vqq7ha0dgq2.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

// ── helpers ──────────────────────────────────────────────────────────────────
function parseCSV(csvText: string) {
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

function toCSV(holdings: any[]) {
  return ["symbol,shares,avgCost,currentPrice,sector,note",
    ...holdings.map(h => `${h.symbol},${h.shares},${h.avgCost},${h.currentPrice},${h.sector||""},${h.note||""}`)
  ].join("\n");
}

function copyToClipboard(text: string) {
  try {
    const el = document.createElement("textarea");
    el.value = text; el.style.cssText = "position:fixed;top:-9999px;opacity:0";
    document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
  } catch { navigator.clipboard?.writeText(text).catch(() => {}); }
}

// Compute effective shares & avgCost from transaction history (buy/sell/split), fallback to stored fields if no history
// Splits are NOT baked into buyHistory — they are virtual events applied chronologically here
function computeFromHistory(h: any): { shares: number; avgCost: number } {
  const buys = h.buyHistory || [];
  const sells = h.realizedHistory || [];
  const splits = h.splitHistory || [];
  if (buys.length === 0 && sells.length === 0) {
    return { shares: h.shares || 0, avgCost: h.avgCost || 0 };
  }
  const events = [
    ...buys.map((b:any) => ({ date: b.date, type: "buy", qty: b.qty, price: b.price, targetShares: 0 })),
    ...sells.map((s:any) => ({ date: s.date, type: "sell", qty: s.qty, price: 0, targetShares: 0 })),
    ...splits.map((sp:any) => ({ date: sp.date, type: "split", qty: 0, price: 0, targetShares: parseFloat(sp.ratio) || 0 })),
  ].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let shares = 0; let totalCost = 0;
  for (const e of events) {
    if (e.type === "buy") {
      totalCost += e.qty * e.price;
      shares += e.qty;
    } else if (e.type === "sell") {
      const avg = shares > 0 ? totalCost / shares : 0;
      shares -= e.qty;
      totalCost -= e.qty * avg;
    } else {
      // split: set shares to target count, totalCost unchanged → avgCost adjusts automatically
      if (e.targetShares > 0) shares = e.targetShares;
    }
  }
  return { shares: Math.max(shares, 0), avgCost: shares > 0 ? totalCost / shares : 0 };
}

// Date+time picker: separate DD/MM/YYYY fields + 24h time, avoids browser locale issues entirely
function DateTimePicker24h({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  // value is ISO-like "YYYY-MM-DDTHH:mm"
  const [datePart, timePart] = value ? value.split("T") : ["", ""];
  const [y, m, d] = datePart ? datePart.split("-") : ["", "", ""];
  const [hh, mm] = timePart ? timePart.split(":") : ["00", "00"];

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(y ? parseInt(y) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(m ? parseInt(m)-1 : new Date().getMonth()); // 0-indexed
  const [textVal, setTextVal] = useState(d && m && y ? `${d}/${m}/${y} ${hh.padStart(2,"0")}:${mm.padStart(2,"0")}` : "");
  const [inputFocused, setInputFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inputFocused) return; // don't override while user is typing
    if (d && m && y) setTextVal(`${d}/${m}/${y} ${hh.padStart(2,"0")}:${mm.padStart(2,"0")}`);
    else setTextVal("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const monthNames = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const dayNames = ["อา","จ","อ","พ","พฤ","ศ","ส"];

  const handleTextChange = (v: string) => {
    setTextVal(v);
    const match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (match) {
      const [, dd, mo, yr, hr, mi] = match;
      const iso = `${yr}-${mo.padStart(2,"0")}-${dd.padStart(2,"0")}T${hr.padStart(2,"0")}:${mi}`;
      onChange(iso);
      setViewYear(parseInt(yr));
      setViewMonth(parseInt(mo)-1);
    }
  };

  const selectDate = (day: number) => {
    const dd = String(day).padStart(2,"0");
    const mm2 = String(viewMonth+1).padStart(2,"0");
    const iso = `${viewYear}-${mm2}-${dd}T${hh.padStart(2,"0")}:${mm.padStart(2,"0")}`;
    onChange(iso);
  };

  const setTime = (nhh: string, nmm: string) => {
    if (!d) return; // need a date selected first
    const iso = `${y}-${m}-${d}T${(nhh||"00").padStart(2,"0")}:${(nmm||"00").padStart(2,"0")}`;
    onChange(iso);
  };

  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const selectedDay = (y===String(viewYear) && m===String(viewMonth+1).padStart(2,"0")) ? parseInt(d) : null;
  const today = new Date();
  const isToday = (day:number) => viewYear===today.getFullYear() && viewMonth===today.getMonth() && day===today.getDate();

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display:"flex", gap:6 }}>
        <input
          type="text"
          value={textVal}
          onChange={e=>handleTextChange(e.target.value)}
          onFocus={()=>setInputFocused(true)}
          onBlur={()=>{
            setInputFocused(false);
            if (d && m && y) setTextVal(`${d}/${m}/${y} ${hh.padStart(2,"0")}:${mm.padStart(2,"0")}`);
          }}
          placeholder="DD/MM/YYYY HH:mm"
          style={{
            flex:1, background:"#0f1117", border:"1px solid #4a5568", borderRadius:6,
            padding:"10px 12px", color:"#e2e8f0", fontSize:14, boxSizing:"border-box",
            outline:"none", minWidth:0
          }}
        />
        <button onClick={()=>setOpen(!open)} type="button" style={{
          background:"#1a1d2e", border:"1px solid #4a5568", borderRadius:6,
          padding:"10px 12px", color:"#67e8f9", fontSize:14, cursor:"pointer", flexShrink:0
        }}>
          📅{open?"▲":"▼"}
        </button>
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 100,
          background: "#1a1d2e", border: "1px solid #2d3748", borderRadius: 10, padding: 14,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
        }}>
          {/* Month/Year nav */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <button type="button" onClick={()=>{ if(viewMonth===0){setViewMonth(11);setViewYear(viewYear-1);} else setViewMonth(viewMonth-1); }}
              style={{background:"#2d3748",border:"none",borderRadius:5,color:"#e2e8f0",cursor:"pointer",padding:"4px 10px",fontSize:14}}>‹</button>
            <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{monthNames[viewMonth]} {viewYear}</div>
            <button type="button" onClick={()=>{ if(viewMonth===11){setViewMonth(0);setViewYear(viewYear+1);} else setViewMonth(viewMonth+1); }}
              style={{background:"#2d3748",border:"none",borderRadius:5,color:"#e2e8f0",cursor:"pointer",padding:"4px 10px",fontSize:14}}>›</button>
          </div>

          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
            {dayNames.map(dn=>(<div key={dn} style={{textAlign:"center",fontSize:11,color:"#718096",padding:"2px 0"}}>{dn}</div>))}
          </div>

          {/* Day grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:12}}>
            {Array.from({length:firstDayOfWeek}).map((_,i)=>(<div key={`pad-${i}`}/>))}
            {Array.from({length:daysInMonth}).map((_,i)=>{
              const day = i+1;
              const isSelected = selectedDay===day;
              return (
                <button key={day} type="button" onClick={()=>selectDate(day)} style={{
                  background: isSelected?"#2f6b4f":"transparent",
                  border: isToday(day)&&!isSelected?"1px solid #67e8f9":"none",
                  borderRadius: 6, color: isSelected?"#7ee8a2":"#e2e8f0", cursor:"pointer",
                  padding:"6px 0", fontSize:13, fontWeight: isSelected?700:400
                }}>{day}</button>
              );
            })}
          </div>

          {/* Time picker */}
          <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:10,borderTop:"1px solid #2d3748"}}>
            <span style={{fontSize:12,color:"#a0aec0"}}>เวลา</span>
            <select value={hh} onChange={e=>setTime(e.target.value,mm)} disabled={!d}
              style={{background:"#0f1117",border:"1px solid #4a5568",borderRadius:5,color:"#e2e8f0",fontSize:13,padding:"6px 8px"}}>
              {Array.from({length:24}).map((_,i)=>(<option key={i} value={String(i).padStart(2,"0")}>{String(i).padStart(2,"0")}</option>))}
            </select>
            <span style={{color:"#718096"}}>:</span>
            <select value={mm} onChange={e=>setTime(hh,e.target.value)} disabled={!d}
              style={{background:"#0f1117",border:"1px solid #4a5568",borderRadius:5,color:"#e2e8f0",fontSize:13,padding:"6px 8px"}}>
              {Array.from({length:60}).map((_,i)=>(<option key={i} value={String(i).padStart(2,"0")}>{String(i).padStart(2,"0")}</option>))}
            </select>
            <span style={{fontSize:11,color:"#4a5568"}}>(24h)</span>
            <button type="button" onClick={()=>setOpen(false)} style={{marginLeft:"auto",background:"#2f6b4f",border:"none",borderRadius:5,color:"#7ee8a2",cursor:"pointer",padding:"6px 14px",fontSize:12,fontWeight:600}}>เสร็จ</button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDDMMYYYY(iso: string): string {
  if (!iso) return "";
  const [datePart, timePart] = iso.split("T");
  const [y,m,d] = datePart.split("-");
  return `${d}/${m}/${y} ${timePart||""}`;
}


const btn = (bg: string, color: string, extra: any = {}) => ({ background: bg, color, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra } as React.CSSProperties);
const inp = { background: "#0f1117", border: "1px solid #4a5568", borderRadius: 4, color: "#e2e8f0", fontSize: 13, padding: "4px 6px", width: 70 } as React.CSSProperties;


// ── Google Drive ──────────────────────────────────────────────────────────────
// Called when Drive rejects the token (expired/revoked) so the UI can auto-logout.
let onDriveAuthExpired: (() => void) | null = null;

async function driveReq(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!res.ok) {
    // 401 = token expired/invalid. Google tokens (implicit flow) last ~1h with no
    // refresh, so kick the user out to re-login instead of silently failing.
    if (res.status === 401) onDriveAuthExpired?.();
    throw new Error(`Drive ${res.status}`);
  }
  return res;
}

async function listPortfolios(token: string): Promise<{id: string, name: string}[]> {
  const res = await driveReq(`https://www.googleapis.com/drive/v3/files?q=name contains 'portfolio-' and mimeType='application/json' and trashed=false&fields=files(id,name)&orderBy=name`, token);
  const data = await res.json();
  return (data.files || []).map((f: any) => ({ id: f.id, name: f.name.replace("portfolio-","").replace(".json","") }));
}

async function loadPortfolio(token: string, fileId: string): Promise<any[]> {
  const res = await driveReq(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, token);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function savePortfolio(token: string, fileId: string | null, name: string, holdings: any[]): Promise<string> {
  const json = JSON.stringify(holdings, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  if (fileId) {
    await driveReq(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: blob });
    return fileId;
  } else {
    const meta = JSON.stringify({ name: `portfolio-${name}.json`, mimeType: "application/json" });
    const boundary = "pb";
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const res = await driveReq("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", token, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    const created = await res.json();
    return created.id;
  }
}

async function deletePortfolio(token: string, fileId: string) {
  await driveReq(`https://www.googleapis.com/drive/v3/files/${fileId}`, token, { method: "DELETE" });
}

// ── Pie Chart Colors ──────────────────────────────────────────────────────────
const PIE_COLORS = ["#7ee8a2","#63b3ed","#f6c90e","#fc8181","#c084fc","#fb923c","#67e8f9","#86efac","#fca5a5","#93c5fd","#d8b4fe","#fcd34d","#6ee7b7","#a5b4fc","#f9a8d4"];

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [portfolios, setPortfolios] = useState<{id:string,name:string}[]>([]);
  const [currentPortId, setCurrentPortId] = useState<string | null>(null);
  const [currentPortName, setCurrentPortName] = useState("Main");
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPortName, setNewPortName] = useState("");
  const [showNewPort, setShowNewPort] = useState(false);
  const [newStock, setNewStock] = useState({ symbol:"", shares:"", avgCost:"", currentPrice:"", sector:"", note:"", targetPct:"" });
  const [tab, setTab] = useState("portfolio");
  const [editId, setEditId] = useState<number|null>(null);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showTxImport, setShowTxImport] = useState(false);
  const [txImportText, setTxImportText] = useState("");
  const [showAllocImport, setShowAllocImport] = useState(false);
  const [allocText, setAllocText] = useState("");
  const [status, setStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date|null>(null);
  const [priceErrors, setPriceErrors] = useState<string[]>([]);
  const tokenRef = useRef<string|null>(null);
  const [sellModalId, setSellModalId] = useState<number|null>(null);
  const [sellQty, setSellQty] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sellCommission, setSellCommission] = useState("");
  const [sellSecFee, setSellSecFee] = useState("");
  const [sellTafFee, setSellTafFee] = useState("");
  const [sellCatFee, setSellCatFee] = useState("");
  const [sellVat, setSellVat] = useState("");
  const [showFees, setShowFees] = useState(false);
  const [sellDateTime, setSellDateTime] = useState("");
  const [buyDateTime, setBuyDateTime] = useState("");
  const [splitModalId, setSplitModalId] = useState<number|null>(null);
  const [splitRatio, setSplitRatio] = useState("");
  const [splitNewShares, setSplitNewShares] = useState("");
  const [showHistory, setShowHistory] = useState<number|null>(null);
  const [buyModalId, setBuyModalId] = useState<number|null>(null);
  const [buyQty, setBuyQty] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [actionMenuId, setActionMenuId] = useState<number|null>(null);
  const [txFilterSymbol, setTxFilterSymbol] = useState("ALL");
  const [editTxData, setEditTxData] = useState<{symbol:string; kind:string; index:number; date:string; qty:string; price:string; commission:string; vat:string; secFee:string; tafFee:string; catFee:string; ratio:string}|null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const msg = (m: string, ms = 3000) => { setStatus(m); if (ms) setTimeout(() => setStatus(""), ms); };

  // Auto-logout when the Google token expires (Drive returned 401). Guard so the
  // many in-flight Drive calls that all 401 at once only trigger one logout.
  const authExpiredRef = useRef(false);
  const handleAuthExpired = useCallback(() => {
    if (authExpiredRef.current) return;
    authExpiredRef.current = true;
    setToken(null); tokenRef.current = null; setUserEmail(null);
    localStorage.removeItem("gtoken"); localStorage.removeItem("gemail");
    msg("⚠️ Session Google หมดอายุ — ออกให้อัตโนมัติแล้ว กรุณาเชื่อมต่อใหม่", 8000);
  }, []);

  useEffect(() => {
    onDriveAuthExpired = handleAuthExpired;
    return () => { onDriveAuthExpired = null; };
  }, [handleAuthExpired]);

  // Load saved token on mount
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true;
    document.head.appendChild(script);

    // Restore token from localStorage
    const savedToken = localStorage.getItem("gtoken");
    const savedEmail = localStorage.getItem("gemail");
    const savedPortId = localStorage.getItem("currentPortId");
    const savedPortName = localStorage.getItem("currentPortName");
    const savedHoldings = localStorage.getItem(`holdings-${savedPortId||"local"}`);

    if (savedToken) {
      setToken(savedToken); tokenRef.current = savedToken;
      if (savedEmail) setUserEmail(savedEmail);
      if (savedPortId) setCurrentPortId(savedPortId);
      if (savedPortName) setCurrentPortName(savedPortName);
    }
    if (savedHoldings) { try { setHoldings(JSON.parse(savedHoldings)); } catch {} }
    setLoaded(true);

    // Auto-refresh portfolios list if token exists
    if (savedToken) {
      listPortfolios(savedToken).then(setPortfolios).catch(() => {});
    }
  }, []);

  // Lock body scroll when any modal is open
  useEffect(() => {
    const anyOpen = !!(editTxData || actionMenuId !== null || sellModalId !== null);
    document.body.style.overflow = anyOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [editTxData, actionMenuId, sellModalId]);

  // Refresh portfolio list when tab/window regains focus (catches new ports created elsewhere)
  useEffect(() => {
    const refreshOnFocus = () => {
      if (tokenRef.current) {
        listPortfolios(tokenRef.current).then(setPortfolios).catch(() => {});
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshOnFocus(); });
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  const handleGoogleLogin = () => {
    setGoogleLoading(true);
    const client = (window as any).google?.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: SCOPES,
      callback: async (response: any) => {
        if (!response.access_token) { setGoogleLoading(false); return; }
        const t = response.access_token;
        authExpiredRef.current = false; // fresh token — re-arm the expiry guard
        setToken(t); tokenRef.current = t;
        localStorage.setItem("gtoken", t);
        try {
          const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json());
          setUserEmail(info.email);
          localStorage.setItem("gemail", info.email);
          msg("เชื่อมต่อ Google Drive แล้ว กำลังโหลด port...", 0);
          const ports = await listPortfolios(t);
          setPortfolios(ports);
          if (ports.length > 0) {
            const first = ports[0];
            const data = await loadPortfolio(t, first.id);
            setHoldings(data); setCurrentPortId(first.id); setCurrentPortName(first.name);
            localStorage.setItem("currentPortId", first.id);
            localStorage.setItem("currentPortName", first.name);
            localStorage.setItem(`holdings-${first.id}`, JSON.stringify(data));
            msg(`โหลด "${first.name}" แล้ว ${data.length} รายการ ✓`);
          } else {
            msg("เชื่อมต่อแล้ว ยังไม่มี port ใน Drive");
          }
        } catch (e: any) { msg("โหลดไม่ได้: " + e.message); }
        setGoogleLoading(false);
      }
    });
    client?.requestAccessToken();
  };

  const handleLogout = () => {
    setToken(null); tokenRef.current = null; setUserEmail(null);
    localStorage.removeItem("gtoken"); localStorage.removeItem("gemail");
    msg("ออกจาก Google แล้ว");
  };

  const switchPort = async (portId: string, portName: string) => {
    setCurrentPortId(portId); setCurrentPortName(portName);
    localStorage.setItem("currentPortId", portId);
    localStorage.setItem("currentPortName", portName);
    const cached = localStorage.getItem(`holdings-${portId}`);
    if (cached) { setHoldings(JSON.parse(cached)); }
    if (token) {
      msg(`กำลังโหลด "${portName}"...`, 0);
      try {
        const data = await loadPortfolio(token, portId);
        setHoldings(data);
        localStorage.setItem(`holdings-${portId}`, JSON.stringify(data));
        msg(`โหลด "${portName}" แล้ว ✓`);
      } catch (e: any) { msg("โหลดไม่ได้: " + e.message); }
    }
  };

  const createPort = async () => {
    if (!newPortName.trim()) return;
    if (!token) { msg("กรุณา Login ก่อน"); return; }
    try {
      const id = await savePortfolio(token, null, newPortName.trim(), []);
      const newPort = { id, name: newPortName.trim() };
      setPortfolios([...portfolios, newPort]);
      setCurrentPortId(id); setCurrentPortName(newPortName.trim());
      setHoldings([]);
      localStorage.setItem("currentPortId", id);
      localStorage.setItem("currentPortName", newPortName.trim());
      setNewPortName(""); setShowNewPort(false);
      msg(`สร้าง port "${newPortName.trim()}" แล้ว ✓`);
    } catch (e: any) { msg("สร้างไม่ได้: " + e.message); }
  };

  const deletePort = async (portId: string, portName: string) => {
    if (!window.confirm(`ลบ port "${portName}" จาก Drive ด้วยไหม?`)) return;
    if (token) { try { await deletePortfolio(token, portId); } catch {} }
    const remaining = portfolios.filter(p => p.id !== portId);
    setPortfolios(remaining);
    if (currentPortId === portId) {
      if (remaining.length > 0) { switchPort(remaining[0].id, remaining[0].name); }
      else { setCurrentPortId(null); setHoldings([]); }
    }
    msg(`ลบ "${portName}" แล้ว`);
  };

  const saveData = useCallback(async (data: any[], portId = currentPortId, portName = currentPortName) => {
    const key = `holdings-${portId||"local"}`;
    localStorage.setItem(key, JSON.stringify(data));
    if (token && portId) {
      setSaving(true);
      try {
        const newId = await savePortfolio(token, portId, portName, data);
        if (newId !== portId) {
          setCurrentPortId(newId);
          localStorage.setItem("currentPortId", newId);
          setPortfolios(prev => prev.map(p => p.id === portId ? {...p, id: newId} : p));
        }
        msg("Sync Drive แล้ว ✓");
      } catch (e: any) { msg("Sync ไม่ได้: " + e.message); }
      setSaving(false);
    }
  }, [token, currentPortId, currentPortName]);

  const setAndSave = (data: any[]) => { setHoldings(data); saveData(data); };

  const refreshPrices = async () => {
    if (!holdings.length) return;
    setRefreshing(true); setPriceErrors([]); msg("กำลังดึงราคา...", 0);
    try {
      const BATCH = 20; const errors: string[] = []; let updated = [...holdings];
      const totalBatches = Math.ceil(holdings.length / BATCH);
      for (let i = 0; i < holdings.length; i += BATCH) {
        const batchNo = Math.floor(i / BATCH) + 1;
        const batchSymbols = holdings.slice(i, i+BATCH).map((h:any)=>h.symbol);
        msg(`กำลังดึงราคา... (${batchNo}/${totalBatches}) ${batchSymbols.join(", ")}`, 0);
        if (i > 0) await new Promise(r => setTimeout(r, 300)); // space out requests to avoid tripping Yahoo's rate limit
        const syms = batchSymbols.join(",");
        try {
          // Abort a stuck batch instead of freezing the whole refresh forever.
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 30000);
          const res = await fetch(`${PROXY_URL}?symbols=${syms}&t=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
          clearTimeout(timer);
          const data = await res.json();
          if (data.error) { errors.push(`API Error: ${data.error}`); continue; }
          data.results?.forEach((r:any) => {
            if (r.error) errors.push(`${r.symbol}: ${r.error}`);
            else updated = updated.map((h:any) => h.symbol===r.symbol ? {...h, currentPrice:r.price, changePct:r.changePct, priceTime:r.marketTime} : h);
          });
        } catch (e:any) {
          errors.push(`batch ${batchNo}: ${e.name === "AbortError" ? "timeout" : e.message}`);
        }
        // Show prices filling in as each batch lands, instead of waiting for all.
        setHoldings(updated); localStorage.setItem(`holdings-${currentPortId||"local"}`, JSON.stringify(updated));
      }
      setLastUpdated(new Date()); setPriceErrors(errors);
      msg(errors.length ? `⚠️ มี ${errors.length} ตัวพลาด — ดูด้านล่าง` : "อัพเดทราคาแล้ว ✓");
    } catch (e:any) { msg("ดึงราคาไม่ได้: " + e.message); setPriceErrors([e.message]); }
    setRefreshing(false);
  };

  const addHolding = () => {
    if (!newStock.symbol) return;
    const initShares = parseFloat(newStock.shares)||0;
    const initCost = parseFloat(newStock.avgCost)||0;
    const entry = { id: Date.now(), symbol: newStock.symbol.toUpperCase().trim(), shares: initShares, avgCost: initCost, currentPrice: parseFloat(newStock.currentPrice)||0, sector: newStock.sector||"", note: newStock.note||"", changePct: null, targetPct: parseFloat(newStock.targetPct)||0,
      realizedHistory: [] as any[], splitHistory: [] as any[],
      buyHistory: initShares>0 ? [{ date: new Date().toISOString(), qty: initShares, price: initCost, type: "initial" }] : [] as any[] };
    setAndSave([...holdings, entry]);
    setNewStock({ symbol:"", shares:"", avgCost:"", currentPrice:"", sector:"", note:"", targetPct:"" });
    msg("เพิ่มแล้ว ✓");
  };

  const updateH = (id: number, field: string, value: string) => {
    setHoldings(prev => prev.map((h:any) => h.id===id ? {...h, [field]: field==="symbol"?value.toUpperCase():(["shares","avgCost","currentPrice","targetPct"].includes(field)?parseFloat(value)||0:value)} : h));
  };

  const confirmEdit = () => { setEditId(null); saveData(holdings); msg("บันทึกแล้ว ✓"); };
  const removeH = (id: number) => setAndSave(holdings.filter((h:any)=>h.id!==id));

  const openSellModal = (id: number) => {
    setSellModalId(id); setSellQty(""); setSellPrice("");
    setSellCommission(""); setSellSecFee(""); setSellTafFee(""); setSellCatFee(""); setSellVat(""); setShowFees(false);
    setSellDateTime(new Date().toISOString().slice(0,16));
  };

  const calcSellFees = () => {
    const commission = parseFloat(sellCommission)||0;
    const vat = sellVat !== "" ? (parseFloat(sellVat)||0) : commission * 0.07;
    const secFee = parseFloat(sellSecFee)||0;
    const tafFee = parseFloat(sellTafFee)||0;
    const catFee = parseFloat(sellCatFee)||0;
    const totalFees = commission + vat + secFee + tafFee + catFee;
    return { commission, vat, secFee, tafFee, catFee, totalFees };
  };

  const confirmSell = () => {
    const h = holdings.find((x:any)=>x.id===sellModalId);
    if (!h) return;
    const eff = computeFromHistory(h); // use effective shares/avgCost from transaction history
    const qty = parseFloat(sellQty); const price = parseFloat(sellPrice);
    if (!qty || qty<=0 || !price || price<=0) { alert("กรอกจำนวนและราคาให้ถูกต้อง"); return; }
    if (qty > eff.shares) { alert(`มีแค่ ${eff.shares.toFixed(7)} หุ้น ขายไม่ได้เกินจำนวนที่มี`); return; }

    const fees = calcSellFees();
    const grossGain = (price - eff.avgCost) * qty;
    const realizedGain = grossGain - fees.totalFees;
    const realizedPct = eff.avgCost>0 ? (realizedGain/(eff.avgCost*qty)*100) : 0;
    const proceeds = qty * price;
    const txDate = sellDateTime ? new Date(sellDateTime).toISOString() : new Date().toISOString();
    const historyEntry = {
      date: txDate, qty, sellPrice: price, avgCostAtSale: eff.avgCost, proceeds,
      grossGain, fees: fees.totalFees, feeDetail: { commission: fees.commission, vat: fees.vat, secFee: fees.secFee, tafFee: fees.tafFee, catFee: fees.catFee },
      gain: realizedGain, gainPct: realizedPct
    };

    const updated = holdings.map((x:any) => x.id===sellModalId
      ? { ...x, realizedHistory: [...(x.realizedHistory||[]), historyEntry] }
      : x
    );
    setAndSave(updated);
    setSellModalId(null); setSellQty(""); setSellPrice("");
    setSellCommission(""); setSellSecFee(""); setSellTafFee(""); setSellCatFee(""); setSellVat("");
    msg(`ขาย ${qty} หุ้น ${h.symbol} ${realizedGain>=0?"กำไร":"ขาดทุน"} $${Math.abs(realizedGain).toFixed(2)} (หลังหักค่าธรรมเนียม) ✓`);
  };

  const openBuyModal = (id: number) => { setBuyModalId(id); setBuyQty(""); setBuyPrice(""); setBuyDateTime(new Date().toISOString().slice(0,16)); };

  const confirmBuy = () => {
    const h = holdings.find((x:any)=>x.id===buyModalId);
    if (!h) return;
    const qty = parseFloat(buyQty); const price = parseFloat(buyPrice);
    if (!qty || qty<=0 || !price || price<=0) { alert("กรอกจำนวนและราคาให้ถูกต้อง"); return; }

    // Weighted average cost calculation
    const oldValue = h.shares * h.avgCost;
    const newValue = qty * price;
    const newShares = h.shares + qty;
    const newAvgCost = newShares>0 ? (oldValue+newValue)/newShares : price;

    const txDate = buyDateTime ? new Date(buyDateTime).toISOString() : new Date().toISOString();
    const historyEntry = { date: txDate, qty, price, type: "buy" };
    const updated = holdings.map((x:any) => x.id===buyModalId
      ? { ...x, shares: newShares, avgCost: newAvgCost, buyHistory: [...(x.buyHistory||[]), historyEntry] }
      : x
    );
    setAndSave(updated);
    setBuyModalId(null); setBuyQty(""); setBuyPrice("");
    msg(`ซื้อเพิ่ม ${h.symbol} ${qty} หุ้น @ $${price} แล้ว — ต้นทุนเฉลี่ยใหม่ $${newAvgCost.toFixed(4)} ✓`);
  };

  const openSplitModal = (id: number) => { setSplitModalId(id); setSplitRatio(""); setSplitNewShares(""); };

  const confirmSplit = () => {
    const h = holdings.find((x:any)=>x.id===splitModalId);
    if (!h) return;
    const eff = computeFromHistory(h);
    const newSharesCount = parseFloat(splitRatio);
    if (!newSharesCount || newSharesCount <= 0 || newSharesCount === eff.shares) { alert("กรอกจำนวนหุ้นใหม่ให้ถูกต้อง"); return; }
    const updated = holdings.map((x:any) => x.id===splitModalId
      ? { ...x, splitHistory: [...(x.splitHistory||[]), { date: new Date().toISOString(), ratio: newSharesCount.toFixed(7) }] }
      : x
    );
    setAndSave(updated);
    setSplitModalId(null); setSplitRatio("");
    msg(`แตกพาร์ ${h.symbol} แล้ว: ${eff.shares.toFixed(4)} → ${newSharesCount.toFixed(4)} หุ้น ✓`);
  };

  const totalRealized = (h: any) => (h.realizedHistory||[]).reduce((s:number,r:any)=>s+r.gain, 0);

  const openEditTx = (symbol:string, kind:string, index:number) => {
    const h = holdings.find((x:any)=>x.symbol===symbol);
    if (!h) return;
    // Convert UTC ISO to local datetime string for the picker
    const toLocalISO = (iso: string) => {
      const d = new Date(iso);
      const p = (n:number) => String(n).padStart(2,"0");
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    if (kind === "buy") {
      const tx = (h.buyHistory||[])[index];
      setEditTxData({ symbol, kind, index, date: toLocalISO(tx.date), qty: String(tx.qty), price: String(tx.price), commission:"", vat:"", secFee:"", tafFee:"", catFee:"", ratio:"" });
    } else if (kind === "sell") {
      const tx = (h.realizedHistory||[])[index];
      const fd = tx.feeDetail || {};
      setEditTxData({ symbol, kind, index, date: toLocalISO(tx.date), qty: String(tx.qty), price: String(tx.sellPrice), commission: String(fd.commission||0), vat: String(fd.vat||""), secFee: String(fd.secFee||0), tafFee: String(fd.tafFee||0), catFee: String(fd.catFee||0), ratio:"" });
    } else if (kind === "split") {
      const tx = (h.splitHistory||[])[index];
      setEditTxData({ symbol, kind, index, date: toLocalISO(tx.date), qty:"", price:"", commission:"", vat:"", secFee:"", tafFee:"", catFee:"", ratio: tx.ratio });
    }
  };

  const saveEditTx = () => {
    if (!editTxData) return;
    const { symbol, kind, index, date, qty, price, commission, vat: vatStr, secFee, tafFee, catFee, ratio } = editTxData;
    const isoDate = date ? new Date(date).toISOString() : new Date().toISOString();

    // Guard: editing a sell can't exceed the shares available without it.
    if (kind === "sell") {
      const h = holdings.find((x:any)=>x.symbol===symbol);
      const q = parseFloat(qty)||0;
      if (h) {
        const withoutThis = { ...h, realizedHistory: (h.realizedHistory||[]).filter((_:any,i:number)=>i!==index) };
        const avail = computeFromHistory(withoutThis).shares;
        if (q > avail + 1e-9) { alert(`จำนวนไม่พอขาย: มีแค่ ${avail.toFixed(7)} หุ้น (ใส่ ${q.toFixed(7)})`); return; }
      }
    }

    const updated = holdings.map((h:any) => {
      if (h.symbol !== symbol) return h;
      if (kind === "buy") {
        const newBuyHistory = [...(h.buyHistory||[])];
        newBuyHistory[index] = { ...newBuyHistory[index], date: isoDate, qty: parseFloat(qty)||0, price: parseFloat(price)||0 };
        return { ...h, buyHistory: newBuyHistory };
      } else if (kind === "sell") {
        const newRealizedHistory = [...(h.realizedHistory||[])];
        const oldTx = newRealizedHistory[index];
        const q = parseFloat(qty)||0; const p = parseFloat(price)||0;
        const comm = parseFloat(commission)||0; const sec = parseFloat(secFee)||0; const taf = parseFloat(tafFee)||0; const cat = parseFloat(catFee)||0;
        const vat = vatStr !== "" ? (parseFloat(vatStr)||0) : comm*0.07; const totalFees = comm+vat+sec+taf+cat;
        const avgCostAtSale = oldTx.avgCostAtSale;
        const grossGain = (p - avgCostAtSale) * q;
        const gain = grossGain - totalFees;
        const gainPct = avgCostAtSale>0 && q>0 ? (gain/(avgCostAtSale*q)*100) : 0;
        newRealizedHistory[index] = { ...oldTx, date: isoDate, qty: q, sellPrice: p, proceeds: q*p, grossGain, fees: totalFees, feeDetail:{commission:comm,vat,secFee:sec,tafFee:taf,catFee:cat}, gain, gainPct };
        return { ...h, realizedHistory: newRealizedHistory };
      } else if (kind === "split") {
        const newSplitHistory = [...(h.splitHistory||[])];
        newSplitHistory[index] = { ...newSplitHistory[index], date: isoDate, ratio };
        return { ...h, splitHistory: newSplitHistory };
      }
      return h;
    });
    setAndSave(updated);
    setEditTxData(null);
    msg("แก้ไข transaction แล้ว ✓");
  };

  const deleteTx = (symbol:string, kind:string, index:number) => {
    if (!window.confirm(`ลบรายการ ${kind==="buy"?"ซื้อ":kind==="sell"?"ขาย":"แตกพาร์"} นี้?`)) return;
    const updated = holdings.map((h:any) => {
      if (h.symbol !== symbol) return h;
      let newH = { ...h };
      if (kind === "buy") newH.buyHistory = (h.buyHistory||[]).filter((_:any,i:number)=>i!==index);
      if (kind === "sell") newH.realizedHistory = (h.realizedHistory||[]).filter((_:any,i:number)=>i!==index);
      if (kind === "split") newH.splitHistory = (h.splitHistory||[]).filter((_:any,i:number)=>i!==index);

      // If all buy/sell history removed, freeze current computed values into stored fields
      // so the holding doesn't disappear/reset to 0 when displayed via fallback
      if ((newH.buyHistory||[]).length===0 && (newH.realizedHistory||[]).length===0) {
        const lastComputed = computeFromHistory(h); // compute based on the OLD history before this deletion
        newH.shares = lastComputed.shares;
        newH.avgCost = lastComputed.avgCost;
      }
      return newH;
    });
    setAndSave(updated);
    msg("ลบ transaction แล้ว ✓");
  };

  const importCSV = () => {
    try {
      const entries = parseCSV(importText);
      if (!entries.length) { alert("ไม่พบข้อมูล"); return; }
      setAndSave([...holdings, ...entries]);
      setImportText(""); setShowImport(false); msg(`นำเข้า ${entries.length} รายการแล้ว ✓`);
    } catch { alert("Format: SYMBOL,จำนวนหุ้น,ต้นทุน,ราคาปัจจุบัน,กลุ่ม,หมายเหตุ"); }
  };

  const importTxCSV = () => {
    const lines = txImportText.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const dataLines = lines.filter(l=>!/^วันที่|^date/i.test(l));
    if (!dataLines.length) { alert("ไม่พบข้อมูล"); return; }
    let updatedHoldings = holdings.map((h:any)=>({...h}));
    let buyCount=0, sellCount=0, splitCount=0, skipCount=0, insufficientCount=0;
    const pendingSplitOut: Record<string,{qty:number,iso:string}> = {};
    for (const line of dataLines) {
      const parts = line.split(",").map((s:string)=>s.trim());
      if (parts.length < 4) { skipCount++; continue; }
      const [dateStr, side, rawSymbol, qtyStr] = parts;
      const priceStr = parts[4] ?? "";
      // BRK.B → BRK-B (replace dots in ticker with dash)
      const symbol = rawSymbol.toUpperCase().replace(/\./g,"-");
      // Support "DD/MM/YYYY" or "DD/MM/YYYY HH:MM" or "DD/MM/YYYY HH:MM:SS"
      const [datePart, timePart] = dateStr.split(" ");
      const [dd,mm,yyyy] = datePart.split("/");
      if (!dd||!mm||!yyyy||yyyy.length!==4) { skipCount++; continue; }
      const timeStr = timePart ? timePart.slice(0,5) : "12:00";
      const iso = `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}T${timeStr}:00`;
      const qty = parseFloat(qtyStr);
      if (!qty||qty<=0) { skipCount++; continue; }
      const sideUp = side.toUpperCase();
      if (sideUp==="B") {
        const price = parseFloat(priceStr);
        if (!price||price<=0) { skipCount++; continue; }
        const buyEntry = { date:iso, qty, price, type:"import" };
        const idx = updatedHoldings.findIndex((h:any)=>h.symbol===symbol);
        if (idx>=0) {
          updatedHoldings[idx] = { ...updatedHoldings[idx], buyHistory:[...(updatedHoldings[idx].buyHistory||[]),buyEntry] };
        } else {
          updatedHoldings.push({ id:Date.now()+Math.random(), symbol, shares:0, avgCost:0, currentPrice:0, sector:"", note:"", changePct:null, targetPct:0, realizedHistory:[], splitHistory:[], buyHistory:[buyEntry] });
        }
        buyCount++;
      } else if (sideUp==="S") {
        const price = parseFloat(priceStr);
        if (!price||price<=0) { skipCount++; continue; }
        const idx = updatedHoldings.findIndex((h:any)=>h.symbol===symbol);
        if (idx<0) { skipCount++; continue; }
        const eff = computeFromHistory(updatedHoldings[idx]);
        if (qty > eff.shares + 1e-9) { insufficientCount++; continue; } // จำนวนไม่พอขาย
        const avgCostAtSale = eff.avgCost;
        const grossGain = (price-avgCostAtSale)*qty;
        const proceeds = qty*price;
        const sellEntry = { date:iso, qty, sellPrice:price, avgCostAtSale, proceeds, grossGain, fees:0, feeDetail:{commission:0,vat:0,secFee:0,tafFee:0,catFee:0}, gain:grossGain, gainPct:avgCostAtSale>0?(grossGain/(avgCostAtSale*qty)*100):0 };
        updatedHoldings[idx] = { ...updatedHoldings[idx], realizedHistory:[...(updatedHoldings[idx].realizedHistory||[]),sellEntry] };
        sellCount++;
      } else if (sideUp==="-" || sideUp==="SUB") {
        const price = parseFloat(priceStr) || 0;
        if (price <= 0) {
          // No price → buffer as split-out, pair with incoming +
          pendingSplitOut[symbol] = { qty, iso };
        } else {
          // Has price → regular transfer-out at avgCost (zero P&L)
          const idx = updatedHoldings.findIndex((h:any)=>h.symbol===symbol);
          if (idx<0) { skipCount++; continue; }
          const eff = computeFromHistory(updatedHoldings[idx]);
          if (qty > eff.shares + 1e-9) { insufficientCount++; continue; } // จำนวนไม่พอขาย
          const avgCostAtSale = eff.avgCost;
          const sellEntry = { date:iso, qty, sellPrice:avgCostAtSale, avgCostAtSale, proceeds:qty*avgCostAtSale, grossGain:0, fees:0, feeDetail:{commission:0,vat:0,secFee:0,tafFee:0,catFee:0}, gain:0, gainPct:0 };
          updatedHoldings[idx] = { ...updatedHoldings[idx], realizedHistory:[...(updatedHoldings[idx].realizedHistory||[]),sellEntry] };
          sellCount++;
        }
      } else if (sideUp==="+" || sideUp==="ADD") {
        const price = parseFloat(priceStr) || 0;
        const pending = pendingSplitOut[symbol];
        if (price <= 0 && pending) {
          // Pair with buffered -: record split target in splitHistory only, don't touch buyHistory
          delete pendingSplitOut[symbol];
          const idx = updatedHoldings.findIndex((h:any)=>h.symbol===symbol);
          if (idx>=0) {
            const h = updatedHoldings[idx];
            updatedHoldings[idx] = { ...h, splitHistory:[...(h.splitHistory||[]),{date:iso,ratio:qty.toFixed(7)}] };
          }
          splitCount++;
        } else {
          // Has price or no pending - → regular add at given price
          const buyEntry = { date:iso, qty, price, type:"adjustment" };
          const idx = updatedHoldings.findIndex((h:any)=>h.symbol===symbol);
          if (idx>=0) {
            updatedHoldings[idx] = { ...updatedHoldings[idx], buyHistory:[...(updatedHoldings[idx].buyHistory||[]),buyEntry] };
          } else {
            updatedHoldings.push({ id:Date.now()+Math.random(), symbol, shares:0, avgCost:0, currentPrice:0, sector:"", note:"", changePct:null, targetPct:0, realizedHistory:[], splitHistory:[], buyHistory:[buyEntry] });
          }
          buyCount++;
        }
      } else if (sideUp==="SPLIT") {
        const ratio = qty; // column 4 = multiplier (e.g. 4 for 4:1 split)
        const idx = updatedHoldings.findIndex((h:any)=>h.symbol===symbol);
        if (idx<0) { skipCount++; continue; }
        const h = updatedHoldings[idx];
        const eff = computeFromHistory(h);
        const newSharesCount = eff.shares * ratio;
        updatedHoldings[idx] = { ...h, splitHistory: [...(h.splitHistory||[]), { date: iso, ratio: newSharesCount.toFixed(7) }] };
        splitCount++;
      } else { skipCount++; }
    }
    setAndSave(updatedHoldings);
    setTxImportText(""); setShowTxImport(false);
    msg(`นำเข้าแล้ว: ซื้อ ${buyCount} | ขาย ${sellCount}${splitCount>0?` | Split ${splitCount}`:""}${insufficientCount>0?` | จำนวนไม่พอขาย ${insufficientCount}`:""}${skipCount>0?` | ข้าม ${skipCount}`:""} ✓`, insufficientCount>0?6000:3000);
  };

  const exportCSV = () => {
    const blob = new Blob([toCSV(holdings)], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${currentPortName}.csv`; a.click(); URL.revokeObjectURL(url); msg("Export CSV แล้ว ✓");
  };

  const parseAndApplyAllocation = () => {
    const text = allocText; const updates: Record<string, number> = {}; let matched = 0;
    const globalPattern = /\b([A-Z]{1,6}(?:-[A-Z])?)[\s\S]{0,30}?(\d+\.?\d*)%/g;
    let match; const seen = new Set<string>();
    while ((match = globalPattern.exec(text)) !== null) {
      const sym = match[1].toUpperCase(); const pct = parseFloat(match[2]);
      if (!seen.has(sym) && (sym.length >= 2 || ["V","O","U"].includes(sym))) { updates[sym] = pct; seen.add(sym); matched++; }
    }
    if (matched === 0) { alert("ไม่พบข้อมูล %"); return; }
    const updated = holdings.map((h:any) => { const pct = updates[h.symbol]; return pct !== undefined ? {...h, targetPct: pct} : h; });
    const applied = Object.keys(updates).filter(s => holdings.some((h:any)=>h.symbol===s));
    const notFound = Object.keys(updates).filter(s => !holdings.some((h:any)=>h.symbol===s));
    setHoldings(updated); saveData(updated); setAllocText(""); setShowAllocImport(false);
    msg(`ใส่ target % ให้ ${applied.length} ตัวแล้ว ✓${notFound.length>0?` (ไม่เจอ: ${notFound.join(",")})`:"" }`);
  };

  const buildLosersText = (h_list: any[], tv: number) => {
    const losers = [...h_list].filter((h:any)=>h.avgCost>0&&h.currentPrice>0).map((h:any)=>({...h,pp:(h.currentPrice-h.avgCost)/h.avgCost*100})).filter((h:any)=>h.pp<0).sort((a:any,b:any)=>a.pp-b.pp).slice(0,15);
    if (!losers.length) return "\n\n📉 TOP LOSERS: ไม่มีตัวที่ขาดทุน 🎉";
    return "\n\n📉 TOP LOSERS (P&L ติดลบ — วิเคราะห์พื้นฐานแต่ละตัวด้วยว่ายังดีอยู่ไหม):\n" + losers.map((h:any)=>{const val=h.shares*h.currentPrice;const w=tv>0?(val/tv*100).toFixed(1):"0";return `• ${h.symbol.padEnd(6)} | P&L ${h.pp.toFixed(2)}% | ทุน $${h.avgCost} | ราคา $${h.currentPrice} | $${val.toFixed(0)} (${w}%)${h.sector?` | ${h.sector}`:""}`}).join("\n");
  };

  const copyForAnalysis = () => {
    const tv=activeHoldings.reduce((s:number,h:any)=>s+h.shares*h.currentPrice,0); const tc=activeHoldings.reduce((s:number,h:any)=>s+h.shares*h.avgCost,0); const pnl=tv-tc; const pnlPct=tc>0?pnl/tc*100:0;
    const lastUpdate=new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"});
    const rows=[...activeHoldings].sort((a,b)=>(b.shares*b.currentPrice)-(a.shares*a.currentPrice)).map((h:any)=>{const val=h.shares*h.currentPrice;const w=tv>0?(val/tv*100).toFixed(1):"0";const pp=h.avgCost>0&&h.currentPrice>0?((h.currentPrice-h.avgCost)/h.avgCost*100).toFixed(2):"N/A";const ch=h.changePct!=null?` | วันนี้ ${h.changePct>0?"+":""}${h.changePct}%${Math.abs(h.changePct)>=3?" ⚡":""}`:"";return `• ${h.symbol.padEnd(6)} | ${h.shares.toFixed(4)} หุ้น | ทุน $${h.avgCost} | ราคา $${h.currentPrice} | P&L ${pp}%${ch} | $${val.toFixed(0)} (${w}%)${h.sector?` | ${h.sector}`:""}${h.note?` | ${h.note}`:""}`}).join("\n");
    const movers=activeHoldings.filter((h:any)=>h.changePct!=null&&Math.abs(h.changePct)>=3).sort((a:any,b:any)=>Math.abs(b.changePct)-Math.abs(a.changePct)).map((h:any)=>`${h.symbol} ${h.changePct>0?"+":""}${h.changePct}%`).join(", ");
    const losersText=buildLosersText(activeHoldings,tv);
    const p=`คุณคือ Senior Portfolio Manager และ CFA Charterholder วันนี้คือ ${lastUpdate}\n\n## Investment Philosophy\n- Long-term buy & hold หลายปี\n- ขาดทุน ≠ ต้องขาย ถ้าพื้นฐานดียังถือต่อได้\n- เป้าหมาย: หาตัวที่ควรขายจริงๆ เท่านั้น\n\n## กฎ\n1. ห้ามแนะนำขายแค่เพราะ P&L ติดลบ\n2. ขายได้เฉพาะ: business model พัง, moat หายไป, management แย่, valuation bubble\n3. ถ้าไม่มีเหตุผลพื้นฐาน → "ถือต่อ"\n\n## รูปแบบ\n📊 PORTFOLIO OVERVIEW\n🔴 ขายจริงๆ (เหตุผลพื้นฐาน)\n⚠️ เฝ้าระวัง\n✅ TOP LOSERS — วิเคราะห์พื้นฐาน\n\n---\nPORTFOLIO "${currentPortName}" (${activeHoldings.length} positions | $${tv.toFixed(0)} | P&L ${pnl>=0?"+":""}${pnlPct.toFixed(2)}%)\n${movers?`\n🚨 ผิดปกติวันนี้: ${movers}\n`:""}\n${rows}${losersText}\n\n---\nราคาอัพเดท ${lastUpdate} | วิเคราะห์เป็นภาษาไทย`;
    copyToClipboard(p); msg("Copy prompt แล้ว ✓");
  };

  const copyMoversAnalysis = () => {
    const movers=activeHoldings.filter((h:any)=>h.changePct!=null&&Math.abs(h.changePct)>=3).sort((a:any,b:any)=>Math.abs(b.changePct)-Math.abs(a.changePct));
    if (!movers.length) { msg("ไม่มีหุ้นผิดปกติวันนี้ ⚡"); return; }
    const tv=activeHoldings.reduce((s:number,h:any)=>s+h.shares*h.currentPrice,0); const lastUpdate=new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"});
    const rows=movers.map((h:any)=>{const val=h.shares*h.currentPrice;const w=tv>0?(val/tv*100).toFixed(1):"0";const pp=h.avgCost>0?((h.currentPrice-h.avgCost)/h.avgCost*100).toFixed(2):"N/A";return `• ${h.symbol} | ${h.changePct>0?"+":""}${h.changePct}% วันนี้ | ทุน $${h.avgCost} | ราคา $${h.currentPrice} | P&L ${pp}% | $${val.toFixed(0)} (${w}%)${h.sector?` | ${h.sector}`:""}`}).join("\n");
    const losersText=buildLosersText(activeHoldings,tv);
    const p=`คุณคือ Senior Portfolio Manager วันนี้คือ ${lastUpdate}\n\n## Investment Philosophy\n- Long-term buy & hold ไม่ใช่ trader\n- ราคาลงวันเดียว ≠ ต้องขาย\n- ห้ามแนะนำขายแค่เพราะราคาลง\n\n## หุ้นผิดปกติวันนี้ (±3%+) — ค้นข่าวล่าสุดก่อนวิเคราะห์\n${rows}\n\nสำหรับแต่ละตัว:\n🔍 เกิดอะไรขึ้น\n🧠 พื้นฐานเปลี่ยนไหม\n⚡ คำแนะนำ (ถือต่อ/เฝ้าระวัง/ขาย)\n\n---\nวิเคราะห์เป็นภาษาไทย${losersText}`;
    copyToClipboard(p); msg(`Copy ${movers.length} ตัว ⚡ + TOP LOSERS แล้ว ✓`);
  };

  const copyAllocationAnalysis = () => {
    const tv=activeHoldings.reduce((s:number,h:any)=>s+h.shares*h.currentPrice,0); const tc=activeHoldings.reduce((s:number,h:any)=>s+h.shares*h.avgCost,0); const lastUpdate=new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"});
    const rows=[...activeHoldings].sort((a,b)=>(b.shares*b.currentPrice)-(a.shares*a.currentPrice)).map((h:any)=>{const val=h.shares*h.currentPrice;const w=tv>0?(val/tv*100).toFixed(1):"0";const pp=h.avgCost>0&&h.currentPrice>0?((h.currentPrice-h.avgCost)/h.avgCost*100).toFixed(1):"N/A";const target=h.targetPct>0?` | เป้าปัจจุบัน ${h.targetPct}%`:"";return `• ${h.symbol.padEnd(6)} | ${w}% ของ port | P&L ${pp}% | $${val.toFixed(0)}${h.sector?` | ${h.sector}`:""}${target}`}).join("\n");
    const sectors=[...new Set(activeHoldings.map((h:any)=>h.sector).filter(Boolean))].join(", ");
    const p=`คุณคือ Chief Investment Officer (CIO) ที่มีประสบการณ์ 25 ปี วันนี้คือ ${lastUpdate}\n\n## ขั้นตอนที่ 1 — ค้นข้อมูลพื้นฐานก่อนวิเคราะห์\nค้นหาข้อมูลต่อไปนี้ของทุกหลักทรัพย์ก่อน:\n- Revenue & Earnings Growth YoY ล่าสุด\n- Free Cash Flow\n- Moat (pricing power, switching cost, network effect)\n- Valuation P/E, P/S เทียบ peers\n- Debt/Equity\n- Management track record\n- Competitive position\n\n## ภารกิจ\nวิเคราะห์และแนะนำสัดส่วนที่เหมาะสม โดยคิดเหมือนการจัดทัพ\n\n## กฎการจัดทัพ (รวมต้องได้ 100% พอดี)\n- 🏆 แม่ทัพ (5-10%): moat ชัดเจน pricing power สูง — มีแค่ 1 ตัวก็ได้ถ้า conviction สูงพอ\n- ⚔️ รองแม่ทัพ (2-4%): thesis ชัด ความเสี่ยงสูงกว่า Core — ไม่มีขั้นต่ำ\n- 🛡️ ทหารเสริม (0.5-1%): high-risk/thematic — รวมไม่เกิน 15%\n- หลักสำคัญ: จัดตามคุณภาพจริงๆ อย่าฝืน ยิ่ง Core น้อยตัวยิ่งดี\n\n## เกณฑ์ปลดออก (ต้องตรงอย่างน้อย 1 และต้องมีหลักฐาน)\n1. Business model พัง/disrupted ถาวร\n2. Moat หายไป competition ทำลายจนไม่เหลือ\n3. Management แย่/ทุจริต มีหลักฐานชัด\n4. Valuation bubble ไม่มี growth justify\n5. Structural decline ระยะยาว\n\n## กฎเหล็กก่อนปลด (สำคัญมาก)\n- ทุกตัวที่จะปลดตามเกณฑ์ 1-5 ต้องระบุ "พื้นฐานเปลี่ยนจากอะไร → เป็นอะไร" ให้ชัด พร้อมหลักฐาน/ตัวเลข\n- ถ้าพื้นฐานเปลี่ยนแล้ว "ยังดีอยู่/ยังรับได้" → ห้ามปลด ให้ถือต่อ (ปลดได้เฉพาะเมื่อสถานะใหม่แย่จริง)\n- ถ้าระบุ before→after ให้ชัดไม่ได้ = หลักฐานไม่พอ = ห้ามปลด\n\n## ไม่ใช่เหตุผลปลด (เด็ดขาด): P&L ติดลบ, ราคาลงระยะสั้น, สัดส่วนเล็ก/เพิ่งซื้อ, "เจือจางพอร์ต/จำนวนตัวเยอะเกิน" — position เล็กเพราะเพิ่งเริ่มสะสม ไม่ใช่เหตุผลตัด ห้ามปลดหุ้นรายตัวที่พื้นฐานดีเพราะตัวเล็ก ตัดสินที่คุณภาพพื้นฐานเท่านั้น\n\n## ข้อยกเว้นเดียวที่ตัดได้โดยไม่อ้างเกณฑ์ 1-5: ETF ที่ซ้ำซ้อน/overlap กันเอง ยุบรวมเหลือตัวหลักได้ (เช่นเหลือ VOO) — ใช้กับ ETF เท่านั้น ห้ามใช้กับหุ้นรายตัว\n\n## รูปแบบผลลัพธ์\n🏆 แม่ทัพ | ⚔️ รองแม่ทัพ | 🛡️ ทหารเสริม | ❌ ปลดออก (ระบุเกณฑ์ + พื้นฐานเปลี่ยนจาก→เป็น)\n\n## ผลลัพธ์สุดท้าย — TARGET ALLOCATION (วางกลับในเมนู "📥 Paste ผลวิเคราะห์จาก Claude" ได้ทันที)\nปิดท้ายคำตอบด้วยบล็อกนี้ในโค้ดบล็อก เพื่อก๊อปวางในแอปได้เลย — กฎเข้ม ห้ามผิด:\n- 1 บรรทัด = 1 symbol รูปแบบ: SYMBOL | ประเภท | %\n- ต้องครบ ${activeHoldings.length} บรรทัด = ทุกตัวในพอร์ต ห้ามข้ามแม้แต่ตัวเดียว รวมตัวที่แนะนำปลด (ใส่ "ตัดออก | 0%") — ห้ามเขียนตัวที่ปลดไว้แค่ในคำบรรยาย ต้องอยู่ในบล็อกด้วย\n- SYMBOL = ticker จริงตัวเดียวเป๊ะตามพอร์ต ห้ามมีวงเล็บ/คำต่อท้าย/หมายเหตุ (ผิด: "NVDA-สำรอง(NVO)" — ถ้าหมายถึง NVO ให้ขึ้นบรรทัดใหม่ว่า "NVO | ... | ...")\n- ห้ามใส่บรรทัดหัวตาราง (header) และห้าม emoji หรือข้อความอื่นในบรรทัด\n- ผลรวมทุกตัว = 100% พอดี (คิดเลขให้ครบ)\nเช่น:\n\`\`\`\nNVDA | Core | 8%\nLLY | Core | 7%\nINTC | ตัดออก | 0%\nEOSE | ตัดออก | 0%\n\`\`\`\n\n---\nPORTFOLIO "${currentPortName}" (${activeHoldings.length} positions | $${tv.toFixed(0)} | ต้นทุน $${tc.toFixed(0)})\nSectors: ${sectors||"ไม่ระบุ"}\n${rows}\n\n---\nวิเคราะห์พื้นฐานระยะยาว วิเคราะห์เป็นภาษาไทย`;
    copyToClipboard(p); msg("Copy prompt จัดทัพแล้ว — เปิด Web Search แล้ววางใน Claude ✓");
  };

  const copyNewIdeas = () => {
    const tv=activeHoldings.reduce((s:number,h:any)=>s+h.shares*h.currentPrice,0); const lastUpdate=new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"});
    const currentSymbols=activeHoldings.map((h:any)=>h.symbol).join(", ");
    const sectorCount:Record<string,number>={};
    activeHoldings.forEach((h:any)=>{if(h.sector)sectorCount[h.sector]=(sectorCount[h.sector]||0)+1});
    const sectors=Object.entries(sectorCount).sort((a,b)=>b[1]-a[1]).map(([s,c])=>`${s}(${c})`).join(", ");
    const top10=[...activeHoldings].sort((a,b)=>(b.shares*b.currentPrice)-(a.shares*a.currentPrice)).slice(0,10).map((h:any)=>{const w=tv>0?(h.shares*h.currentPrice/tv*100).toFixed(1):"0";return `${h.symbol}(${w}%)`}).join(", ");
    const p=`คุณคือ Senior Equity Research Analyst เชี่ยวชาญ US Stock Market 20 ปี วันนี้คือ ${lastUpdate}\n\n## ภารกิจ\nค้นหาและแนะนำหุ้น US 3-5 ตัว ที่มีพื้นฐานดีและน่าสนใจ ที่ยังไม่มีในพอร์ต\n\n## Port ปัจจุบัน (ห้ามแนะนำซ้ำ)\n- ${activeHoldings.length} หลักทรัพย์ | Top 10: ${top10}\n- Sectors: ${sectors||"ไม่ระบุ"}\n- ห้ามแนะนำ: ${currentSymbols}\n\n## เกณฑ์คัดเลือก (ค้นพื้นฐานล่าสุดก่อน)\n1. Moat ชัดเจน: pricing power, switching cost, network effect\n2. Financials: Revenue growth สม่ำเสมอ, FCF เป็นบวก, Debt จัดการได้\n3. Management: track record ดี, capital allocation ฉลาด\n4. Valuation: ไม่ต้องถูก แต่ต้อง justify growth ได้\n5. Long-term tailwind: megatrend ที่เติบโตระยะยาว\n6. ทุก market cap: small ถึง mega cap ถ้าพื้นฐานดีพอ\n\n## ไม่ต้องการ\n- หุ้นที่มีใน port แล้ว | Turnaround ที่ยังไม่ชัด | Burn cash ไม่มีทางกำไร | Structural decline\n\n## รูปแบบ (3-5 ตัว)\n📌 SYMBOL — ชื่อบริษัท\n🏭 Business: business model\n🏰 Moat: ทำไมถึง moat แข็ง\n📈 Growth: revenue/earnings ล่าสุด\n💰 Valuation: P/E, P/S เทียบ peers\n⚠️ ความเสี่ยง: 1-2 ข้อ\n🎯 เหมาะเป็น: Core/Satellite/Speculative และ % แนะนำ\n\nวิเคราะห์เป็นภาษาไทย ละเอียดแต่กระชับ`;
    copyToClipboard(p); msg("Copy prompt แนะนำหุ้นใหม่แล้ว — เปิด Web Search แล้ววางใน Claude ✓");
  };

  // ── Computed values ────────────────────────────────────────────────────────
  // Apply computed shares/avgCost from transaction history where available
  const effectiveHoldings = holdings.map((h:any) => {
    const computed = computeFromHistory(h);
    return { ...h, shares: computed.shares, avgCost: computed.avgCost };
  });
  // Positions we still hold — fully-sold ones stay in `holdings` for realized P&L
  // but must be excluded from analysis/allocation prompts.
  const activeHoldings = effectiveHoldings.filter((h:any) => h.shares > 0.000001);

  const tv=effectiveHoldings.reduce((s:number,h:any)=>s+h.shares*h.currentPrice,0);
  const tc=holdings.reduce((s:number,h:any)=>s+h.shares*h.avgCost,0);
  const pnl=tv-tc; const pnlPct=tc>0?pnl/tc*100:0;
  const pc=(v:number)=>v>=0?"#7ee8a2":"#ff6b6b";
  const moversCount=activeHoldings.filter((h:any)=>h.changePct!=null&&Math.abs(h.changePct)>=3).length;

  // Realized P&L across all holdings (persists even after fully sold/removed... well, only while holding exists)
  const totalRealizedAll = holdings.reduce((s:number,h:any) => s + (h.realizedHistory||[]).reduce((s2:number,r:any)=>s2+r.gain,0), 0);
  const realizedTxCount = holdings.reduce((s:number,h:any) => s + (h.realizedHistory||[]).length, 0);

  // Pie chart data by sector
  const sectorData = (() => {
    const map: Record<string,number> = {};
    holdings.forEach((h:any) => {
      const val = h.shares * h.currentPrice;
      if (val > 0) { const s = h.sector || "ไม่ระบุ"; map[s] = (map[s]||0) + val; }
    });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([name, value]) => ({ name, value: parseFloat((value/tv*100).toFixed(1)) }));
  })();

  // Top 10 holdings for pie
  const top10Data = [...effectiveHoldings].sort((a,b)=>(b.shares*b.currentPrice)-(a.shares*a.currentPrice)).slice(0,10).map((h:any)=>{
    const val=h.shares*h.currentPrice; return { name: h.symbol, value: parseFloat((val/tv*100).toFixed(1)) };
  });

  if (!loaded) return <div style={{background:"#0f1117",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#7ee8a2"}}>กำลังโหลด...</div>;

  return (
    <div style={{background:"#0f1117",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{background:"#1a1d2e",borderBottom:"1px solid #2d3748",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:"#7ee8a2"}}>📈 PORT AI</div>
          <div style={{fontSize:11,color:"#a0aec0",marginTop:2}}>{holdings.length} หลักทรัพย์ · <span style={{color:saving?"#f6c90e":status?"#f6c90e":"#4a5568"}}>{status||(lastUpdated?`ราคา ${lastUpdated.toLocaleTimeString("th")}`:"พร้อมใช้งาน")}</span></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {userEmail ? (
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:"#7ee8a2"}}>☁️ {userEmail}</span>
              <button onClick={handleLogout} style={btn("#2d3748","#a0aec0",{fontSize:11,padding:"4px 8px"})}>ออก</button>
            </div>
          ) : (
            <button onClick={handleGoogleLogin} disabled={googleLoading} style={btn("#1a3a5f","#63b3ed",{opacity:googleLoading?0.6:1,fontSize:12})}>
              {googleLoading?"⏳ กำลัง Login...":"☁️ Login Google Drive"}
            </button>
          )}
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:20,fontWeight:700,color:"#e2e8f0"}}>${tv.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            <div style={{fontSize:12,color:pc(pnl),fontWeight:600}}>{pnl>=0?"▲":"▼"} {Math.abs(pnlPct).toFixed(2)}% ({pnl>=0?"+":""}${pnl.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})})</div>
            {realizedTxCount>0 && (
              <div style={{fontSize:10,color:"#718096",marginTop:2}}>
                📊 Unreal {pnl>=0?"+":""}${pnl.toFixed(0)} · 📜 Real {totalRealizedAll>=0?"+":""}${totalRealizedAll.toFixed(0)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Portfolio Selector */}
      {userEmail && (
        <div style={{background:"#141720",borderBottom:"1px solid #2d3748",padding:"8px 20px",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:"#718096"}}>Port:</span>
          {portfolios.map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:4}}>
              <button onClick={()=>switchPort(p.id,p.name)}
                style={btn(currentPortId===p.id?"#2f6b4f":"#1e2433", currentPortId===p.id?"#7ee8a2":"#a0aec0",{fontSize:12,padding:"4px 10px"})}>
                {p.name}
              </button>
              {portfolios.length > 1 && <button onClick={()=>deletePort(p.id,p.name)} style={{background:"none",border:"none",color:"#4a5568",cursor:"pointer",fontSize:12}}>✕</button>}
            </div>
          ))}
          {showNewPort ? (
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input value={newPortName} onChange={e=>setNewPortName(e.target.value)} placeholder="ชื่อ port" onKeyDown={e=>e.key==="Enter"&&createPort()}
                style={{background:"#0f1117",border:"1px solid #4a5568",borderRadius:4,color:"#e2e8f0",fontSize:12,padding:"4px 8px",width:120}}/>
              <button onClick={createPort} style={btn("#2f6b4f","#7ee8a2",{fontSize:12,padding:"4px 10px"})}>สร้าง</button>
              <button onClick={()=>setShowNewPort(false)} style={btn("#2d3748","#a0aec0",{fontSize:12,padding:"4px 8px"})}>ยกเลิก</button>
            </div>
          ) : (
            <button onClick={()=>setShowNewPort(true)} style={btn("#1e2433","#718096",{fontSize:12,padding:"4px 10px"})}>+ สร้าง Port ใหม่</button>
          )}
          <button onClick={()=>{ if(token){ msg("กำลังรีเฟรช...",0); listPortfolios(token).then(ps=>{setPortfolios(ps);msg("รีเฟรชแล้ว ✓");}).catch((e:any)=>msg("รีเฟรชไม่ได้: "+e.message)); } }}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#718096",padding:"4px 6px"}} title="รีเฟรชรายการ Port">🔄</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid #2d3748",background:"#1a1d2e"}}>
        {["portfolio","chart","transactions","add"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:"10px 16px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:600,color:tab===t?"#7ee8a2":"#718096",borderBottom:tab===t?"2px solid #7ee8a2":"2px solid transparent",whiteSpace:"nowrap"}}>
            {t==="portfolio"?"📋 รายการ":t==="chart"?"📊 Chart":t==="transactions"?"📜 ประวัติ":"➕ เพิ่ม"}
          </button>
        ))}
      </div>

      {/* Mobile hamburger FAB */}
      {tab==="portfolio"&&<button className="hamburger-fab" onClick={()=>setSidebarOpen(o=>!o)} aria-label="เมนู">{sidebarOpen?"✕":"☰"}</button>}
      {tab==="portfolio"&&sidebarOpen&&<div className="sidebar-overlay" onClick={()=>setSidebarOpen(false)}/>}

      <div className="main-layout" style={{maxWidth:1320,margin:"0 auto"}}>

        {/* ── Right action sidebar ── */}
        <div className={`action-sidebar${sidebarOpen?" open":""}${tab!=="portfolio"?" hidden":""}`}>
          <button className="sidebar-close-btn" onClick={()=>setSidebarOpen(false)}>✕</button>
          <div className="sidebar-section-label">ข้อมูล</div>
          <button onClick={()=>{refreshPrices();setSidebarOpen(false);}} disabled={refreshing||!holdings.length} style={btn("#1e3a5f","#63b3ed",{opacity:refreshing?0.6:1})}>{refreshing?"⏳ ดึงราคา...":"🔄 อัพเดทราคา"}</button>
          <button onClick={async()=>{setSaving(true);msg("Sync...",0);try{await saveData(holdings);}catch(e:any){msg("Sync ไม่ได้: "+e.message);}setSaving(false);setSidebarOpen(false);}} disabled={saving||!holdings.length||!token} style={btn("#1a3a2a","#7ee8a2",{opacity:(!token||saving||!holdings.length)?0.5:1})}>{saving?"⏳ Syncing...":"☁️ Sync → Drive"}</button>
          <button onClick={()=>{setShowImport(v=>!v);setSidebarOpen(false);}} style={btn("#2d3748","#a0aec0")}>📥 Import CSV</button>
          <button onClick={()=>{exportCSV();setSidebarOpen(false);}} style={btn("#2d3748","#a0aec0")}>📤 Export CSV</button>
          <div className="sidebar-section-label">วิเคราะห์ด้วย AI</div>
          <button onClick={()=>{copyForAnalysis();setSidebarOpen(false);}} disabled={!holdings.length} style={btn("#3d2a6b","#c084fc")}>📋 วิเคราะห์ Port</button>
          <button onClick={()=>{copyMoversAnalysis();setSidebarOpen(false);}} disabled={moversCount===0} style={btn("#4a2800","#fb923c",{opacity:moversCount===0?0.4:1})}>⚡ ตัวผิดปกติ ({moversCount})</button>
          <button onClick={()=>{copyAllocationAnalysis();setSidebarOpen(false);}} disabled={!holdings.length} style={btn("#1a3a4a","#67e8f9")}>🎯 จัดทัพ Port</button>
          <button onClick={()=>{setShowAllocImport(v=>!v);setSidebarOpen(false);}} disabled={!holdings.length} style={btn("#1a3a1a","#86efac")}>📥 Paste Target % จาก Claude</button>
          <button onClick={()=>{copyNewIdeas();setSidebarOpen(false);}} disabled={!holdings.length} style={btn("#1a2a3a","#93c5fd")}>💡 แนะนำหุ้นใหม่</button>
          <div className="sidebar-section-label">อื่นๆ</div>
          <button onClick={()=>{if(window.confirm(`ลบทั้งหมด ${holdings.length} รายการ?`)){setAndSave([]);setSidebarOpen(false);}}} disabled={!holdings.length} style={btn("#4a1515","#fc8181")}>🗑️ เคลียข้อมูลทั้งหมด</button>
        </div>

        <div className="content-area">

        {/* PORTFOLIO TAB */}
        {tab==="portfolio"&&(
          <div>

            {showAllocImport&&(
              <div style={{background:"#1a1d2e",borderRadius:8,padding:16,marginBottom:12,border:"1px solid #2f6b4f"}}>
                <div style={{fontSize:13,fontWeight:600,color:"#86efac",marginBottom:6}}>📥 Paste ผลวิเคราะห์จาก Claude</div>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:8}}>รองรับ: <code style={{color:"#67e8f9"}}>SYMBOL | ประเภท | %</code> หรือ table format จาก Claude</div>
                <textarea value={allocText} onChange={e=>setAllocText(e.target.value)} placeholder={"AAPL | Satellite | 0.9%\nNVDA | Core | 6.0%\nOXY | ตัดออก | 0%"} style={{width:"100%",minHeight:160,background:"#0f1117",color:"#e2e8f0",border:"1px solid #2f6b4f",borderRadius:6,padding:10,fontSize:13,resize:"vertical",fontFamily:"monospace"}}/>
                <div style={{display:"flex",gap:8,marginTop:8}}>
                  <button onClick={parseAndApplyAllocation} disabled={!allocText.trim()} style={btn("#2f6b4f","#86efac",{opacity:!allocText.trim()?0.5:1})}>✅ ใส่ Target % ทั้งหมด</button>
                  <button onClick={()=>{setShowAllocImport(false);setAllocText("");}} style={btn("#2d3748","#a0aec0")}>ยกเลิก</button>
                </div>
              </div>
            )}

            {!userEmail&&(
              <div style={{background:"#1a2a1a",border:"1px solid #2d5a2d",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#7ee8a2"}}>
                💡 Login Google Drive เพื่อให้ข้อมูลซิงค์ทุกเครื่อง และรองรับหลาย Portfolio
              </div>
            )}

            {priceErrors.length>0&&(
              <div style={{background:"#2d1515",border:"1px solid #7c2d2d",borderRadius:8,padding:12,marginBottom:12,color:"#fc8181"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>⚠️ ดึงราคาไม่ได้ ({priceErrors.length} ตัว)</div>
                {priceErrors.map((e,i)=><div key={i} style={{fontSize:11,wordBreak:"break-all",marginBottom:2}}>• {e}</div>)}
                <button onClick={()=>setPriceErrors([])} style={{marginTop:8,background:"none",border:"1px solid #7c2d2d",borderRadius:4,color:"#fc8181",fontSize:11,cursor:"pointer",padding:"2px 8px"}}>✕ ปิด</button>
              </div>
            )}

            {showImport&&(
              <div style={{background:"#1a1d2e",borderRadius:8,padding:16,marginBottom:12,border:"1px solid #2d3748"}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:8}}>Format: SYMBOL,จำนวนหุ้น,ต้นทุน,ราคาปัจจุบัน,กลุ่ม,หมายเหตุ</div>
                <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder={"AAPL,100,150.00,175.00,Tech\nTSLA,50,200.00,404.00,EV"} style={{width:"100%",minHeight:100,background:"#0f1117",color:"#e2e8f0",border:"1px solid #4a5568",borderRadius:6,padding:10,fontSize:13,resize:"vertical"}}/>
                <button onClick={importCSV} style={{...btn("#2f6b4f","#7ee8a2"),marginTop:8}}>นำเข้า</button>
              </div>
            )}

            {holdings.length>0 && holdings.some((h:any)=>(h.buyHistory||[]).length>0||(h.realizedHistory||[]).length>0) && (
              <div style={{fontSize:11,color:"#718096",marginBottom:8}}>* จำนวนและต้นทุนคำนวณจากประวัติ 🛒ซื้อ/💰ขาย ใน 📜 ประวัติ (แก้ผ่านปุ่ม ⋮ เท่านั้น)</div>
            )}
            {holdings.length===0?(
              <div style={{textAlign:"center",padding:"40px 20px",color:"#718096"}}><div style={{fontSize:36}}>📂</div><div style={{marginTop:8}}>ยังไม่มีหลักทรัพย์</div></div>
            ):(
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{color:"#cbd5e0",borderBottom:"1px solid #2d3748"}}>
                      {["หลักทรัพย์","จำนวน*","ต้นทุน*","ราคา","วันนี้","P&L %","Realized","Unrealized","มูลค่า ($)","สัดส่วน / เป้า",""].map(h=>(
                        <th key={h} style={{padding:"8px 8px",textAlign:h==="หลักทรัพย์"||h==="สัดส่วน / เป้า"?"left":h===""?"center":"right",fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...effectiveHoldings].filter((h:any)=>h.shares>0.000001).sort((a,b)=>a.symbol.localeCompare(b.symbol)).map((h:any)=>{
                      const val=h.shares*h.currentPrice; const pp=h.avgCost>0?((h.currentPrice-h.avgCost)/h.avgCost*100):0;
                      const realized=(h.realizedHistory||[]).reduce((s:number,r:any)=>s+(r.gain||0),0);
                      const unrealized=h.shares>0?(h.currentPrice-h.avgCost)*h.shares:0;
                      const w=tv>0?(val/tv*100):0; const target=h.targetPct||0;
                      const over=target>0?w-target:0; const overAmt=over>0?(over/100*tv):0;
                      const barPct=target>0?Math.min(w/target*100,150):0;
                      const barColor=over>0?"#ff6b6b":w>0?"#7ee8a2":"#2d3748";
                      const isAlert=h.changePct!=null&&Math.abs(h.changePct)>=3;
                      return (<>
                        <tr key={h.id} style={{borderBottom:"1px solid #1e2433",background:isAlert?"rgba(255,200,0,0.04)":"transparent"}}>
                          <td style={{padding:"8px 8px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:4}}>
                              {isAlert&&<span>⚡</span>}
                              {editId===h.id?<input value={h.symbol} onChange={e=>updateH(h.id,"symbol",e.target.value)} style={inp}/>:<span style={{fontWeight:700,color:"#7ee8a2"}}>{h.symbol}</span>}
                            </div>
                            {h.sector&&<div style={{fontSize:10,color:"#a0aec0"}}>{h.sector}</div>}
                          </td>
                          {["shares","avgCost","currentPrice"].map(f=>(
                            <td key={f} style={{padding:"8px 8px",textAlign:"right",color:"#e2e8f0"}}>
                              {editId===h.id&&f==="currentPrice"?<input type="number" value={h[f]} onChange={e=>updateH(h.id,f,e.target.value)} style={{...inp,width:72}}/>
                              :<span>{f==="shares"?Number(h[f]).toFixed(7):f==="avgCost"?Number(h[f]).toFixed(4):Number(h[f]).toLocaleString()}</span>}
                              {f==="currentPrice"&&h.priceTime&&editId!==h.id&&(
                                <div style={{fontSize:9,color:"#4a5568",whiteSpace:"nowrap"}}>{new Date(h.priceTime).toLocaleString("th-TH",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div>
                              )}
                            </td>
                          ))}
                          <td style={{padding:"8px 8px",textAlign:"right",color:h.changePct==null?"#4a5568":pc(h.changePct),fontWeight:600,fontSize:11}}>
                            {h.changePct==null?"—":`${h.changePct>0?"+":""}${h.changePct}%`}
                          </td>
                          <td style={{padding:"8px 8px",textAlign:"right",color:pc(pp),fontWeight:600}}>{pp>=0?"+":""}{pp.toFixed(2)}%</td>
                          <td style={{padding:"8px 8px",textAlign:"right",color:pc(realized),fontWeight:600,fontSize:11}}>{realized===0?"—":`${realized>=0?"+":""}$${realized.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`}</td>
                          <td style={{padding:"8px 8px",textAlign:"right",color:pc(unrealized),fontWeight:600,fontSize:11}}>{unrealized===0?"—":`${unrealized>=0?"+":""}$${unrealized.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`}</td>
                          <td style={{padding:"8px 8px",textAlign:"right"}}>
                            <div style={{color:"#e2e8f0"}}>${val.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                            {h.avgCost>0&&val>0&&(()=>{const cost=h.shares*h.avgCost;const diff=val-cost;return <div style={{fontSize:10,color:diff>=0?"#7ee8a2":"#ff6b6b",fontWeight:600}}>{diff>=0?"+":""}{diff.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})} ({pp>=0?"+":""}{pp.toFixed(2)}%)</div>;})()}
                          </td>
                          <td style={{padding:"8px 8px",minWidth:150}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                              <span style={{fontSize:11,color:over>0?"#ff6b6b":"#e2e8f0",fontWeight:600}}>{w.toFixed(1)}%</span>
                              {editId===h.id?(
                                <div style={{display:"flex",alignItems:"center",gap:3}}>
                                  <span style={{fontSize:10,color:"#718096"}}>เป้า</span>
                                  <input type="number" value={h.targetPct!=null?h.targetPct:""} placeholder="-" onChange={e=>updateH(h.id,"targetPct",e.target.value)} style={{...inp,width:44,fontSize:11,padding:"2px 4px"}}/>
                                  <span style={{fontSize:10,color:"#718096"}}>%</span>
                                </div>
                              ):h.targetPct===0&&target===0&&holdings.some((x:any)=>x.id===h.id&&typeof x.targetPct==="number"&&x.targetPct===0&&x.targetPct!==undefined)?(
                                <span style={{fontSize:10,color:"#fc8181",fontWeight:600}}>❌ ตัดออก</span>
                              ):target>0?(
                                <span style={{fontSize:10,color:"#718096"}}>/ {target}%</span>
                              ):(
                                <span style={{fontSize:10,color:"#4a5568"}}>ไม่ได้ตั้ง</span>
                              )}
                            </div>
                            {target>0&&<div style={{background:"#2d3748",borderRadius:3,height:4,overflow:"hidden"}}><div style={{width:`${Math.min(barPct,100)}%`,height:"100%",background:barColor,borderRadius:3}}/></div>}
                            {over>0&&<div style={{fontSize:10,color:"#ff6b6b",marginTop:1}}>เกิน +${overAmt.toFixed(2)}</div>}
                          </td>
                          <td style={{padding:"8px 4px",textAlign:"center",whiteSpace:"nowrap"}}>
                            {editId===h.id?(
                              <button onClick={confirmEdit} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#7ee8a2",padding:"2px 4px"}}>✓ บันทึก</button>
                            ):(
                              <button onClick={()=>setActionMenuId(h.id)} style={{background:"#2d3748",border:"none",borderRadius:5,cursor:"pointer",fontSize:14,color:"#a0aec0",padding:"4px 10px"}}>⋮</button>
                            )}
                          </td>
                        </tr>
                      </>);
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* CHART TAB */}
        {tab==="chart"&&(
          <div>
            {tv===0?(
              <div style={{textAlign:"center",padding:"40px 20px",color:"#718096"}}><div style={{fontSize:36}}>📊</div><div style={{marginTop:8}}>กด 🔄 อัพเดทราคาก่อน</div></div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {/* Summary stats */}
                <div style={{background:"#1a1d2e",borderRadius:10,padding:16,border:"1px solid #2d3748",display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {[
                    {label:"มูลค่ารวม",value:`$${tv.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`,color:"#e2e8f0"},
                    {label:"ต้นทุนรวม",value:`$${tc.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`,color:"#a0aec0"},
                    {label:"กำไร/ขาดทุน",value:`${pnl>=0?"+":""}$${pnl.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`,color:pc(pnl)},
                    {label:"Return %",value:`${pnl>=0?"+":""}${pnlPct.toFixed(2)}%`,color:pc(pnl)},
                  ].map(s=>(
                    <div key={s.label} style={{textAlign:"center",padding:"8px 0"}}>
                      <div style={{fontSize:11,color:"#718096",marginBottom:4}}>{s.label}</div>
                      <div style={{fontSize:16,fontWeight:700,color:s.color}}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Realized vs Unrealized */}
                <div style={{background:"#1a1d2e",borderRadius:10,padding:16,border:"1px solid #2d3748"}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:12}}>💵 Realized vs Unrealized P&L</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    <div style={{background:"#0f1117",borderRadius:8,padding:14,textAlign:"center"}}>
                      <div style={{fontSize:11,color:"#718096",marginBottom:6}}>📜 Realized (ขายแล้ว)</div>
                      <div style={{fontSize:18,fontWeight:700,color:pc(totalRealizedAll)}}>{totalRealizedAll>=0?"+":""}${totalRealizedAll.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                      <div style={{fontSize:11,color:"#718096",marginTop:4}}>{realizedTxCount} รายการขาย</div>
                    </div>
                    <div style={{background:"#0f1117",borderRadius:8,padding:14,textAlign:"center"}}>
                      <div style={{fontSize:11,color:"#718096",marginBottom:6}}>📊 Unrealized (ถืออยู่)</div>
                      <div style={{fontSize:18,fontWeight:700,color:pc(pnl)}}>{pnl>=0?"+":""}${pnl.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                      <div style={{fontSize:11,color:"#718096",marginTop:4}}>{holdings.length} หลักทรัพย์</div>
                    </div>
                  </div>
                  <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #2d3748",display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700}}>
                    <span style={{color:"#a0aec0"}}>รวมกำไร/ขาดทุนทั้งหมด</span>
                    <span style={{color:pc(totalRealizedAll+pnl)}}>{(totalRealizedAll+pnl)>=0?"+":""}${(totalRealizedAll+pnl).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                  </div>
                </div>

                {/* Top 10 Pie with legend */}
                <div style={{background:"#1a1d2e",borderRadius:10,padding:16,border:"1px solid #2d3748"}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:12}}>🏆 Top 10 Holdings</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={top10Data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={40}>
                        {top10Data.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                      </Pie>
                      <Tooltip formatter={(v:any)=>`${v}%`} contentStyle={{background:"#1a1d2e",border:"1px solid #2d3748",borderRadius:6,color:"#e2e8f0",fontSize:12}}/>
                      <Legend formatter={(value)=>value} wrapperStyle={{fontSize:11,color:"#a0aec0"}}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Top 10 bar list */}
                <div style={{background:"#1a1d2e",borderRadius:10,padding:16,border:"1px solid #2d3748"}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:12}}>📋 Top 10 รายละเอียด</div>
                  {top10Data.map((d,i)=>(
                    <div key={d.name} style={{marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                        <span style={{fontSize:13,fontWeight:600,color:PIE_COLORS[i%PIE_COLORS.length]}}>{d.name}</span>
                        <span style={{fontSize:13,color:"#e2e8f0"}}>{d.value}%</span>
                      </div>
                      <div style={{background:"#2d3748",borderRadius:4,height:6}}>
                        <div style={{width:`${Math.min(d.value/top10Data[0].value*100,100)}%`,height:"100%",background:PIE_COLORS[i%PIE_COLORS.length],borderRadius:4}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TRANSACTIONS TAB */}
        {tab==="transactions"&&(()=>{
          type UnifiedTx = { symbol: string; date: string; kind: "buy"|"sell"|"split"; qty?: number; price?: number; avgCostAtSale?: number; gain?: number; gainPct?: number; ratio?: string; sector: string; fees?: number; grossGain?: number; proceeds?: number; idx: number };
          const allTx: UnifiedTx[] = [];

          holdings.forEach((h:any) => {
            (h.buyHistory||[]).forEach((b:any,i:number) => allTx.push({ symbol:h.symbol, date:b.date, kind:"buy", qty:b.qty, price:b.price, sector:h.sector||"", idx:i }));
            (h.realizedHistory||[]).forEach((r:any,i:number) => allTx.push({ symbol:h.symbol, date:r.date, kind:"sell", qty:r.qty, price:r.sellPrice, avgCostAtSale:r.avgCostAtSale, gain:r.gain, gainPct:r.gainPct, fees:r.fees, grossGain:r.grossGain, proceeds:r.proceeds, sector:h.sector||"", idx:i }));
            (h.splitHistory||[]).forEach((s:any,i:number) => allTx.push({ symbol:h.symbol, date:s.date, kind:"split", ratio:s.ratio, sector:h.sector||"", idx:i }));
          });
          allTx.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          // Compute running avgCost after each buy transaction (per symbol, by buyHistory index)
          const avgCostAtBuy: Map<string, number[]> = new Map();
          holdings.forEach((h:any) => {
            const buys = (h.buyHistory||[]);
            const sells = (h.realizedHistory||[]);
            const splits = (h.splitHistory||[]);
            const events = [
              ...buys.map((b:any,i:number)=>({ date:b.date, type:"buy" as const, qty:b.qty, price:b.price, buyIdx:i, targetShares:0 })),
              ...sells.map((s:any)=>({ date:s.date, type:"sell" as const, qty:s.qty, price:0, buyIdx:-1, targetShares:0 })),
              ...splits.map((sp:any)=>({ date:sp.date, type:"split" as const, qty:0, price:0, buyIdx:-1, targetShares:parseFloat(sp.ratio)||0 })),
            ].sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime());
            let shares=0, totalCost=0;
            const avgArr: number[] = new Array(buys.length).fill(0);
            for (const e of events) {
              if (e.type==="buy") {
                totalCost += e.qty * e.price; shares += e.qty;
                avgArr[e.buyIdx] = shares>0 ? totalCost/shares : 0;
              } else if (e.type==="sell") {
                const avg = shares>0 ? totalCost/shares : 0;
                shares -= e.qty; totalCost -= e.qty*avg;
              } else if (e.targetShares > 0) {
                shares = e.targetShares;
              }
            }
            avgCostAtBuy.set(h.symbol, avgArr);
          });

          const allSymbols = [...new Set(holdings.map((h:any)=>h.symbol))].sort();
          const filteredTx = txFilterSymbol==="ALL" ? allTx : allTx.filter(t=>t.symbol===txFilterSymbol);

          const sellTx = filteredTx.filter(t=>t.kind==="sell");
          const winCount = sellTx.filter(t=>(t.gain||0)>=0).length;
          const lossCount = sellTx.filter(t=>(t.gain||0)<0).length;
          const winRate = sellTx.length>0 ? (winCount/sellTx.length*100) : 0;
          const buyCount = filteredTx.filter(t=>t.kind==="buy").length;
          const splitCount = filteredTx.filter(t=>t.kind==="split").length;

          const filteredHoldings = txFilterSymbol==="ALL" ? effectiveHoldings : effectiveHoldings.filter((h:any)=>h.symbol===txFilterSymbol);
          const totalRealized = sellTx.reduce((s,t)=>s+(t.gain||0),0);
          const totalUnrealized = filteredHoldings.reduce((s:number,h:any)=>s+(h.shares>0?(h.currentPrice-h.avgCost)*h.shares:0),0);
          const totalPnL = totalRealized + totalUnrealized;

          const kindIcon = (k:string) => k==="buy"?"🛒":k==="sell"?"💰":"🔀";
          const kindColor = (k:string) => k==="buy"?"#86efac":k==="sell"?"#fbbf24":"#67e8f9";
          const kindLabel = (k:string) => k==="buy"?"ซื้อ":k==="sell"?"ขาย":"แตกพาร์";

          return (
            <div>
              {/* Symbol Filter + import button */}
              <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:12,color:"#718096"}}>กรองหุ้น:</span>
                <select value={txFilterSymbol} onChange={e=>setTxFilterSymbol(e.target.value)}
                  style={{background:"#1a1d2e",border:"1px solid #4a5568",borderRadius:6,color:"#e2e8f0",fontSize:13,padding:"6px 10px"}}>
                  <option value="ALL">ทั้งหมด ({holdings.length} หลักทรัพย์)</option>
                  {allSymbols.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {txFilterSymbol!=="ALL" && <button onClick={()=>setTxFilterSymbol("ALL")} style={{fontSize:12,color:"#fc8181",background:"none",border:"none",cursor:"pointer"}}>✕ ล้าง</button>}
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <button onClick={()=>setShowTxImport(v=>!v)} style={btn("#1a2a3a","#93c5fd",{fontSize:12,padding:"6px 12px"})}>📥 Import ประวัติ CSV</button>
                  <button onClick={()=>{
                    if(!window.confirm("ลบประวัติ transaction ทั้งหมด?\n(จำนวนหุ้น/ต้นทุนปัจจุบันจะถูกบันทึกไว้ก่อนลบ)")) return;
                    const updated = holdings.map((h:any)=>{
                      const eff = computeFromHistory(h);
                      return { ...h, shares: eff.shares, avgCost: eff.avgCost, buyHistory:[], realizedHistory:[], splitHistory:[] };
                    });
                    setAndSave(updated); msg("ลบประวัติทั้งหมดแล้ว ✓");
                  }} style={btn("#4a1515","#fc8181",{fontSize:12,padding:"6px 12px"})}>🗑️ Clear ประวัติ</button>
                </div>
              </div>

              {/* TX CSV Import panel */}
              {showTxImport&&(
                <div style={{background:"#1a1d2e",borderRadius:8,padding:16,marginBottom:12,border:"1px solid #2d3748"}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#93c5fd",marginBottom:6}}>📥 Import ประวัติ ซื้อ/ขาย</div>
                  <div style={{fontSize:12,color:"#a0aec0",marginBottom:8}}>Format: <code style={{color:"#67e8f9"}}>DD/MM/YYYY HH:MM,Side(B/S),Symbol,จำนวน,ราคา</code> — เวลาใส่หรือไม่ใส่ก็ได้, <code style={{color:"#7ee8a2"}}>BRK.B → BRK-B</code> อัตโนมัติ</div>
                  <textarea value={txImportText} onChange={e=>setTxImportText(e.target.value)}
                    placeholder={"01/11/2025 21:21,B,ACLS,0.1499694,81.95\n18/06/2026 07:20,S,ACLS,0.0445361,184.12\n02/07/2026 15:03,SPLIT,CRWD,4\n02/07/2026 15:03,+,CRWD,0.5311213,0\n02/07/2026 15:03,-,CRWD,0.1327803"}
                    style={{width:"100%",minHeight:140,background:"#0f1117",color:"#e2e8f0",border:"1px solid #4a5568",borderRadius:6,padding:10,fontSize:12,resize:"vertical",fontFamily:"monospace"}}/>
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    <button onClick={importTxCSV} disabled={!txImportText.trim()} style={btn("#2f6b4f","#7ee8a2",{opacity:!txImportText.trim()?0.5:1})}>✅ นำเข้า</button>
                    <button onClick={()=>{setShowTxImport(false);setTxImportText("");}} style={btn("#2d3748","#a0aec0")}>ยกเลิก</button>
                  </div>
                </div>
              )}

              {/* Summary */}
              <div style={{background:"#1a1d2e",borderRadius:10,padding:16,marginBottom:16,border:"1px solid #2d3748",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:11,color:"#718096",marginBottom:4}}>Realized P&L{txFilterSymbol!=="ALL"?` (${txFilterSymbol})`:""}</div>
                  <div style={{fontSize:16,fontWeight:700,color:pc(totalRealized)}}>{totalRealized>=0?"+":""}${totalRealized.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:11,color:"#718096",marginBottom:4}}>Unrealized P&L{txFilterSymbol!=="ALL"?` (${txFilterSymbol})`:""}</div>
                  <div style={{fontSize:16,fontWeight:700,color:pc(totalUnrealized)}}>{totalUnrealized>=0?"+":""}${totalUnrealized.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:11,color:"#718096",marginBottom:4}}>Total P&L</div>
                  <div style={{fontSize:16,fontWeight:700,color:pc(totalPnL)}}>{totalPnL>=0?"+":""}${totalPnL.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:11,color:"#718096",marginBottom:4}}>Win Rate (ขาย)</div>
                  <div style={{fontSize:16,fontWeight:700,color:"#e2e8f0"}}>{winRate.toFixed(0)}% <span style={{fontSize:11,color:"#718096"}}>({winCount}W/{lossCount}L)</span></div>
                </div>
                <div style={{textAlign:"center",gridColumn:"1/-1",display:"flex",justifyContent:"center",gap:20,paddingTop:6,borderTop:"1px solid #2d3748"}}>
                  <span style={{fontSize:12,color:"#86efac"}}>🛒 ซื้อ {buyCount} ครั้ง</span>
                  <span style={{fontSize:12,color:"#fbbf24"}}>💰 ขาย {sellTx.length} ครั้ง</span>
                  <span style={{fontSize:12,color:"#67e8f9"}}>🔀 แตกพาร์ {splitCount} ครั้ง</span>
                </div>
              </div>

              {filteredTx.length===0 ? (
                <div style={{textAlign:"center",padding:"40px 20px",color:"#718096"}}>
                  <div style={{fontSize:36}}>📜</div>
                  <div style={{marginTop:8}}>ยังไม่มีประวัติ Transaction</div>
                  <div style={{fontSize:12,marginTop:4}}>กด 🛒 ซื้อ / 💰 ขาย / 🔀 แตกพาร์ ที่หุ้นในแท็บรายการ</div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {filteredTx.map((t,i)=>(
                    <div key={i} style={{background:"#1a1d2e",borderRadius:8,padding:"10px 14px",border:"1px solid #2d3748",borderLeft:`3px solid ${kindColor(t.kind)}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:18}}>{kindIcon(t.kind)}</span>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontWeight:700,color:"#7ee8a2",fontSize:13}}>{t.symbol}</span>
                            <span style={{fontSize:11,color:kindColor(t.kind),fontWeight:600}}>{kindLabel(t.kind)}</span>
                          </div>
                          <div style={{fontSize:11,color:"#718096"}}>{new Date(t.date).toLocaleDateString("en-GB",{year:"numeric",month:"short",day:"numeric"})} {new Date(t.date).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false})}</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        {t.kind==="split" ? (
                          <span style={{fontSize:13,color:"#67e8f9",fontWeight:600}}>Ratio {t.ratio}</span>
                        ) : (
                          <>
                            <div style={{fontSize:13,color:"#e2e8f0"}}>{t.qty?.toFixed(7)} หุ้น @ ${t.price?.toFixed(4)}</div>
                            {t.kind==="buy" && (() => { const avg = avgCostAtBuy.get(t.symbol)?.[t.idx]; return avg!=null ? <div style={{fontSize:11,color:"#a0aec0"}}>ต้นทุนเฉลี่ย: <span style={{color:"#7ee8a2",fontWeight:600}}>${avg.toFixed(4)}</span></div> : null; })()}
                            {t.kind==="sell" && t.proceeds!=null && <div style={{fontSize:11,color:"#67e8f9"}}>ได้รับ ${(t.proceeds-(t.fees||0)).toFixed(2)}</div>}
                            {t.kind==="sell" && (
                              <div>
                                <div style={{fontSize:12,fontWeight:700,color:pc(t.gain||0)}}>
                                  {(t.gain||0)>=0?"+":""}${(t.gain||0).toFixed(2)} ({(t.gainPct||0)>=0?"+":""}{(t.gainPct||0).toFixed(1)}%)
                                </div>
                                {t.fees!=null && t.fees>0 && <div style={{fontSize:10,color:"#fc8181"}}>fee -${t.fees.toFixed(2)}</div>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={()=>openEditTx(t.symbol,t.kind,t.idx)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#718096",padding:"4px 6px"}} title="แก้ไข">✏️</button>
                        <button onClick={()=>deleteTx(t.symbol,t.kind,t.idx)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#fc8181",padding:"4px 6px"}} title="ลบ">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ADD TAB */}
        {tab==="add"&&(
          <div style={{maxWidth:460}}>
            <div style={{background:"#1a1d2e",borderRadius:10,padding:20,border:"1px solid #2d3748"}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#a0aec0"}}>เพิ่มหลักทรัพย์</div>
              {[{k:"symbol",l:"Symbol",p:"AAPL"},{k:"shares",l:"จำนวนหุ้น",p:"100",t:"number"},{k:"avgCost",l:"ต้นทุนเฉลี่ย ($)",p:"150.00",t:"number"},{k:"currentPrice",l:"ราคาปัจจุบัน",p:"0",t:"number"},{k:"targetPct",l:"สัดส่วนเป้าหมาย % (ไม่บังคับ)",p:"2.5",t:"number"},{k:"sector",l:"กลุ่มธุรกิจ (ไม่บังคับ)",p:"Tech"},{k:"note",l:"หมายเหตุ (ไม่บังคับ)",p:"Long term"}].map(f=>(
                <div key={f.k} style={{marginBottom:10}}>
                  <div style={{fontSize:11,color:"#a0aec0",marginBottom:3}}>{f.l}</div>
                  <input type={(f as any).t||"text"} value={(newStock as any)[f.k]||""} placeholder={f.p}
                    onChange={e=>setNewStock({...newStock,[f.k]:f.k==="symbol"?e.target.value.toUpperCase():e.target.value})}
                    style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"9px 12px",color:"#e2e8f0",fontSize:13}}/>
                </div>
              ))}
              <button onClick={addHolding} style={{...btn("#2f6b4f","#7ee8a2"),width:"100%",padding:"11px",fontSize:14,marginTop:4}}>➕ เพิ่มหลักทรัพย์</button>
            </div>
          </div>
        )}
        </div>{/* content-area */}
      </div>{/* main-layout */}

      {/* EDIT TRANSACTION MODAL */}
      {editTxData && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16,overflowY:"auto"}} onClick={()=>setEditTxData(null)}>
          <div style={{background:"#1a1d2e",borderRadius:12,padding:24,maxWidth:380,width:"100%",border:"1px solid #2d3748",boxSizing:"border-box"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>
              ✏️ แก้ไข{editTxData.kind==="buy"?"การซื้อ":editTxData.kind==="sell"?"การขาย":"การแตกพาร์"} {editTxData.symbol}
            </div>
            <div style={{fontSize:11,color:"#fc8181",marginBottom:16}}>⚠️ การแก้ไขจะกระทบยอดจำนวนหุ้น/ต้นทุนปัจจุบัน</div>

            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>วันเวลา (วัน/เดือน/ปี)</div>
              <DateTimePicker24h value={editTxData.date} onChange={iso=>setEditTxData({...editTxData,date:iso})}/>
            </div>

            {editTxData.kind==="split" ? (
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>จำนวนหุ้นใหม่ (หลังแตกพาร์)</div>
                <input type="number" value={editTxData.ratio} onChange={e=>setEditTxData({...editTxData,ratio:e.target.value})} placeholder="ระบุจำนวนหุ้นหลังแตกพาร์"
                  style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14,boxSizing:"border-box"}}/>
              </div>
            ) : (
              <>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>จำนวนหุ้น</div>
                  <input type="number" value={editTxData.qty} onChange={e=>setEditTxData({...editTxData,qty:e.target.value})}
                    style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14,boxSizing:"border-box"}}/>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>ราคา ($)</div>
                  <input type="number" value={editTxData.price} onChange={e=>setEditTxData({...editTxData,price:e.target.value})}
                    style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14,boxSizing:"border-box"}}/>
                </div>
                {editTxData.kind==="sell" && (
                  <div style={{background:"#0f1117",borderRadius:8,padding:12,marginBottom:16}}>
                    <div style={{fontSize:11,color:"#a0aec0",marginBottom:8}}>💵 ค่าธรรมเนียม</div>
                    {[
                      {label:"Commission ($)", key:"commission" as const},
                      {label:"SEC Fee ($)", key:"secFee" as const},
                      {label:"TAF Fee ($)", key:"tafFee" as const},
                      {label:"CAT Fee ($)", key:"catFee" as const},
                    ].map(f=>(
                      <div key={f.key} style={{marginBottom:8}}>
                        <div style={{fontSize:11,color:"#718096",marginBottom:3}}>{f.label}</div>
                        <input type="number" value={editTxData[f.key]} onChange={e=>setEditTxData({...editTxData,[f.key]:e.target.value})}
                          style={{width:"100%",background:"#1a1d2e",border:"1px solid #4a5568",borderRadius:5,padding:"7px 10px",color:"#e2e8f0",fontSize:13,boxSizing:"border-box"}}/>
                      </div>
                    ))}
                    <div style={{marginBottom:8,paddingTop:6,borderTop:"1px solid #2d3748"}}>
                      <div style={{fontSize:11,color:"#718096",marginBottom:3}}>VAT 7% ($) <span style={{color:"#4a5568"}}>(ปล่อยว่าง = อัตโนมัติ {((parseFloat(editTxData.commission)||0)*0.07).toFixed(4)})</span></div>
                      <input type="number" value={editTxData.vat} onChange={e=>setEditTxData({...editTxData,vat:e.target.value})} placeholder={`${((parseFloat(editTxData.commission)||0)*0.07).toFixed(4)}`}
                        style={{width:"100%",background:"#1a1d2e",border:"1px solid #4a5568",borderRadius:5,padding:"7px 10px",color:"#e2e8f0",fontSize:13,boxSizing:"border-box"}}/>
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{display:"flex",gap:8}}>
              <button onClick={saveEditTx} style={{...btn("#2f6b4f","#7ee8a2"),flex:1,padding:"10px"}}>✅ บันทึก</button>
              <button onClick={()=>setEditTxData(null)} style={{...btn("#2d3748","#a0aec0"),flex:1,padding:"10px"}}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* ACTION SHEET MODAL */}
      {actionMenuId !== null && (() => {
        const h = effectiveHoldings.find((x:any)=>x.id===actionMenuId);
        if (!h) return null;
        const actions = [
          { icon:"✏️", label:"แก้ไขข้อมูล", color:"#e2e8f0", onClick:()=>{setEditId(h.id);setActionMenuId(null);} },
          { icon:"🛒", label:"ซื้อเพิ่ม", color:"#86efac", onClick:()=>{openBuyModal(h.id);setActionMenuId(null);} },
          { icon:"💰", label:"ขาย", color:"#fbbf24", onClick:()=>{openSellModal(h.id);setActionMenuId(null);} },
          { icon:"🔀", label:"แตกพาร์", color:"#67e8f9", onClick:()=>{openSplitModal(h.id);setActionMenuId(null);} },
          { icon:"✕", label:"ลบออกจาก Port", color:"#fc8181", onClick:()=>{removeH(h.id);setActionMenuId(null);} },
        ];
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={()=>setActionMenuId(null)}>
            <div style={{background:"#1a1d2e",borderRadius:12,padding:8,maxWidth:320,width:"100%",border:"1px solid #2d3748",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #2d3748",marginBottom:4}}>
                <span style={{fontWeight:700,color:"#7ee8a2",fontSize:15}}>{h.symbol}</span>
                <span style={{fontSize:12,color:"#718096",marginLeft:8}}>{h.shares.toFixed(4)} หุ้น</span>
              </div>
              {actions.map((a,i)=>(
                <button key={i} onClick={a.onClick} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 16px",background:"none",border:"none",cursor:"pointer",fontSize:14,color:a.color,textAlign:"left",borderRadius:8}}>
                  <span style={{fontSize:18}}>{a.icon}</span>{a.label}
                </button>
              ))}
              <button onClick={()=>setActionMenuId(null)} style={{width:"100%",padding:"10px",marginTop:4,background:"#2d3748",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,color:"#a0aec0"}}>ยกเลิก</button>
            </div>
          </div>
        );
      })()}

      {/* BUY MODAL */}
      {buyModalId !== null && (() => {
        const h = effectiveHoldings.find((x:any)=>x.id===buyModalId);
        if (!h) return null;
        const qty = parseFloat(buyQty)||0;
        const price = parseFloat(buyPrice)||0;
        const oldValue = h.shares*h.avgCost;
        const newValue = qty*price;
        const newShares = h.shares+qty;
        const newAvgCost = newShares>0 ? (oldValue+newValue)/newShares : 0;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={()=>setBuyModalId(null)}>
            <div style={{background:"#1a1d2e",borderRadius:12,padding:24,maxWidth:380,width:"100%",border:"1px solid #2d3748"}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:16,fontWeight:700,color:"#86efac",marginBottom:4}}>🛒 ซื้อเพิ่ม {h.symbol}</div>
              <div style={{fontSize:12,color:"#718096",marginBottom:16}}>มีอยู่ {h.shares.toFixed(7)} หุ้น | ทุนเฉลี่ย ${h.avgCost.toFixed(4)}/หุ้น</div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>จำนวนที่ซื้อเพิ่ม</div>
                <input type="number" value={buyQty} onChange={e=>setBuyQty(e.target.value)} placeholder="0" autoFocus
                  style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14}}/>
              </div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>ราคาที่ซื้อ ($)</div>
                <input type="number" value={buyPrice} onChange={e=>setBuyPrice(e.target.value)} placeholder={h.currentPrice?String(h.currentPrice):"0"}
                  style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14}}/>
                <button onClick={()=>setBuyPrice(String(h.currentPrice))} style={{fontSize:11,color:"#67e8f9",background:"none",border:"none",cursor:"pointer",marginTop:4,padding:0}}>ใช้ราคาปัจจุบัน (${h.currentPrice})</button>
              </div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>วันเวลาที่ซื้อ (วัน/เดือน/ปี)</div>
                <DateTimePicker24h value={buyDateTime} onChange={setBuyDateTime}/>
              </div>

              {qty>0 && price>0 && (
                <div style={{background:"#0f1117",borderRadius:8,padding:12,marginBottom:16}}>
                  <div style={{fontSize:11,color:"#718096",marginBottom:6}}>ผลลัพธ์หลังซื้อเพิ่ม</div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                    <span style={{color:"#a0aec0"}}>จำนวนหุ้น</span>
                    <span style={{color:"#e2e8f0"}}>{h.shares.toFixed(4)} → <b style={{color:"#7ee8a2"}}>{newShares.toFixed(4)}</b></span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                    <span style={{color:"#a0aec0"}}>ต้นทุนเฉลี่ย/หุ้น</span>
                    <span style={{color:"#e2e8f0"}}>${h.avgCost.toFixed(4)} → <b style={{color:"#7ee8a2"}}>${newAvgCost.toFixed(4)}</b></span>
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmBuy} disabled={!qty||!price} style={{...btn("#2f6b4f","#86efac"),flex:1,padding:"10px",opacity:(!qty||!price)?0.5:1}}>✅ ยืนยันซื้อเพิ่ม</button>
                <button onClick={()=>setBuyModalId(null)} style={{...btn("#2d3748","#a0aec0"),flex:1,padding:"10px"}}>ยกเลิก</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SELL MODAL */}
      {sellModalId !== null && (() => {
        const h = effectiveHoldings.find((x:any)=>x.id===sellModalId);
        if (!h) return null;
        const qty = parseFloat(sellQty)||0;
        const price = parseFloat(sellPrice)||0;
        const fees = calcSellFees();
        const grossGain = (price - h.avgCost) * qty;
        const netGain = grossGain - fees.totalFees;
        const netGainPct = h.avgCost>0 && qty>0 ? (netGain/(h.avgCost*qty)*100) : 0;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16,overflowY:"auto"}} onClick={()=>setSellModalId(null)}>
            <div style={{background:"#1a1d2e",borderRadius:12,padding:24,maxWidth:380,width:"100%",border:"1px solid #2d3748",boxSizing:"border-box"}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:16,fontWeight:700,color:"#fbbf24",marginBottom:4}}>💰 ขาย {h.symbol}</div>
              <div style={{fontSize:12,color:"#718096",marginBottom:16}}>มีอยู่ {h.shares.toFixed(7)} หุ้น | ทุน ${h.avgCost.toFixed(4)}/หุ้น</div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>จำนวนที่ขาย</div>
                <input type="number" value={sellQty} onChange={e=>setSellQty(e.target.value)} placeholder="0" autoFocus
                  style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14,boxSizing:"border-box"}}/>
                <button onClick={()=>setSellQty(String(h.shares))} style={{fontSize:11,color:"#67e8f9",background:"none",border:"none",cursor:"pointer",marginTop:4,padding:0}}>ขายทั้งหมด ({h.shares.toFixed(4)})</button>
              </div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>ราคาที่ขาย ($)</div>
                <input type="number" value={sellPrice} onChange={e=>setSellPrice(e.target.value)} placeholder={h.currentPrice?String(h.currentPrice):"0"}
                  style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14,boxSizing:"border-box"}}/>
                <button onClick={()=>setSellPrice(String(h.currentPrice))} style={{fontSize:11,color:"#67e8f9",background:"none",border:"none",cursor:"pointer",marginTop:4,padding:0}}>ใช้ราคาปัจจุบัน (${h.currentPrice})</button>
              </div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:4}}>วันเวลาที่ขาย</div>
                <DateTimePicker24h value={sellDateTime} onChange={setSellDateTime}/>
              </div>

              <button onClick={()=>setShowFees(!showFees)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",cursor:"pointer",padding:"8px 0",marginBottom:showFees?8:12}}>
                <span style={{fontSize:12,color:"#a0aec0"}}>💵 ค่าธรรมเนียม (ไม่บังคับ)</span>
                <span style={{fontSize:12,color:"#67e8f9"}}>{showFees?"▲ ซ่อน":"▼ แสดง"}</span>
              </button>

              {showFees && (
                <div style={{background:"#0f1117",borderRadius:8,padding:12,marginBottom:12}}>
                  {[
                    {label:"Commission Fee ($)", val:sellCommission, set:setSellCommission},
                    {label:"SEC Fee ($)", val:sellSecFee, set:setSellSecFee},
                    {label:"TAF Fee ($)", val:sellTafFee, set:setSellTafFee},
                    {label:"CAT Fee ($)", val:sellCatFee, set:setSellCatFee},
                  ].map(f=>(
                    <div key={f.label} style={{marginBottom:8}}>
                      <div style={{fontSize:11,color:"#718096",marginBottom:3}}>{f.label}</div>
                      <input type="number" value={f.val} onChange={e=>f.set(e.target.value)} placeholder="0"
                        style={{width:"100%",background:"#1a1d2e",border:"1px solid #4a5568",borderRadius:5,padding:"7px 10px",color:"#e2e8f0",fontSize:13,boxSizing:"border-box"}}/>
                    </div>
                  ))}
                  <div style={{marginBottom:8,paddingTop:6,borderTop:"1px solid #2d3748"}}>
                    <div style={{fontSize:11,color:"#718096",marginBottom:3}}>VAT 7% ($) <span style={{color:"#4a5568"}}>(ปล่อยว่าง = คำนวณอัตโนมัติจาก Commission × 7% = ${((parseFloat(sellCommission)||0)*0.07).toFixed(2)})</span></div>
                    <input type="number" value={sellVat} onChange={e=>setSellVat(e.target.value)} placeholder={`${((parseFloat(sellCommission)||0)*0.07).toFixed(4)}`}
                      style={{width:"100%",background:"#1a1d2e",border:"1px solid #4a5568",borderRadius:5,padding:"7px 10px",color:"#e2e8f0",fontSize:13,boxSizing:"border-box"}}/>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,display:"flex",justifyContent:"space-between",marginTop:4}}>
                    <span style={{color:"#a0aec0"}}>รวมค่าธรรมเนียม</span>
                    <span style={{color:"#fc8181"}}>${fees.totalFees.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {qty>0 && price>0 && (
                <div style={{background:"#0f1117",borderRadius:8,padding:12,marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                    <span style={{color:"#718096"}}>Gross P&L</span>
                    <span style={{color:"#a0aec0"}}>{grossGain>=0?"+":""}${grossGain.toFixed(2)}</span>
                  </div>
                  {fees.totalFees>0 && (
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                      <span style={{color:"#718096"}}>ค่าธรรมเนียมทั้งหมด</span>
                      <span style={{color:"#fc8181"}}>-${fees.totalFees.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4,paddingTop:6,borderTop:"1px solid #2d3748"}}>
                    <span style={{color:"#718096"}}>ยอดขายรวม (Proceeds)</span>
                    <span style={{color:"#e2e8f0"}}>${(qty*price).toFixed(2)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,marginTop:4}}>
                    <span style={{color:"#a0aec0"}}>Net P&L</span>
                    <span style={{color:netGain>=0?"#7ee8a2":"#fc8181"}}>{netGain>=0?"+":""}${netGain.toFixed(2)} ({netGainPct>=0?"+":""}{netGainPct.toFixed(2)}%)</span>
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmSell} disabled={!qty||!price||qty>h.shares} style={{...btn("#2f6b4f","#7ee8a2"),flex:1,padding:"10px",opacity:(!qty||!price||qty>h.shares)?0.5:1}}>✅ ยืนยันขาย</button>
                <button onClick={()=>setSellModalId(null)} style={{...btn("#2d3748","#a0aec0"),flex:1,padding:"10px"}}>ยกเลิก</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SPLIT MODAL */}
      {splitModalId !== null && (() => {
        const h = effectiveHoldings.find((x:any)=>x.id===splitModalId);
        if (!h) return null;
        const newShares = parseFloat(splitRatio);
        const valid = newShares > 0 && newShares !== h.shares;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={()=>setSplitModalId(null)}>
            <div style={{background:"#1a1d2e",borderRadius:12,padding:24,maxWidth:380,width:"100%",border:"1px solid #2d3748"}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:16,fontWeight:700,color:"#67e8f9",marginBottom:4}}>🔀 แตกพาร์ {h.symbol}</div>
              <div style={{fontSize:12,color:"#718096",marginBottom:16}}>ปัจจุบัน {h.shares.toFixed(7)} หุ้น</div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"#a0aec0",marginBottom:6}}>จำนวนหุ้นหลังแตกพาร์</div>
                <input type="number" value={splitRatio} onChange={e=>setSplitRatio(e.target.value)} placeholder={`เช่น ${(h.shares*4).toFixed(7)}`} min="0" step="any" autoFocus
                  style={{width:"100%",background:"#0f1117",border:"1px solid #4a5568",borderRadius:6,padding:"10px 12px",color:"#e2e8f0",fontSize:14}}/>
              </div>

              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmSplit} disabled={!valid} style={{...btn("#1a3a4a","#67e8f9"),flex:1,padding:"10px",opacity:valid?1:0.5}}>✅ ยืนยันแตกพาร์</button>
                <button onClick={()=>setSplitModalId(null)} style={{...btn("#2d3748","#a0aec0"),flex:1,padding:"10px"}}>ยกเลิก</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
