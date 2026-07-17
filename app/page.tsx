"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import DateTimePicker24h from "./components/DateTimePicker24h";
import { parseCSV, toCSV, copyToClipboard, fifoBasisForSale, computeFromHistory } from "./lib/portfolio";
import { setOnDriveAuthExpired, listPortfolios, loadPortfolio, savePortfolio, deletePortfolio } from "./lib/drive";
import { btn, btnPrimary, btnGhost, inp } from "./lib/ui";
import Snackbar from "./components/Snackbar";
import Sheet from "./components/Sheet";
import HoldingsList from "./components/HoldingsList";
import DetailSheet from "./components/DetailSheet";
import AppShell from "./components/AppShell";
import AiTab from "./components/AiTab";
import ToolsMenu from "./components/ToolsMenu";
import ChartsTab from "./components/ChartsTab";
import HistoryTab from "./components/HistoryTab";

const PROXY_URL = "/api/price";
const GOOGLE_CLIENT_ID = "45222114320-2r8rh69n1mt4jd4138v90vqq7ha0dgq2.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";


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
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [detailId, setDetailId] = useState<number|null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"value"|"pl"|"today"|"az"|"under">("value");
  const [sortDesc, setSortDesc] = useState(true);
  const [showAddSheet, setShowAddSheet] = useState(false);
  useEffect(() => {
    if (!avatarMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAvatarMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [avatarMenuOpen]);

  const msg = (m: string, ms = 3000) => { setStatus(m); if (ms) setTimeout(() => setStatus(""), ms); };

  // ── Google auth with silent renewal ──
  // Google implicit-flow tokens last ~1h. One shared token client; its callback is
  // swapped via tokenCallbackRef so both interactive login and silent renewal reuse it.
  const tokenClientRef = useRef<any>(null);
  const tokenCallbackRef = useRef<(resp: any) => void>(() => {});
  const ensureTokenClient = useCallback(() => {
    if (tokenClientRef.current) return tokenClientRef.current;
    const g = (window as any).google?.accounts?.oauth2;
    if (!g) return null;
    tokenClientRef.current = g.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: SCOPES,
      callback: (resp: any) => tokenCallbackRef.current(resp),
      error_callback: () => tokenCallbackRef.current({}),
    });
    return tokenClientRef.current;
  }, []);

  // Ask Google for a fresh token without any UI (works while the Google session
  // is alive and consent was already granted). Resolves null on failure/timeout.
  const trySilentRefresh = useCallback(() => new Promise<string | null>((resolve) => {
    const client = ensureTokenClient();
    if (!client) return resolve(null);
    let done = false;
    const finish = (t: string | null) => { if (!done) { done = true; clearTimeout(timer); resolve(t); } };
    const timer = setTimeout(() => finish(null), 8000);
    tokenCallbackRef.current = (resp: any) => {
      if (resp?.access_token) {
        const t = resp.access_token;
        authExpiredRef.current = false;
        setToken(t); tokenRef.current = t;
        localStorage.setItem("gtoken", t);
        finish(t);
      } else finish(null);
    };
    try { client.requestAccessToken({ prompt: "" }); } catch { finish(null); }
  }), [ensureTokenClient]);

  // On Drive 401: try a silent renewal first; only log out if that fails.
  // Guard so the many in-flight Drive calls that all 401 at once trigger this once.
  const authExpiredRef = useRef(false);
  const handleAuthExpired = useCallback(() => {
    if (authExpiredRef.current) return;
    authExpiredRef.current = true;
    trySilentRefresh().then(t => {
      if (t) { msg("🔄 ต่ออายุ Google อัตโนมัติแล้ว ✓"); return; }
      setToken(null); tokenRef.current = null; setUserEmail(null);
      localStorage.removeItem("gtoken"); localStorage.removeItem("gemail");
      msg("⚠️ Session Google หมดอายุ — ออกให้อัตโนมัติแล้ว กรุณาเชื่อมต่อใหม่", 8000);
    });
  }, [trySilentRefresh]);

  useEffect(() => {
    setOnDriveAuthExpired(handleAuthExpired);
    return () => { setOnDriveAuthExpired(null); };
  }, [handleAuthExpired]);

  // Proactively renew every 45 min so the hourly expiry is never hit mid-use
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => { trySilentRefresh(); }, 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [token, trySilentRefresh]);

  // Load saved token on mount
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true;
    // Saved tokens are usually already stale when the app reopens — renew silently once GIS loads
    script.onload = () => { if (localStorage.getItem("gtoken")) trySilentRefresh(); };
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const client = ensureTokenClient();
    if (!client) { setGoogleLoading(false); msg("Google ยังโหลดไม่เสร็จ ลองอีกครั้ง"); return; }
    tokenCallbackRef.current = async (response: any) => {
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
    };
    client.requestAccessToken();
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

  // One-slot safety snapshot taken before destructive operations (recalc, clear,
  // import, delete) so a bad rewrite can be undone with the กู้คืน button.
  const makeBackup = (label: string) => {
    try {
      localStorage.setItem(`backup-${currentPortId||"local"}`, JSON.stringify({ ts: Date.now(), label, holdings }));
    } catch {}
  };
  const restoreBackup = () => {
    const raw = localStorage.getItem(`backup-${currentPortId||"local"}`);
    if (!raw) { msg("ไม่มี backup ให้กู้คืน"); return; }
    try {
      const b = JSON.parse(raw);
      if (!window.confirm(`กู้คืนข้อมูลก่อน "${b.label}"\n(${new Date(b.ts).toLocaleString("th-TH")})?\n\nข้อมูลปัจจุบันจะถูกแทนที่`)) return;
      setAndSave(b.holdings);
      msg(`กู้คืนข้อมูลก่อน "${b.label}" แล้ว ✓`, 5000);
    } catch { msg("backup เสียหาย กู้คืนไม่ได้"); }
  };

  const refreshPrices = async () => {
    if (!holdings.length) return;
    setRefreshing(true); setPriceErrors([]); msg("กำลังดึงราคา...", 0);
    try {
      const BATCH = 20; const errors: string[] = []; let updated = [...holdings];
      const fetchList = holdings.filter((h:any)=>!h.hidden); // skip deleted-but-archived entries
      const totalBatches = Math.ceil(fetchList.length / BATCH);
      for (let i = 0; i < fetchList.length; i += BATCH) {
        const batchNo = Math.floor(i / BATCH) + 1;
        const batchSymbols = fetchList.slice(i, i+BATCH).map((h:any)=>h.symbol);
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
  const removeH = (id: number) => {
    const h = holdings.find((x:any)=>x.id===id);
    if (!h) return;
    makeBackup(`ลบ ${h.symbol}`);
    if ((h.realizedHistory||[]).length) {
      // Keep the record (hidden) so realized P&L survives — only remove it from the active port views
      if (!window.confirm(`ลบ ${h.symbol} ออกจาก Port?\n\nประวัติกำไรขาย (Realized) จะยังถูกเก็บไว้ในแท็บประวัติ`)) return;
      setAndSave(holdings.map((x:any)=>x.id===id ? { ...x, hidden: true, targetPct: 0 } : x));
      msg(`ลบ ${h.symbol} แล้ว — ประวัติขายยังอยู่ในแท็บประวัติ ✓`, 5000);
    } else {
      if (!window.confirm(`ลบ ${h.symbol} ออกจาก Port?`)) return;
      setAndSave(holdings.filter((x:any)=>x.id!==id));
      msg(`ลบ ${h.symbol} แล้ว ✓`);
    }
  };

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
    // FIFO: cost basis of the actual (oldest) lots being sold, matching the broker
    const basis = fifoBasisForSale(h, qty);
    const grossGain = (price - basis) * qty;
    const realizedGain = grossGain - fees.totalFees;
    const realizedPct = basis>0 ? (realizedGain/(basis*qty)*100) : 0;
    const proceeds = qty * price;
    const txDate = sellDateTime ? new Date(sellDateTime).toISOString() : new Date().toISOString();
    const historyEntry = {
      date: txDate, qty, sellPrice: price, avgCostAtSale: basis, proceeds,
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

    // Use effective (history-derived) position, not the stale stored fields
    const eff = computeFromHistory(h);
    const oldValue = eff.shares * eff.avgCost;
    const newValue = qty * price;
    const newShares = eff.shares + qty;
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

  // Rewrite every stored sell's realized P&L using the FIFO basis of the lots
  // actually sold at that point in history, so old records match the broker.
  const recalcRealizedFIFO = () => {
    if (!window.confirm("คำนวณกำไรขายทุกรายการใหม่แบบ FIFO ให้ตรงโบรกเกอร์?\n(ตัวเลข Realized P&L ของรายการขายเก่าจะถูกเขียนทับ)")) return;
    makeBackup("Recalc FIFO");
    let changed = 0;
    const updated = holdings.map((h:any) => {
      const buys = h.buyHistory||[], sells = h.realizedHistory||[], splits = h.splitHistory||[];
      if (!sells.length) return h;
      const events = [
        ...buys.map((b:any)=>({date:b.date,type:"buy" as const,qty:b.qty,price:b.price,sellIdx:-1,targetShares:0})),
        ...sells.map((s:any,i:number)=>({date:s.date,type:"sell" as const,qty:s.qty,price:0,sellIdx:i,targetShares:0})),
        ...splits.map((sp:any)=>({date:sp.date,type:"split" as const,qty:0,price:0,sellIdx:-1,targetShares:parseFloat(sp.ratio)||0})),
      ].sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime());
      const lots: {qty:number,price:number}[] = [];
      const newSells = sells.map((s:any)=>({...s}));
      for (const e of events) {
        if (e.type==="buy") {
          lots.push({ qty:e.qty, price:e.price });
        } else if (e.type==="sell") {
          let rem=e.qty, cost=0, got=0;
          while (rem>1e-12 && lots.length) {
            const take=Math.min(lots[0].qty,rem);
            cost+=take*lots[0].price; got+=take;
            lots[0].qty-=take; rem-=take;
            if (lots[0].qty<=1e-12) lots.shift();
          }
          const basis = got>0 ? cost/got : 0;
          const tx = newSells[e.sellIdx];
          // transfer-outs were recorded at basis price for zero P&L — keep them zero at the new basis
          const isTransfer = tx.sellPrice === tx.avgCostAtSale;
          const sellPrice = isTransfer ? basis : (tx.sellPrice||0);
          const fees = tx.fees||0;
          const grossGain = (sellPrice - basis) * tx.qty;
          const gain = grossGain - fees;
          const gainPct = basis>0 && tx.qty>0 ? (gain/(basis*tx.qty)*100) : 0;
          if (Math.abs((tx.gain||0)-gain) > 0.005 || Math.abs((tx.avgCostAtSale||0)-basis) > 0.005) changed++;
          Object.assign(tx, { avgCostAtSale: basis, sellPrice, proceeds: tx.qty*sellPrice, grossGain, gain, gainPct });
        } else if (e.targetShares>0) {
          const cur=lots.reduce((s,l)=>s+l.qty,0);
          if (cur>0){ const f=e.targetShares/cur; for(const l of lots){ l.qty*=f; l.price/=f; } }
        }
      }
      return { ...h, realizedHistory: newSells };
    });
    setAndSave(updated);
    msg(`คำนวณใหม่แบบ FIFO แล้ว — อัพเดท ${changed} รายการขาย ✓`, 5000);
  };

  const importCSV = () => {
    try {
      const entries = parseCSV(importText);
      if (!entries.length) { alert("ไม่พบข้อมูล"); return; }
      makeBackup("Import holdings CSV");
      setAndSave([...holdings, ...entries]);
      setImportText(""); setShowImport(false); msg(`นำเข้า ${entries.length} รายการแล้ว ✓`);
    } catch { alert("Format: SYMBOL,จำนวนหุ้น,ต้นทุน,ราคาปัจจุบัน,กลุ่ม,หมายเหตุ"); }
  };

  const importTxCSV = () => {
    const lines = txImportText.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const dataLines = lines.filter(l=>!/^วันที่|^date/i.test(l));
    if (!dataLines.length) { alert("ไม่พบข้อมูล"); return; }
    let updatedHoldings = holdings.map((h:any)=>({...h}));
    let buyCount=0, sellCount=0, splitCount=0, skipCount=0, insufficientCount=0, dupCount=0;
    const pendingSplitOut: Record<string,{qty:number,iso:string}> = {};
    // Duplicate guards — re-pasting the same CSV must not double-record transactions
    const isDupBuy = (h:any, iso:string, qty:number, price:number) =>
      (h.buyHistory||[]).some((b:any)=>b.date===iso && Math.abs(b.qty-qty)<1e-9 && Math.abs(b.price-price)<1e-9);
    const isDupSell = (h:any, iso:string, qty:number) =>
      (h.realizedHistory||[]).some((s:any)=>s.date===iso && Math.abs(s.qty-qty)<1e-9);
    const isDupSplit = (h:any, iso:string) =>
      (h.splitHistory||[]).some((sp:any)=>sp.date===iso);
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
          if (isDupBuy(updatedHoldings[idx], iso, qty, price)) { dupCount++; continue; }
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
        if (isDupSell(updatedHoldings[idx], iso, qty)) { dupCount++; continue; }
        const eff = computeFromHistory(updatedHoldings[idx]);
        if (qty > eff.shares + 1e-9) { insufficientCount++; continue; } // จำนวนไม่พอขาย
        const avgCostAtSale = fifoBasisForSale(updatedHoldings[idx], qty); // FIFO basis of sold lots
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
          if (isDupSell(updatedHoldings[idx], iso, qty)) { dupCount++; continue; }
          const eff = computeFromHistory(updatedHoldings[idx]);
          if (qty > eff.shares + 1e-9) { insufficientCount++; continue; } // จำนวนไม่พอขาย
          const avgCostAtSale = fifoBasisForSale(updatedHoldings[idx], qty); // transfer-out at FIFO basis → zero P&L
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
            if (isDupSplit(h, iso)) { dupCount++; continue; }
            updatedHoldings[idx] = { ...h, splitHistory:[...(h.splitHistory||[]),{date:iso,ratio:qty.toFixed(7)}] };
          }
          splitCount++;
        } else {
          // Has price or no pending - → regular add at given price
          const buyEntry = { date:iso, qty, price, type:"adjustment" };
          const idx = updatedHoldings.findIndex((h:any)=>h.symbol===symbol);
          if (idx>=0) {
            if (isDupBuy(updatedHoldings[idx], iso, qty, price)) { dupCount++; continue; }
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
        if (isDupSplit(h, iso)) { dupCount++; continue; } // re-applying would compound the split
        const eff = computeFromHistory(h);
        const newSharesCount = eff.shares * ratio;
        updatedHoldings[idx] = { ...h, splitHistory: [...(h.splitHistory||[]), { date: iso, ratio: newSharesCount.toFixed(7) }] };
        splitCount++;
      } else { skipCount++; }
    }
    makeBackup("Import ประวัติ");
    setAndSave(updatedHoldings);
    setTxImportText(""); setShowTxImport(false);
    msg(`นำเข้าแล้ว: ซื้อ ${buyCount} | ขาย ${sellCount}${splitCount>0?` | Split ${splitCount}`:""}${dupCount>0?` | ⚠️ ซ้ำ (ข้าม) ${dupCount}`:""}${insufficientCount>0?` | จำนวนไม่พอขาย ${insufficientCount}`:""}${skipCount>0?` | ข้าม ${skipCount}`:""} ✓`, (insufficientCount>0||dupCount>0)?6000:3000);
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
    const applied = Object.keys(updates).filter(s => holdings.some((h:any)=>h.symbol===s));
    const notFound = Object.keys(updates).filter(s => !holdings.some((h:any)=>h.symbol===s));
    // Normalize applied targets so they sum to 100% (AI math is often a few % off)
    const rawSum = applied.reduce((s,k)=>s+updates[k],0);
    let normNote = "";
    if (rawSum > 0 && Math.abs(rawSum - 100) > 0.1) {
      const factor = 100 / rawSum;
      applied.forEach(k => { updates[k] = Math.round(updates[k]*factor*100)/100; });
      normNote = ` — ปรับรวม ${rawSum.toFixed(1)}%→100%`;
    }
    makeBackup("วาง Target %");
    const updated = holdings.map((h:any) => { const pct = updates[h.symbol]; return pct !== undefined ? {...h, targetPct: pct} : h; });
    setHoldings(updated); saveData(updated); setAllocText(""); setShowAllocImport(false);
    msg(`ใส่ target % ให้ ${applied.length} ตัวแล้ว ✓${normNote}${notFound.length>0?` (ไม่เจอ: ${notFound.join(",")})`:"" }`);
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
    const p=`คุณคือ Chief Investment Officer (CIO) ที่มีประสบการณ์ 25 ปี วันนี้คือ ${lastUpdate}\n\n## ขั้นตอนที่ 1 — ค้นข้อมูลพื้นฐานก่อนวิเคราะห์\nค้นหาข้อมูลต่อไปนี้ของทุกหลักทรัพย์ก่อน:\n- Revenue & Earnings Growth YoY ล่าสุด\n- Free Cash Flow\n- Moat (pricing power, switching cost, network effect)\n- Valuation P/E, P/S เทียบ peers\n- Debt/Equity\n- Management track record\n- Competitive position\n\n## ภารกิจ\nวิเคราะห์และแนะนำสัดส่วนที่เหมาะสม โดยคิดเหมือนการจัดทัพ\n\n## กฎการจัดทัพ (รวมต้องได้ 100% พอดี)\n- 🏆 แม่ทัพ (5-10%): moat ชัดเจน pricing power สูง — มีแค่ 1 ตัวก็ได้ถ้า conviction สูงพอ\n- ⚔️ รองแม่ทัพ (2-4%): thesis ชัด ความเสี่ยงสูงกว่า Core — ไม่มีขั้นต่ำ\n- 🛡️ ทหารเสริม (0.5-1%): high-risk/thematic — รวมไม่เกิน 15%\n- หลักสำคัญ: จัดตามคุณภาพจริงๆ อย่าฝืน ยิ่ง Core น้อยตัวยิ่งดี\n\n## เกณฑ์ปลดออก (ต้องตรงอย่างน้อย 1 และต้องมีหลักฐาน)\n1. Business model พัง/disrupted ถาวร\n2. Moat หายไป competition ทำลายจนไม่เหลือ\n3. Management แย่/ทุจริต มีหลักฐานชัด\n4. Valuation bubble ไม่มี growth justify\n5. Structural decline ระยะยาว\n\n## กฎเหล็กก่อนปลด (สำคัญมาก)\n- ทุกตัวที่จะปลดตามเกณฑ์ 1-5 ต้องระบุ "พื้นฐานเปลี่ยนจากอะไร → เป็นอะไร" ให้ชัด พร้อมหลักฐาน/ตัวเลข\n- ถ้าพื้นฐานเปลี่ยนแล้ว "ยังดีอยู่/ยังรับได้" → ห้ามปลด ให้ถือต่อ (ปลดได้เฉพาะเมื่อสถานะใหม่แย่จริง)\n- ถ้าระบุ before→after ให้ชัดไม่ได้ = หลักฐานไม่พอ = ห้ามปลด\n\n## ไม่ใช่เหตุผลปลด (เด็ดขาด): P&L ติดลบ, ราคาลงระยะสั้น, สัดส่วนเล็ก/เพิ่งซื้อ, "เจือจางพอร์ต/จำนวนตัวเยอะเกิน" — position เล็กเพราะเพิ่งเริ่มสะสม ไม่ใช่เหตุผลตัด ห้ามปลดหุ้นรายตัวที่พื้นฐานดีเพราะตัวเล็ก ตัดสินที่คุณภาพพื้นฐานเท่านั้น\n\n## ข้อยกเว้นเดียวที่ตัดได้โดยไม่อ้างเกณฑ์ 1-5: เฉพาะ ETF ที่ track index เดียวกันเป๊ะ (holdings เหมือนกันแทบ 100%) เช่น VOO/IVV/SPY (S&P 500 ทั้งหมด) หรือ QQQ/QQQM (Nasdaq-100 ทั้งคู่) — เก็บตัวเดียว ยุบที่เหลือ\n- "คล้ายกันแต่ไม่เหมือน = ห้ามยุบ" เช่น VYM vs SCHD (dividend คนละ index/วิธีคัดหุ้น), VIG/SPYD/SPHD (dividend คนละสูตร), JEPQ (covered-call income) vs QQQ, DIA (Dow 30) vs VOO (S&P 500), SMH, VYMI — ต่างวิธี/ต่างหน้าที่ เก็บไว้ทุกตัว\n- ใช้กับ ETF เท่านั้น ห้ามใช้กับหุ้นรายตัว\n\n## รูปแบบผลลัพธ์\n🏆 แม่ทัพ | ⚔️ รองแม่ทัพ | 🛡️ ทหารเสริม | ❌ ปลดออก (ระบุเกณฑ์ + พื้นฐานเปลี่ยนจาก→เป็น)\n\n## ผลลัพธ์สุดท้าย — TARGET ALLOCATION (วางกลับในเมนู "📥 Paste ผลวิเคราะห์จาก Claude" ได้ทันที)\nปิดท้ายคำตอบด้วยบล็อกนี้ในโค้ดบล็อก เพื่อก๊อปวางในแอปได้เลย — กฎเข้ม ห้ามผิด:\n- 1 บรรทัด = 1 symbol รูปแบบ: SYMBOL | ประเภท | %\n- ต้องครบ ${activeHoldings.length} บรรทัด = ทุกตัวในพอร์ต ห้ามข้ามแม้แต่ตัวเดียว รวมตัวที่แนะนำปลด (ใส่ "ตัดออก | 0%") — ห้ามเขียนตัวที่ปลดไว้แค่ในคำบรรยาย ต้องอยู่ในบล็อกด้วย\n- SYMBOL = ticker จริงตัวเดียวเป๊ะตามพอร์ต ห้ามมีวงเล็บ/คำต่อท้าย/หมายเหตุ (ผิด: "NVDA-สำรอง(NVO)" — ถ้าหมายถึง NVO ให้ขึ้นบรรทัดใหม่ว่า "NVO | ... | ...")\n- ห้ามใส่บรรทัดหัวตาราง (header) และห้าม emoji หรือข้อความอื่นในบรรทัด\n- ผลรวมทุกตัว = 100.0% พอดี — บวกทวนก่อนตอบ ถ้าไม่ครบหรือเกิน ให้ปรับที่ตัวใหญ่สุดจนได้ 100.0% เป๊ะ\nเช่น:\n\`\`\`\nNVDA | Core | 8%\nLLY | Core | 7%\nINTC | ตัดออก | 0%\nEOSE | ตัดออก | 0%\n\`\`\`\n\n---\nPORTFOLIO "${currentPortName}" (${activeHoldings.length} positions | $${tv.toFixed(0)} | ต้นทุน $${tc.toFixed(0)})\nSectors: ${sectors||"ไม่ระบุ"}\n${rows}\n\n---\nวิเคราะห์พื้นฐานระยะยาว วิเคราะห์เป็นภาษาไทย`;
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
  // hidden = deleted from the port but kept for its realized history (แท็บประวัติ reads raw `holdings`)
  const effectiveHoldings = holdings.filter((h:any) => !h.hidden).map((h:any) => {
    const computed = computeFromHistory(h);
    return { ...h, shares: computed.shares, avgCost: computed.avgCost };
  });
  // Positions we still hold — fully-sold ones stay in `holdings` for realized P&L
  // but must be excluded from analysis/allocation prompts.
  const activeHoldings = effectiveHoldings.filter((h:any) => h.shares > 0.000001);

  // Use effective (FIFO history-derived) values for both, so the summary matches
  // the per-row unrealized in the table. Raw holdings.shares/avgCost go stale after
  // sells/splits and include hidden (deleted) positions.
  const tv=effectiveHoldings.reduce((s:number,h:any)=>s+h.shares*h.currentPrice,0);
  const tc=effectiveHoldings.reduce((s:number,h:any)=>s+h.shares*h.avgCost,0);
  const pnl=tv-tc; const pnlPct=tc>0?pnl/tc*100:0;
  const pc=(v:number)=>v>=0?"var(--gain)":"var(--loss)";
  const moversCount=activeHoldings.filter((h:any)=>h.changePct!=null&&Math.abs(h.changePct)>=3).length;

  // Realized P&L across all holdings (persists even after fully sold/removed... well, only while holding exists)
  const totalRealizedAll = holdings.reduce((s:number,h:any) => s + (h.realizedHistory||[]).reduce((s2:number,r:any)=>s2+r.gain,0), 0);
  const realizedTxCount = holdings.reduce((s:number,h:any) => s + (h.realizedHistory||[]).length, 0);

  // Today's % across the whole portfolio, derived from each position's already-fetched changePct
  // (per-share prev-close implied by currentPrice/changePct) — purely a render-time aggregate, no new data source.
  const todayBase = activeHoldings.reduce((s:number,h:any)=>{
    const prev = h.changePct!=null ? h.currentPrice/(1+h.changePct/100) : h.currentPrice;
    return s + h.shares*prev;
  }, 0);
  const todayChange = activeHoldings.reduce((s:number,h:any)=>{
    const prev = h.changePct!=null ? h.currentPrice/(1+h.changePct/100) : h.currentPrice;
    return s + h.shares*(h.currentPrice-prev);
  }, 0);
  const todayPct = todayBase>0 ? todayChange/todayBase*100 : 0;

  const latestPriceTime = activeHoldings.reduce((mx:number,h:any)=> h.priceTime ? Math.max(mx, new Date(h.priceTime).getTime()) : mx, 0);
  const priceAsOf = latestPriceTime>0 ? new Date(latestPriceTime) : lastUpdated;

  // Search + sort over activeHoldings for the portfolio tab (§5.2) — render-only
  // filtering/ordering, doesn't touch effectiveHoldings/activeHoldings themselves.
  const weightOf = (h:any) => tv>0 ? (h.shares*h.currentPrice/tv*100) : 0;
  const filteredHoldingsList = (() => {
    let list = [...activeHoldings];
    const q = query.trim().toUpperCase();
    if (q) list = list.filter((h:any)=>h.symbol.toUpperCase().includes(q) || (h.sector||"").toUpperCase().includes(q));
    if (sortBy === "under") {
      list = list.filter((h:any)=>h.targetPct>0 && weightOf(h)<h.targetPct);
      list.sort((a:any,b:any)=>(b.targetPct-weightOf(b))-(a.targetPct-weightOf(a)));
      return list;
    }
    list.sort((a:any,b:any)=>{
      if (sortBy==="az") { const c=a.symbol.localeCompare(b.symbol); return sortDesc?-c:c; }
      let av=0, bv=0;
      if (sortBy==="value") { av=a.shares*a.currentPrice; bv=b.shares*b.currentPrice; }
      else if (sortBy==="pl") { av=a.avgCost>0?(a.currentPrice-a.avgCost)/a.avgCost:-Infinity; bv=b.avgCost>0?(b.currentPrice-b.avgCost)/b.avgCost:-Infinity; }
      else if (sortBy==="today") { av=a.changePct==null?-Infinity:a.changePct; bv=b.changePct==null?-Infinity:b.changePct; }
      return sortDesc ? bv-av : av-bv;
    });
    return list;
  })();

  if (!loaded) return (
    <div style={{background:"var(--bg)",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
      <div style={{fontSize:26,fontWeight:800,letterSpacing:"0.14em",fontFamily:'"Avenir Next",Futura,"Segoe UI",system-ui,sans-serif'}}>
        <span style={{color:"var(--brass)"}}>SA</span><span style={{color:"var(--ink)"}}>SOM</span>
      </div>
      <div style={{fontSize:13,color:"var(--mut)"}}>กำลังโหลด...</div>
    </div>
  );

  return (
    <div style={{background:"var(--bg)",minHeight:"100vh"}}>
      <Snackbar status={status} onClose={()=>setStatus("")}/>
      {/* App bar */}
      <div style={{background:"var(--card)",borderBottom:"1px solid var(--line)",padding:"10px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div className="appbar-wordmark" style={{fontSize:17,fontWeight:800,letterSpacing:"0.14em",fontFamily:'"Avenir Next",Futura,"Segoe UI",system-ui,sans-serif'}}>
          <span style={{color:"var(--brass)"}}>SA</span><span style={{color:"var(--ink)"}}>SOM</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"relative"}}>
          {userEmail && (
            <span style={{fontSize:11,color:"var(--mut)"}}>
              <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:saving?"var(--warn)":"var(--gain)",marginRight:5}}/>
              {currentPortName}
            </span>
          )}
          {userEmail ? (
            <div style={{position:"relative"}}>
              <button onClick={()=>setAvatarMenuOpen(v=>!v)} aria-label="บัญชี" style={{width:30,height:30,borderRadius:"50%",background:"var(--brass)",color:"var(--on-brass)",border:"none",fontWeight:800,fontSize:13,cursor:"pointer"}}>
                {userEmail.charAt(0).toUpperCase()}
              </button>
              {avatarMenuOpen && (
                <>
                  <div onClick={()=>setAvatarMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:60}}/>
                  <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:"var(--card)",border:"1px solid var(--line)",borderRadius:"var(--r-sm)",boxShadow:"var(--shadow)",padding:8,minWidth:200,zIndex:61}}>
                    <div style={{fontSize:11,color:"var(--mut)",padding:"6px 8px",wordBreak:"break-all"}}>{userEmail}</div>
                    <button onClick={async()=>{setAvatarMenuOpen(false);setSaving(true);msg("Sync...",0);try{await saveData(holdings);}catch(e:any){msg("Sync ไม่ได้: "+e.message);}setSaving(false);}} disabled={saving||!holdings.length||!token}
                      style={{...btnGhost({width:"100%",textAlign:"left",fontSize:13,marginBottom:4}),opacity:(!token||saving||!holdings.length)?0.5:1}}>
                      {saving?"กำลัง Sync...":"Sync → Drive"}
                    </button>
                    <button onClick={()=>{setAvatarMenuOpen(false);handleLogout();}} style={{...btnGhost({width:"100%",textAlign:"left",fontSize:13,color:"var(--loss)"})}}>ออกจากระบบ</button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button onClick={handleGoogleLogin} disabled={googleLoading} style={{...btnGhost({opacity:googleLoading?0.6:1,fontSize:12})}}>
              {googleLoading?"กำลัง Login...":"Login Google Drive"}
            </button>
          )}
        </div>
      </div>

      {/* Portfolio Selector */}
      {userEmail && (
        <div style={{background:"var(--card)",borderBottom:"1px solid var(--line)",padding:"8px 20px",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:"var(--faint)"}}>Port:</span>
          {portfolios.map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:4}}>
              <button onClick={()=>switchPort(p.id,p.name)}
                style={btn(currentPortId===p.id?"var(--brass)":"var(--card2)", currentPortId===p.id?"var(--on-brass)":"var(--mut)",{fontSize:12,padding:"4px 10px"})}>
                {p.name}
              </button>
              {portfolios.length > 1 && <button onClick={()=>deletePort(p.id,p.name)} style={{background:"none",border:"none",color:"var(--faint)",cursor:"pointer",fontSize:12}}>✕</button>}
            </div>
          ))}
          {showNewPort ? (
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input value={newPortName} onChange={e=>setNewPortName(e.target.value)} placeholder="ชื่อ port" onKeyDown={e=>e.key==="Enter"&&createPort()}
                style={{background:"var(--bg)",border:"1px solid var(--line)",borderRadius:4,color:"var(--ink)",fontSize:12,padding:"4px 8px",width:120}}/>
              <button onClick={createPort} style={btn("var(--brass)","var(--on-brass)",{fontSize:12,padding:"4px 10px"})}>สร้าง</button>
              <button onClick={()=>setShowNewPort(false)} style={btn("var(--line)","var(--mut)",{fontSize:12,padding:"4px 8px"})}>ยกเลิก</button>
            </div>
          ) : (
            <button onClick={()=>setShowNewPort(true)} style={btn("var(--card2)","var(--faint)",{fontSize:12,padding:"4px 10px"})}>+ สร้าง Port ใหม่</button>
          )}
          <button onClick={()=>{ if(token){ msg("กำลังรีเฟรช...",0); listPortfolios(token).then(ps=>{setPortfolios(ps);msg("รีเฟรชแล้ว ✓");}).catch((e:any)=>msg("รีเฟรชไม่ได้: "+e.message)); } }}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"var(--faint)",padding:"4px 6px"}} title="รีเฟรชรายการ Port">🔄</button>
        </div>
      )}

      <div className="app-body" style={{maxWidth:1320,margin:"0 auto"}}>

        <AppShell tab={tab} onTabChange={setTab}/>

        <div className="content-area">

        {/* PORTFOLIO TAB */}
        {tab==="portfolio"&&(
          <div>

            {/* Hero summary card */}
            <div style={{background:"var(--card)",border:"1px solid var(--line)",borderRadius:"var(--r-lg)",padding:18,boxShadow:"var(--shadow)",marginBottom:12}}>
              <div style={{fontSize:10.5,color:"var(--faint)",textTransform:"uppercase",letterSpacing:"0.14em"}}>มูลค่าพอร์ต</div>
              <div style={{fontSize:27,fontWeight:800,color:"var(--ink)",marginTop:4}}>${tv.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:700,color:todayPct>=0?"var(--gain)":"var(--loss)",background:"var(--card2)",borderRadius:999,padding:"3px 10px"}}>
                  {todayPct>=0?"▲":"▼"} วันนี้ {todayPct>=0?"+":""}{todayPct.toFixed(2)}%
                </span>
                <span style={{fontSize:12,fontWeight:700,color:pc(pnl),background:"var(--card2)",borderRadius:999,padding:"3px 10px"}}>
                  รวม {pnlPct>=0?"+":""}{pnlPct.toFixed(1)}%
                </span>
              </div>
              <div style={{display:"flex",gap:16,marginTop:14,paddingTop:12,borderTop:"1px solid var(--line)",flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:10,color:"var(--faint)"}}>Unrealized</div>
                  <div style={{fontSize:13,fontWeight:700,color:pc(pnl)}}>{pnl>=0?"+":""}${pnl.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"var(--faint)"}}>Realized</div>
                  <div style={{fontSize:13,fontWeight:700,color:pc(totalRealizedAll)}}>{totalRealizedAll>=0?"+":""}${totalRealizedAll.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"var(--faint)"}}>ถืออยู่</div>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--ink)"}}>{activeHoldings.length} ตัว{effectiveHoldings.length>activeHoldings.length?` · ขายหมด ${effectiveHoldings.length-activeHoldings.length}`:""}</div>
                </div>
              </div>
              <button onClick={refreshPrices} disabled={refreshing||!holdings.length}
                style={{...btnPrimary({width:"100%",marginTop:14}),opacity:(refreshing||!holdings.length)?0.6:1}}>
                {refreshing ? (status||"กำลังดึงราคา...") : "อัพเดทราคา"}
              </button>
              <div style={{fontSize:11,color:"var(--faint)",marginTop:8,textAlign:"center"}}>
                {priceAsOf ? `ราคาเมื่อ ${priceAsOf.toLocaleString("th-TH",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})} · Cboe + CNBC` : "ยังไม่เคยอัพเดทราคา — กดปุ่มด้านบน"}
              </div>
            </div>

            {!userEmail&&(
              <div style={{background:"var(--card)",border:"1px solid var(--brass)",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"var(--brass)"}}>
                💡 Login Google Drive เพื่อให้ข้อมูลซิงค์ทุกเครื่อง และรองรับหลาย Portfolio
              </div>
            )}

            {priceErrors.length>0&&(
              <div style={{background:"var(--card)",border:"1px solid var(--loss)",borderRadius:8,padding:12,marginBottom:12,color:"var(--loss)"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>⚠️ ดึงราคาไม่ได้ ({priceErrors.length} ตัว)</div>
                {priceErrors.map((e,i)=><div key={i} style={{fontSize:11,wordBreak:"break-all",marginBottom:2}}>• {e}</div>)}
                <button onClick={()=>setPriceErrors([])} style={{marginTop:8,background:"none",border:"1px solid var(--loss)",borderRadius:4,color:"var(--loss)",fontSize:11,cursor:"pointer",padding:"2px 8px"}}>✕ ปิด</button>
              </div>
            )}

            {showImport&&(
              <div style={{background:"var(--card)",borderRadius:8,padding:16,marginBottom:12,border:"1px solid var(--line)"}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:8}}>Format: SYMBOL,จำนวนหุ้น,ต้นทุน,ราคาปัจจุบัน,กลุ่ม,หมายเหตุ</div>
                <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder={"AAPL,100,150.00,175.00,Tech\nTSLA,50,200.00,404.00,EV"} style={{width:"100%",minHeight:100,background:"var(--bg)",color:"var(--ink)",border:"1px solid var(--line)",borderRadius:6,padding:10,fontSize:13,resize:"vertical"}}/>
                <button onClick={importCSV} style={{...btn("var(--brass)","var(--on-brass)"),marginTop:8}}>นำเข้า</button>
              </div>
            )}

            {holdings.length>0 && holdings.some((h:any)=>(h.buyHistory||[]).length>0||(h.realizedHistory||[]).length>0) && (
              <div style={{fontSize:11,color:"var(--faint)",marginBottom:8}}>* จำนวนและต้นทุนคำนวณจากประวัติ 🛒ซื้อ/💰ขาย ใน 📜 ประวัติ (แก้ผ่านปุ่ม ⋮ เท่านั้น)</div>
            )}

            {holdings.length>0 && (<>
              {/* Search + sort (§5.2) */}
              <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
                <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ค้นหา symbol / sector..."
                  style={{flex:1,minWidth:160,background:"var(--card)",border:"1px solid var(--line)",borderRadius:8,padding:"8px 12px",color:"var(--ink)",fontSize:13}}/>
                <button onClick={()=>{setShowAddSheet(true);}} style={{...btnPrimary({fontSize:12,padding:"8px 14px",whiteSpace:"nowrap"})}}>+ เพิ่มหลักทรัพย์</button>
                <ToolsMenu items={[
                  { label:"Import CSV", onClick:()=>setShowImport(v=>!v) },
                  { label:"Export CSV", onClick:exportCSV },
                  { label:"เคลียข้อมูลทั้งหมด", danger:true, disabled:!holdings.length, onClick:()=>{ if(window.confirm(`ลบทั้งหมด ${holdings.length} รายการ?`)) setAndSave([]); } },
                ]}/>
              </div>
              <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                {([["value","มูลค่า"],["pl","P&L %"],["today","วันนี้"],["az","A–Z"],["under","ยังไม่ถึงเป้า"]] as const).map(([key,label])=>(
                  <button key={key} onClick={()=>{ if(sortBy===key) setSortDesc(v=>!v); else { setSortBy(key); setSortDesc(key!=="az"); } }}
                    style={{fontSize:11,fontWeight:600,padding:"5px 11px",borderRadius:999,cursor:"pointer",
                      background:sortBy===key?"var(--brass)":"var(--card2)", color:sortBy===key?"var(--on-brass)":"var(--mut)", border:"none"}}>
                    {label}{sortBy===key&&key!=="under"?(sortDesc?" ↓":" ↑"):""}
                  </button>
                ))}
              </div>
            </>)}

            {holdings.length===0?(
              <div style={{textAlign:"center",padding:"40px 20px",color:"var(--faint)"}}>
                <div style={{fontSize:36}}>📂</div><div style={{marginTop:8}}>ยังไม่มีหลักทรัพย์</div>
                <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:14}}>
                  <button onClick={()=>setShowAddSheet(true)} style={{...btnPrimary({fontSize:13})}}>+ เพิ่มหลักทรัพย์</button>
                  <button onClick={()=>setShowImport(true)} style={{...btnGhost({fontSize:13})}}>Import CSV</button>
                </div>
              </div>
            ):filteredHoldingsList.length===0?(
              <div style={{textAlign:"center",padding:"40px 20px",color:"var(--faint)"}}>
                <div style={{marginTop:8}}>{query?`ไม่พบ "${query}"`:sortBy==="under"?"ทุกตัวถึงเป้าแล้ว 🎉":"ไม่มีหุ้นที่ถืออยู่ — ตัวที่ขายหมดยังดูได้ในแท็บประวัติ"}</div>
                {query && <button onClick={()=>setQuery("")} style={{...btnGhost({fontSize:12,marginTop:10})}}>ล้างการค้นหา</button>}
              </div>
            ):(<>
              {/* Mobile: card list */}
              <div className="holdings-cards">
                <HoldingsList holdings={filteredHoldingsList} tv={tv} pc={pc} onSelect={setDetailId}/>
              </div>

              {/* Desktop: table */}
              <div className="holdings-table-wrap">
              <div style={{overflow:"auto",maxHeight:"75vh"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{color:"var(--ink)"}}>
                      {["หลักทรัพย์","จำนวน*","ต้นทุน*","ราคา","วันนี้","P&L %","Realized","Unrealized","มูลค่า ($)","สัดส่วน / เป้า",""].map((h,ci)=>(
                        <th key={h} style={{padding:"8px 8px",textAlign:h==="หลักทรัพย์"||h==="สัดส่วน / เป้า"?"left":h===""?"center":"right",fontWeight:600,whiteSpace:"nowrap",
                          position:"sticky",top:0,zIndex:ci===0?3:2,background:"var(--card)",borderBottom:"1px solid var(--line)",
                          ...(ci===0?{left:0}:{})}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHoldingsList.map((h:any)=>{
                      const val=h.shares*h.currentPrice; const pp=h.avgCost>0?((h.currentPrice-h.avgCost)/h.avgCost*100):0;
                      const realized=(h.realizedHistory||[]).reduce((s:number,r:any)=>s+(r.gain||0),0);
                      const unrealized=h.shares>0?(h.currentPrice-h.avgCost)*h.shares:0;
                      const w=tv>0?(val/tv*100):0; const target=h.targetPct||0;
                      const over=target>0?w-target:0; const overAmt=over>0?(over/100*tv):0;
                      // $ to buy so this position reaches target weight (buying also grows total value)
                      const underNeed=(target>0&&target<100&&w<target)?((target/100*tv-val)/(1-target/100)):0;
                      const barPct=target>0?Math.min(w/target*100,150):0;
                      const barColor=over>0?"var(--loss)":w>0?"var(--brass)":"var(--line)";
                      const isAlert=h.changePct!=null&&Math.abs(h.changePct)>=3;
                      const stickyBg=isAlert?"var(--card2)":"var(--bg)"; // opaque bg so frozen column doesn't show rows behind
                      const isStale=h.priceTime && (Date.now()-h.priceTime > 24*3600*1000); // price older than 24h
                      return (<>
                        <tr key={h.id} style={{borderBottom:"1px solid var(--card2)",background:isAlert?"rgba(255,200,0,0.04)":"transparent"}}>
                          <td style={{padding:"8px 8px",position:"sticky",left:0,zIndex:1,background:stickyBg}}>
                            <div style={{display:"flex",alignItems:"center",gap:4}}>
                              {isAlert&&<span>⚡</span>}
                              {editId===h.id?<input value={h.symbol} onChange={e=>updateH(h.id,"symbol",e.target.value)} style={inp}/>:<span style={{fontWeight:700,color:"var(--brass)"}}>{h.symbol}</span>}
                            </div>
                            {h.sector&&<div style={{fontSize:10,color:"var(--mut)"}}>{h.sector}</div>}
                          </td>
                          {["shares","avgCost","currentPrice"].map(f=>(
                            <td key={f} style={{padding:"8px 8px",textAlign:"right",color:"var(--ink)"}}>
                              {editId===h.id&&f==="currentPrice"?<input type="number" value={h[f]} onChange={e=>updateH(h.id,f,e.target.value)} style={{...inp,width:72}}/>
                              :<span>{f==="shares"?Number(h[f]).toFixed(7):f==="avgCost"?Number(h[f]).toFixed(4):Number(h[f]).toLocaleString()}</span>}
                              {f==="currentPrice"&&h.priceTime&&editId!==h.id&&(
                                <div title={isStale?"ราคาเก่ากว่า 24 ชม. — กดอัพเดทราคา":undefined} style={{fontSize:9,color:isStale?"var(--warn)":"var(--faint)",whiteSpace:"nowrap"}}>{isStale?"⚠ ":""}{new Date(h.priceTime).toLocaleString("th-TH",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div>
                              )}
                            </td>
                          ))}
                          <td style={{padding:"8px 8px",textAlign:"right",color:h.changePct==null?"var(--faint)":pc(h.changePct),fontWeight:600,fontSize:11}}>
                            {h.changePct==null?"—":`${h.changePct>0?"+":""}${h.changePct}%`}
                          </td>
                          <td style={{padding:"8px 8px",textAlign:"right",color:pc(pp),fontWeight:600}}>{pp>=0?"+":""}{pp.toFixed(2)}%</td>
                          <td style={{padding:"8px 8px",textAlign:"right",color:pc(realized),fontWeight:600,fontSize:11}}>{realized===0?"—":`${realized>=0?"+":""}$${realized.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`}</td>
                          <td style={{padding:"8px 8px",textAlign:"right",color:pc(unrealized),fontWeight:600,fontSize:11}}>{unrealized===0?"—":`${unrealized>=0?"+":""}$${unrealized.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`}</td>
                          <td style={{padding:"8px 8px",textAlign:"right"}}>
                            <div style={{color:"var(--ink)"}}>${val.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                            {h.avgCost>0&&val>0&&(()=>{const cost=h.shares*h.avgCost;const diff=val-cost;return <div style={{fontSize:10,color:diff>=0?"var(--gain)":"var(--loss)",fontWeight:600}}>{diff>=0?"+":""}{diff.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})} ({pp>=0?"+":""}{pp.toFixed(2)}%)</div>;})()}
                          </td>
                          <td style={{padding:"8px 8px",minWidth:150}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                              <span style={{fontSize:11,color:over>0?"var(--loss)":"var(--ink)",fontWeight:600}}>{w.toFixed(1)}%</span>
                              {editId===h.id?(
                                <div style={{display:"flex",alignItems:"center",gap:3}}>
                                  <span style={{fontSize:10,color:"var(--faint)"}}>เป้า</span>
                                  <input type="number" value={h.targetPct!=null?h.targetPct:""} placeholder="-" onChange={e=>updateH(h.id,"targetPct",e.target.value)} style={{...inp,width:44,fontSize:11,padding:"2px 4px"}}/>
                                  <span style={{fontSize:10,color:"var(--faint)"}}>%</span>
                                </div>
                              ):h.targetPct===0&&target===0&&holdings.some((x:any)=>x.id===h.id&&typeof x.targetPct==="number"&&x.targetPct===0&&x.targetPct!==undefined)?(
                                <span style={{fontSize:10,color:"var(--loss)",fontWeight:600}}>❌ ตัดออก</span>
                              ):target>0?(
                                <span style={{fontSize:10,color:"var(--faint)"}}>/ {target}%</span>
                              ):(
                                <span style={{fontSize:10,color:"var(--faint)"}}>ไม่ได้ตั้ง</span>
                              )}
                            </div>
                            {target>0&&<div style={{background:"var(--line)",borderRadius:3,height:4,overflow:"hidden"}}><div style={{width:`${Math.min(barPct,100)}%`,height:"100%",background:barColor,borderRadius:3}}/></div>}
                            {over>0&&<div style={{fontSize:10,color:"var(--loss)",marginTop:1}}>เกิน +${overAmt.toFixed(2)}</div>}
                            {underNeed>0&&<div style={{fontSize:10,color:"var(--gain)",marginTop:1}}>ซื้อเพิ่ม ~${underNeed.toLocaleString("en",{maximumFractionDigits:2})} ถึงเป้า</div>}
                          </td>
                          <td style={{padding:"8px 4px",textAlign:"center",whiteSpace:"nowrap"}}>
                            {editId===h.id?(
                              <button onClick={confirmEdit} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"var(--brass)",padding:"2px 4px"}}>✓ บันทึก</button>
                            ):(
                              <button onClick={()=>setActionMenuId(h.id)} style={{background:"var(--line)",border:"none",borderRadius:5,cursor:"pointer",fontSize:14,color:"var(--mut)",padding:"4px 10px"}}>⋮</button>
                            )}
                          </td>
                        </tr>
                      </>);
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            </>)}
          </div>
        )}

        {/* CHART TAB */}
        {tab==="chart"&&(
          <ChartsTab
            activeHoldings={activeHoldings}
            tv={tv}
            onFilterSector={(sector)=>{ setQuery(sector); setTab("portfolio"); }}
            onOpenDetail={setDetailId}
          />
        )}

        {/* TRANSACTIONS TAB */}
        {tab==="transactions"&&(
          <HistoryTab
            holdings={holdings}
            pc={pc}
            txFilterSymbol={txFilterSymbol}
            setTxFilterSymbol={setTxFilterSymbol}
            showTxImport={showTxImport}
            setShowTxImport={setShowTxImport}
            txImportText={txImportText}
            setTxImportText={setTxImportText}
            importTxCSV={importTxCSV}
            recalcRealizedFIFO={recalcRealizedFIFO}
            restoreBackup={restoreBackup}
            makeBackup={makeBackup}
            setAndSave={setAndSave}
            msg={msg}
            computeFromHistory={computeFromHistory}
            openEditTx={openEditTx}
            deleteTx={deleteTx}
          />
        )}

        {/* AI TAB */}
        {tab==="ai"&&(
          <AiTab
            hasHoldings={holdings.length>0}
            moversCount={moversCount}
            onAnalyze={copyForAnalysis}
            onMovers={copyMoversAnalysis}
            onAllocation={copyAllocationAnalysis}
            onNewIdeas={copyNewIdeas}
            showAllocImport={showAllocImport}
            onTogglePasteTarget={()=>setShowAllocImport(v=>!v)}
            allocText={allocText}
            setAllocText={setAllocText}
            onApplyAllocation={parseAndApplyAllocation}
            onCancelPasteTarget={()=>{setShowAllocImport(false);setAllocText("");}}
          />
        )}

        </div>{/* content-area */}
      </div>{/* app-body */}

      {/* EDIT TRANSACTION MODAL */}
      <Sheet open={!!editTxData} onClose={()=>setEditTxData(null)} maxWidth={380}>
        {editTxData && (<>
            <div style={{fontSize:16,fontWeight:700,color:"var(--ink)",marginBottom:4}}>
              ✏️ แก้ไข{editTxData.kind==="buy"?"การซื้อ":editTxData.kind==="sell"?"การขาย":"การแตกพาร์"} {editTxData.symbol}
            </div>
            <div style={{fontSize:11,color:"var(--loss)",marginBottom:16}}>⚠️ การแก้ไขจะกระทบยอดจำนวนหุ้น/ต้นทุนปัจจุบัน</div>

            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>วันเวลา (วัน/เดือน/ปี)</div>
              <DateTimePicker24h value={editTxData.date} onChange={iso=>setEditTxData({...editTxData,date:iso})}/>
            </div>

            {editTxData.kind==="split" ? (
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>จำนวนหุ้นใหม่ (หลังแตกพาร์)</div>
                <input type="number" value={editTxData.ratio} onChange={e=>setEditTxData({...editTxData,ratio:e.target.value})} placeholder="ระบุจำนวนหุ้นหลังแตกพาร์"
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14,boxSizing:"border-box"}}/>
              </div>
            ) : (
              <>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>จำนวนหุ้น</div>
                  <input type="number" value={editTxData.qty} onChange={e=>setEditTxData({...editTxData,qty:e.target.value})}
                    style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14,boxSizing:"border-box"}}/>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>ราคา ($)</div>
                  <input type="number" value={editTxData.price} onChange={e=>setEditTxData({...editTxData,price:e.target.value})}
                    style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14,boxSizing:"border-box"}}/>
                </div>
                {editTxData.kind==="sell" && (
                  <div style={{background:"var(--bg)",borderRadius:8,padding:12,marginBottom:16}}>
                    <div style={{fontSize:11,color:"var(--mut)",marginBottom:8}}>💵 ค่าธรรมเนียม</div>
                    {[
                      {label:"Commission ($)", key:"commission" as const},
                      {label:"SEC Fee ($)", key:"secFee" as const},
                      {label:"TAF Fee ($)", key:"tafFee" as const},
                      {label:"CAT Fee ($)", key:"catFee" as const},
                    ].map(f=>(
                      <div key={f.key} style={{marginBottom:8}}>
                        <div style={{fontSize:11,color:"var(--faint)",marginBottom:3}}>{f.label}</div>
                        <input type="number" value={editTxData[f.key]} onChange={e=>setEditTxData({...editTxData,[f.key]:e.target.value})}
                          style={{width:"100%",background:"var(--card)",border:"1px solid var(--line)",borderRadius:5,padding:"7px 10px",color:"var(--ink)",fontSize:13,boxSizing:"border-box"}}/>
                      </div>
                    ))}
                    <div style={{marginBottom:8,paddingTop:6,borderTop:"1px solid var(--line)"}}>
                      <div style={{fontSize:11,color:"var(--faint)",marginBottom:3}}>VAT 7% ($) <span style={{color:"var(--faint)"}}>(ปล่อยว่าง = อัตโนมัติ {((parseFloat(editTxData.commission)||0)*0.07).toFixed(4)})</span></div>
                      <input type="number" value={editTxData.vat} onChange={e=>setEditTxData({...editTxData,vat:e.target.value})} placeholder={`${((parseFloat(editTxData.commission)||0)*0.07).toFixed(4)}`}
                        style={{width:"100%",background:"var(--card)",border:"1px solid var(--line)",borderRadius:5,padding:"7px 10px",color:"var(--ink)",fontSize:13,boxSizing:"border-box"}}/>
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{display:"flex",gap:8}}>
              <button onClick={saveEditTx} style={{...btn("var(--brass)","var(--on-brass)"),flex:1,padding:"10px"}}>✅ บันทึก</button>
              <button onClick={()=>setEditTxData(null)} style={{...btn("var(--line)","var(--mut)"),flex:1,padding:"10px"}}>ยกเลิก</button>
            </div>
        </>)}
      </Sheet>

      {/* ACTION SHEET MODAL */}
      <Sheet open={actionMenuId !== null} onClose={()=>setActionMenuId(null)} maxWidth={320}>
        {(() => {
          const h = effectiveHoldings.find((x:any)=>x.id===actionMenuId);
          if (!h) return null;
          const actions = [
            { icon:"✏️", label:"แก้ไขข้อมูล", color:"var(--ink)", onClick:()=>{setEditId(h.id);setActionMenuId(null);} },
            { icon:"🛒", label:"ซื้อเพิ่ม", color:"var(--gain)", onClick:()=>{openBuyModal(h.id);setActionMenuId(null);} },
            { icon:"💰", label:"ขาย", color:"var(--warn)", onClick:()=>{openSellModal(h.id);setActionMenuId(null);} },
            { icon:"🔀", label:"แตกพาร์", color:"var(--brass)", onClick:()=>{openSplitModal(h.id);setActionMenuId(null);} },
            { icon:"✕", label:"ลบออกจาก Port", color:"var(--loss)", onClick:()=>{removeH(h.id);setActionMenuId(null);} },
          ];
          return (<>
              <div style={{padding:"0 0 12px",borderBottom:"1px solid var(--line)",marginBottom:4}}>
                <span style={{fontWeight:700,color:"var(--brass)",fontSize:15}}>{h.symbol}</span>
                <span style={{fontSize:12,color:"var(--faint)",marginLeft:8}}>{h.shares.toFixed(4)} หุ้น</span>
              </div>
              {actions.map((a,i)=>(
                <button key={i} onClick={a.onClick} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 16px",background:"none",border:"none",cursor:"pointer",fontSize:14,color:a.color,textAlign:"left",borderRadius:8}}>
                  <span style={{fontSize:18}}>{a.icon}</span>{a.label}
                </button>
              ))}
              <button onClick={()=>setActionMenuId(null)} style={{width:"100%",padding:"10px",marginTop:4,background:"var(--line)",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,color:"var(--mut)"}}>ยกเลิก</button>
          </>);
        })()}
      </Sheet>

      {/* BUY MODAL */}
      <Sheet open={buyModalId !== null} onClose={()=>setBuyModalId(null)} maxWidth={380}>
        {(() => {
        const h = effectiveHoldings.find((x:any)=>x.id===buyModalId);
        if (!h) return null;
        const qty = parseFloat(buyQty)||0;
        const price = parseFloat(buyPrice)||0;
        const oldValue = h.shares*h.avgCost;
        const newValue = qty*price;
        const newShares = h.shares+qty;
        const newAvgCost = newShares>0 ? (oldValue+newValue)/newShares : 0;
        return (<>
              <div style={{fontSize:16,fontWeight:700,color:"var(--gain)",marginBottom:4}}>🛒 ซื้อเพิ่ม {h.symbol}</div>
              <div style={{fontSize:12,color:"var(--faint)",marginBottom:16}}>มีอยู่ {h.shares.toFixed(7)} หุ้น | ทุนเฉลี่ย ${h.avgCost.toFixed(4)}/หุ้น</div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>จำนวนที่ซื้อเพิ่ม</div>
                <input type="number" value={buyQty} onChange={e=>setBuyQty(e.target.value)} placeholder="0" autoFocus
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14}}/>
              </div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>ราคาที่ซื้อ ($)</div>
                <input type="number" value={buyPrice} onChange={e=>setBuyPrice(e.target.value)} placeholder={h.currentPrice?String(h.currentPrice):"0"}
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14}}/>
                <button onClick={()=>setBuyPrice(String(h.currentPrice))} style={{fontSize:11,color:"var(--brass)",background:"none",border:"none",cursor:"pointer",marginTop:4,padding:0}}>ใช้ราคาปัจจุบัน (${h.currentPrice})</button>
              </div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>วันเวลาที่ซื้อ (วัน/เดือน/ปี)</div>
                <DateTimePicker24h value={buyDateTime} onChange={setBuyDateTime}/>
              </div>

              {qty>0 && price>0 && (
                <div style={{background:"var(--bg)",borderRadius:8,padding:12,marginBottom:16}}>
                  <div style={{fontSize:11,color:"var(--faint)",marginBottom:6}}>ผลลัพธ์หลังซื้อเพิ่ม</div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                    <span style={{color:"var(--mut)"}}>จำนวนหุ้น</span>
                    <span style={{color:"var(--ink)"}}>{h.shares.toFixed(4)} → <b style={{color:"var(--brass)"}}>{newShares.toFixed(4)}</b></span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                    <span style={{color:"var(--mut)"}}>ต้นทุนเฉลี่ย/หุ้น</span>
                    <span style={{color:"var(--ink)"}}>${h.avgCost.toFixed(4)} → <b style={{color:"var(--brass)"}}>${newAvgCost.toFixed(4)}</b></span>
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmBuy} disabled={!qty||!price} style={{...btn("var(--brass)","var(--on-brass)"),flex:1,padding:"10px",opacity:(!qty||!price)?0.5:1}}>✅ ยืนยันซื้อเพิ่ม</button>
                <button onClick={()=>setBuyModalId(null)} style={{...btn("var(--line)","var(--mut)"),flex:1,padding:"10px"}}>ยกเลิก</button>
              </div>
        </>);
        })()}
      </Sheet>

      {/* SELL MODAL */}
      <Sheet open={sellModalId !== null} onClose={()=>setSellModalId(null)} maxWidth={380}>
        {(() => {
        const h = effectiveHoldings.find((x:any)=>x.id===sellModalId);
        if (!h) return null;
        const qty = parseFloat(sellQty)||0;
        const price = parseFloat(sellPrice)||0;
        const fees = calcSellFees();
        // Preview with the same FIFO basis confirmSell will record, not the holding average
        const basis = qty>0 ? fifoBasisForSale(h, qty) : h.avgCost;
        const grossGain = (price - basis) * qty;
        const netGain = grossGain - fees.totalFees;
        const netGainPct = basis>0 && qty>0 ? (netGain/(basis*qty)*100) : 0;
        return (<>
              <div style={{fontSize:16,fontWeight:700,color:"var(--warn)",marginBottom:4}}>💰 ขาย {h.symbol}</div>
              <div style={{fontSize:12,color:"var(--faint)",marginBottom:16}}>มีอยู่ {h.shares.toFixed(7)} หุ้น | ทุน ${h.avgCost.toFixed(4)}/หุ้น</div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>จำนวนที่ขาย</div>
                <input type="number" value={sellQty} onChange={e=>setSellQty(e.target.value)} placeholder="0" autoFocus
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14,boxSizing:"border-box"}}/>
                <button onClick={()=>setSellQty(String(h.shares))} style={{fontSize:11,color:"var(--brass)",background:"none",border:"none",cursor:"pointer",marginTop:4,padding:0}}>ขายทั้งหมด ({h.shares.toFixed(4)})</button>
              </div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>ราคาที่ขาย ($)</div>
                <input type="number" value={sellPrice} onChange={e=>setSellPrice(e.target.value)} placeholder={h.currentPrice?String(h.currentPrice):"0"}
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14,boxSizing:"border-box"}}/>
                <button onClick={()=>setSellPrice(String(h.currentPrice))} style={{fontSize:11,color:"var(--brass)",background:"none",border:"none",cursor:"pointer",marginTop:4,padding:0}}>ใช้ราคาปัจจุบัน (${h.currentPrice})</button>
              </div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:4}}>วันเวลาที่ขาย</div>
                <DateTimePicker24h value={sellDateTime} onChange={setSellDateTime}/>
              </div>

              <button onClick={()=>setShowFees(!showFees)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",cursor:"pointer",padding:"8px 0",marginBottom:showFees?8:12}}>
                <span style={{fontSize:12,color:"var(--mut)"}}>💵 ค่าธรรมเนียม (ไม่บังคับ)</span>
                <span style={{fontSize:12,color:"var(--brass)"}}>{showFees?"▲ ซ่อน":"▼ แสดง"}</span>
              </button>

              {showFees && (
                <div style={{background:"var(--bg)",borderRadius:8,padding:12,marginBottom:12}}>
                  {[
                    {label:"Commission Fee ($)", val:sellCommission, set:setSellCommission},
                    {label:"SEC Fee ($)", val:sellSecFee, set:setSellSecFee},
                    {label:"TAF Fee ($)", val:sellTafFee, set:setSellTafFee},
                    {label:"CAT Fee ($)", val:sellCatFee, set:setSellCatFee},
                  ].map(f=>(
                    <div key={f.label} style={{marginBottom:8}}>
                      <div style={{fontSize:11,color:"var(--faint)",marginBottom:3}}>{f.label}</div>
                      <input type="number" value={f.val} onChange={e=>f.set(e.target.value)} placeholder="0"
                        style={{width:"100%",background:"var(--card)",border:"1px solid var(--line)",borderRadius:5,padding:"7px 10px",color:"var(--ink)",fontSize:13,boxSizing:"border-box"}}/>
                    </div>
                  ))}
                  <div style={{marginBottom:8,paddingTop:6,borderTop:"1px solid var(--line)"}}>
                    <div style={{fontSize:11,color:"var(--faint)",marginBottom:3}}>VAT 7% ($) <span style={{color:"var(--faint)"}}>(ปล่อยว่าง = คำนวณอัตโนมัติจาก Commission × 7% = ${((parseFloat(sellCommission)||0)*0.07).toFixed(2)})</span></div>
                    <input type="number" value={sellVat} onChange={e=>setSellVat(e.target.value)} placeholder={`${((parseFloat(sellCommission)||0)*0.07).toFixed(4)}`}
                      style={{width:"100%",background:"var(--card)",border:"1px solid var(--line)",borderRadius:5,padding:"7px 10px",color:"var(--ink)",fontSize:13,boxSizing:"border-box"}}/>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,display:"flex",justifyContent:"space-between",marginTop:4}}>
                    <span style={{color:"var(--mut)"}}>รวมค่าธรรมเนียม</span>
                    <span style={{color:"var(--loss)"}}>${fees.totalFees.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {qty>0 && price>0 && (
                <div style={{background:"var(--bg)",borderRadius:8,padding:12,marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                    <span style={{color:"var(--faint)"}}>ต้นทุนล็อตที่ขาย (FIFO)</span>
                    <span style={{color:"var(--mut)"}}>${basis.toFixed(4)}/หุ้น</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                    <span style={{color:"var(--faint)"}}>Gross P&L</span>
                    <span style={{color:"var(--mut)"}}>{grossGain>=0?"+":""}${grossGain.toFixed(2)}</span>
                  </div>
                  {fees.totalFees>0 && (
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                      <span style={{color:"var(--faint)"}}>ค่าธรรมเนียมทั้งหมด</span>
                      <span style={{color:"var(--loss)"}}>-${fees.totalFees.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4,paddingTop:6,borderTop:"1px solid var(--line)"}}>
                    <span style={{color:"var(--faint)"}}>ยอดขายรวม (Proceeds)</span>
                    <span style={{color:"var(--ink)"}}>${(qty*price).toFixed(2)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,marginTop:4}}>
                    <span style={{color:"var(--mut)"}}>Net P&L</span>
                    <span style={{color:netGain>=0?"var(--gain)":"var(--loss)"}}>{netGain>=0?"+":""}${netGain.toFixed(2)} ({netGainPct>=0?"+":""}{netGainPct.toFixed(2)}%)</span>
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmSell} disabled={!qty||!price||qty>h.shares} style={{...btn("var(--brass)","var(--on-brass)"),flex:1,padding:"10px",opacity:(!qty||!price||qty>h.shares)?0.5:1}}>✅ ยืนยันขาย</button>
                <button onClick={()=>setSellModalId(null)} style={{...btn("var(--line)","var(--mut)"),flex:1,padding:"10px"}}>ยกเลิก</button>
              </div>
        </>);
        })()}
      </Sheet>

      {/* SPLIT MODAL */}
      <Sheet open={splitModalId !== null} onClose={()=>setSplitModalId(null)} maxWidth={380}>
        {(() => {
        const h = effectiveHoldings.find((x:any)=>x.id===splitModalId);
        if (!h) return null;
        const newShares = parseFloat(splitRatio);
        const valid = newShares > 0 && newShares !== h.shares;
        return (<>
              <div style={{fontSize:16,fontWeight:700,color:"var(--brass)",marginBottom:4}}>🔀 แตกพาร์ {h.symbol}</div>
              <div style={{fontSize:12,color:"var(--faint)",marginBottom:16}}>ปัจจุบัน {h.shares.toFixed(7)} หุ้น</div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,color:"var(--mut)",marginBottom:6}}>จำนวนหุ้นหลังแตกพาร์</div>
                <input type="number" value={splitRatio} onChange={e=>setSplitRatio(e.target.value)} placeholder={`เช่น ${(h.shares*4).toFixed(7)}`} min="0" step="any" autoFocus
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"10px 12px",color:"var(--ink)",fontSize:14}}/>
              </div>

              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmSplit} disabled={!valid} style={{...btn("var(--card2)","var(--brass)"),flex:1,padding:"10px",opacity:valid?1:0.5}}>✅ ยืนยันแตกพาร์</button>
                <button onClick={()=>setSplitModalId(null)} style={{...btn("var(--line)","var(--mut)"),flex:1,padding:"10px"}}>ยกเลิก</button>
              </div>
        </>);
        })()}
      </Sheet>

      {/* DETAIL SHEET (mobile card tap) */}
      <DetailSheet
        holding={effectiveHoldings.find((x:any)=>x.id===detailId) || null}
        onClose={()=>{setDetailId(null);setEditId(null);}}
        tv={tv}
        pc={pc}
        editId={editId}
        onEditIdChange={setEditId}
        updateH={updateH}
        confirmEdit={confirmEdit}
        onBuy={(id)=>{setDetailId(null);openBuyModal(id);}}
        onSell={(id)=>{setDetailId(null);openSellModal(id);}}
        onSplit={(id)=>{setDetailId(null);openSplitModal(id);}}
        onHistory={(symbol)=>{setDetailId(null);setTab("transactions");setTxFilterSymbol(symbol);}}
        onRemove={(id)=>{setDetailId(null);removeH(id);}}
      />

      {/* ADD HOLDING SHEET */}
      <Sheet open={showAddSheet} onClose={()=>setShowAddSheet(false)} maxWidth={420}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:14,color:"var(--ink)"}}>เพิ่มหลักทรัพย์</div>
        {[{k:"symbol",l:"Symbol",p:"AAPL"},{k:"shares",l:"จำนวนหุ้น",p:"100",t:"number"},{k:"avgCost",l:"ต้นทุนเฉลี่ย ($)",p:"150.00",t:"number"},{k:"currentPrice",l:"ราคาปัจจุบัน",p:"0",t:"number"},{k:"targetPct",l:"สัดส่วนเป้าหมาย % (ไม่บังคับ)",p:"2.5",t:"number"},{k:"sector",l:"กลุ่มธุรกิจ (ไม่บังคับ)",p:"Tech"},{k:"note",l:"หมายเหตุ (ไม่บังคับ)",p:"Long term"}].map(f=>(
          <div key={f.k} style={{marginBottom:10}}>
            <div style={{fontSize:11,color:"var(--mut)",marginBottom:3}}>{f.l}</div>
            <input type={(f as any).t||"text"} value={(newStock as any)[f.k]||""} placeholder={f.p}
              onChange={e=>setNewStock({...newStock,[f.k]:f.k==="symbol"?e.target.value.toUpperCase():e.target.value})}
              style={{width:"100%",background:"var(--bg)",border:"1px solid var(--line)",borderRadius:6,padding:"9px 12px",color:"var(--ink)",fontSize:13,boxSizing:"border-box"}}/>
          </div>
        ))}
        <button onClick={()=>{if(!newStock.symbol){msg("ใส่ Symbol ก่อน");return;}addHolding();setShowAddSheet(false);}} style={{...btnPrimary(),width:"100%",padding:"11px",fontSize:14,marginTop:4}}>เพิ่มหลักทรัพย์</button>
      </Sheet>
    </div>
  );
}
