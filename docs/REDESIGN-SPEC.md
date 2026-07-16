# SASOM — UI/UX Redesign Spec (v1.1)

> สเปคฉบับเต็มสำหรับ implement รีดีไซน์แอปพอร์ต "PORT AI" → **SASOM (สะสม)**
> **Mockup อ้างอิง (อนุมัติแล้ว): เปิดไฟล์ `docs/redesign-mockup.html` ในเบราว์เซอร์** — มีทั้ง 5 จอมือถือ + จอ PC พร้อม SVG path ของไอคอนทุกตัวและสไตล์จริงที่ก๊อปได้ตรงๆ (สำเนาออนไลน์: https://claude.ai/code/artifact/6804c843-cf56-41c2-93e9-39c684442bc1)
> เจ้าของอนุมัติ: ชื่อ SASOM + โทนสี brass ตาม mockup · ทำทีละเฟส (มี 4 เฟส) · **แต่ละเฟสต้อง build ผ่านและ commit แยก**

## Quick start สำหรับ dev
1. อ่าน §0 (กติกาเหล็ก) ให้จบก่อน
2. เปิด `docs/redesign-mockup.html` ในเบราว์เซอร์คู่กันไว้ตลอด — นี่คือ visual source of truth
3. ทำตามเฟสใน §7 ทีละเฟส · จบเฟสรัน checklist §8 · commit + PR แยกเฟส
4. ติดคำถามเรื่อง behavior เดิม: ดูโค้ดปัจจุบันเป็นคำตอบ — redesign นี้เปลี่ยนแค่หน้าตา

---

## 0. กติกาเหล็ก (อ่านก่อนเขียนโค้ดทุกครั้ง)

นี่คือ **UI-only refactor** — ห้ามเปลี่ยน business logic, data model, หรือ persistence ใดๆ ทั้งสิ้น

**ห้ามแก้พฤติกรรมของฟังก์ชันเหล่านี้** (เรียกใช้ได้ ย้ายที่ render ได้ แต่ logic ภายใน+ผลลัพธ์ต้องเท่าเดิม):
- `computeFromHistory`, `replayLots`, `fifoBasisForSale` (app/lib/portfolio.ts) — คณิต FIFO ตรงกับโบรกเกอร์แล้ว ห้ามแตะ
- `refreshPrices` (batch 20, timeout 30s/batch, progress msg, ทยอย setHoldings ต่อ batch, ข้าม hidden)
- `importTxCSV` (dedupe, จำนวนไม่พอขาย, FIFO basis, split +/-, backup ก่อน apply)
- `importCSV`, `exportCSV`, `recalcRealizedFIFO`, `makeBackup`/`restoreBackup`
- `parseAndApplyAllocation` (normalize รวมเป็น 100%)
- `confirmBuy`/`confirmSell`/`confirmSplit`/`saveEditTx`/`deleteTx`/`removeH` (รวม guard ขายเกิน + archive hidden)
- Google auth ทั้งชุด: `ensureTokenClient`, `trySilentRefresh`, `handleAuthExpired`, `handleGoogleLogin`, `handleLogout`
- Drive: `listPortfolios`/`loadPortfolio`/`savePortfolio`/`deletePortfolio` (app/lib/drive.ts)
- API `/api/price` (app/api/price/route.ts) — **ห้ามแตะทั้งไฟล์**
- **เนื้อความ prompt ทั้ง 4 ตัว** (`copyForAnalysis`, `copyMoversAnalysis`, `copyAllocationAnalysis`, `copyNewIdeas`) — ข้อความ prompt ห้ามเปลี่ยนแม้แต่ตัวอักษรเดียว เปลี่ยนได้แค่ปุ่ม/ที่วาง UI

**ห้ามเปลี่ยน:**
- localStorage keys: `gtoken`, `gemail`, `currentPortId`, `currentPortName`, `holdings-{id}`, `backup-{id}`
- โครงสร้าง JSON holdings ที่ save ลง Drive (ทุก field เดิม: id, symbol, shares, avgCost, currentPrice, sector, note, changePct, priceTime, targetPct, hidden, buyHistory, realizedHistory, splitHistory)
- `GOOGLE_CLIENT_ID`, `SCOPES`, `PROXY_URL`
- ความหมาย `effectiveHoldings` (กรอง hidden แล้วคำนวณจาก history) และ `activeHoldings` (shares > 0.000001)

**ทุกเฟสก่อน commit:** `npx tsc --noEmit` และ `npm run build` ต้องผ่าน

---

## 1. แบรนด์

| รายการ | ค่า |
|---|---|
| ชื่อแอป | **SASOM** (คำไทย "สะสม") |
| Wordmark | ตัวพิมพ์ใหญ่ `SASOM` — 2 ตัวแรก `SA` สี brass, `SOM` สี ink · font-weight 800 · letter-spacing 0.14em · font-family `"Avenir Next", Futura, "Segoe UI", system-ui, sans-serif` |
| Tagline (ใช้ใน meta description) | "สะสม — DCA portfolio tracker" |
| `layout.tsx` metadata | `title: 'SASOM — สะสม'`, `description: 'DCA portfolio tracker'` |
| Loading screen | พื้น `--bg`, wordmark SASOM กลางจอ + ข้อความ "กำลังโหลด…" สี `--mut` |
| ธีม | **Dark เท่านั้น** (จงใจ — ผู้ใช้ใช้กลางคืนบนมือถือ) ไม่ทำ light theme ในสโคปนี้ |
| อีโมจิ | **ห้ามมีอีโมจิใน UI chrome ทั้งหมด** (ปุ่ม แท็บ หัวข้อ ป้าย) — แทนด้วยไอคอน SVG ชุดเดียว (ดู §4) · อีโมจิในเนื้อ prompt AI คงไว้ (ห้ามแก้ prompt) |

---

## 2. Design Tokens

สร้างเป็น CSS custom properties ใน `app/globals.css` ที่ `:root` — **ทุก component ใหม่ต้องอ้าง token เท่านั้น ห้าม hardcode hex เพิ่ม**

```css
:root{
  /* surfaces */
  --bg:#0C1014;        /* พื้นหลังแอป */
  --card:#151C23;      /* การ์ด/แผง */
  --card2:#1C252E;     /* การ์ดซ้อน/ปุ่มรอง/hover */
  --line:#242F39;      /* เส้นขอบ hairline */
  /* ink */
  --ink:#EAEFF4;       /* ตัวหนังสือหลัก */
  --mut:#90A2B0;       /* รอง */
  --faint:#5F6E7A;     /* จาง/label */
  /* brand */
  --brass:#D2AE6C;     /* สีแบรนด์เดียว: โลโก้ ปุ่มหลัก แท็บ active โฟกัส แถบเป้า */
  --on-brass:#161006;  /* ตัวหนังสือบนพื้น brass */
  /* semantic — ใช้กับตัวเลขเงิน/สถานะเท่านั้น ห้ามใช้ตกแต่ง */
  --gain:#4CC38A;
  --loss:#E5655E;
  --warn:#E2A33C;      /* ราคาเก่า >24h, ตัวผิดปกติ ±3% */
  /* charts (categorical, ลำดับตายตัว, จงใจไม่มีเขียว) */
  --c1:#3987e5; --c2:#c98500; --c3:#d55181;
  --c4:#9085e9; --c5:#199e70; --c6:#5F6E7A; /* c6 = "อื่นๆ" */
  /* geometry */
  --r-sm:10px; --r-md:13px; --r-lg:16px;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 32px rgba(0,0,0,.35);
}
body{
  background:var(--bg); color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI","Noto Sans Thai",sans-serif;
  font-variant-numeric:tabular-nums;   /* ตัวเลขเรียงหลักตรงกันทั้งแอป */
}
```

### 2.1 ตาราง map สีเก่า → ใหม่ (สำหรับกวาดแทน inline styles เดิมทั้งไฟล์)

ใช้ replace ตรงตัว (case-insensitive) ใน `app/page.tsx`, `app/globals.css`, `app/components/DateTimePicker24h.tsx`, `app/lib/ui.ts`:

| เดิม | ใหม่ | หมายเหตุ |
|---|---|---|
| `#0f1117` | `var(--bg)` | พื้น/ช่องกรอก |
| `#1a1d2e` | `var(--card)` | การ์ด |
| `#141720` | `var(--card)` | sidebar เดิม |
| `#1e2433` | `var(--card2)` | ปุ่มรอง/เส้นแถว |
| `#2d3748` | `var(--line)` | เส้น/ปุ่มเทา |
| `#4a5568` | `var(--faint)` (เมื่อเป็นสีตัวอักษร) / `var(--line)` (เมื่อเป็น border) | ดู context |
| `#e2e8f0` | `var(--ink)` |
| `#cbd5e0` | `var(--ink)` |
| `#a0aec0` | `var(--mut)` |
| `#718096` | `var(--faint)` |
| `#7ee8a2` | **แยกตาม context**: ถ้าเป็นสีกำไร/ตัวเลขเงิน → `var(--gain)` · ถ้าเป็นแบรนด์/ปุ่ม/แท็บ/โลโก้ → `var(--brass)` |
| `#86efac`, `#6ee7b7` | `var(--gain)` |
| `#ff6b6b`, `#fc8181` | `var(--loss)` |
| `#f6c90e`, `#fbbf24` | `var(--warn)` |
| `#67e8f9`, `#63b3ed`, `#93c5fd` | `var(--brass)` (ลิงก์/ปุ่มaction เดิมที่เป็นฟ้า) |
| `#c084fc`, `#fb923c` | `var(--mut)` หรือตัดทิ้ง (สีปุ่ม AI เดิม — UI ใหม่ใช้การ์ดโทนเดียว) |
| `#2f6b4f` | ปุ่มยืนยันเงิน: ใช้ `--brass` เป็นปุ่มหลักแทน (ดู §4 ปุ่ม) |
| `pc()` helper | คงไว้ แต่คืน `var(--gain)`/`var(--loss)` |

### 2.2 กติกาการใช้สี (บังคับ)

1. **brass** = แบรนด์+การกระทำหลักเท่านั้น: wordmark, ปุ่ม primary, แท็บ/nav ที่ active, focus ring, แถบความคืบหน้าเป้า, ลิงก์
2. **gain/loss** = ตัวเลขกำไรขาดทุน, ชิป %, ลูกศรทิศทาง เท่านั้น — ห้ามใช้เป็นสีปุ่ม/กรอบ/แบรนด์
3. **warn** = ราคาเก่า >24h (⚠ timestamp), แถบ mover ±3%, ข้อความเตือน
4. **กราฟหมวดหมู่** ใช้ `--c1..--c6` ตามลำดับตายตัว (มูลค่ามาก→น้อย, เกิน 5 กลุ่มยุบเป็น "อื่นๆ" = `--c6`) — ชุดนี้ผ่านตรวจตาบอดสีแล้ว และจงใจไม่มีเขียวกันสับสนกับ "กำไร"

### 2.3 ตัวเลข

- แสดงผล: ราคา/มูลค่า 2 ตำแหน่ง (`toLocaleString("en",{min/maxFractionDigits:2})`), จำนวนหุ้น 4 ตำแหน่ง, % 2 ตำแหน่ง
- ค่าเต็ม (7 ตำแหน่ง) แสดงเฉพาะใน Detail Sheet วงเล็บต่อท้าย เช่น `0.5311 (0.5311213)`
- **ข้อมูลใน state/storage ห้ามปัด** — ปัดตอน render เท่านั้น
- ทุกคอลัมน์ตัวเลขชิดขวา

---

## 3. Navigation & Layout (breakpoint เดียว: **900px**)

### 3.1 มือถือ (<900px)
- **App bar บน** (สูง ~52px): wordmark SASOM ซ้าย · ชิป port ("● portfolio ▾" — จุดเขียว=sync แล้ว, เหลือง=กำลัง save, คลิกเปิด dropdown สลับ/สร้าง/ลบ port + ปุ่มรีเฟรชรายการ port) · avatar ขวาสุด (ตัวอักษรแรกของอีเมล, คลิกเปิดเมนู: อีเมล, Sync → Drive, ออกจากระบบ / หรือปุ่ม Login ถ้ายังไม่ล็อกอิน)
- **Bottom tab bar** (fixed ล่าง, `padding-bottom:env(safe-area-inset-bottom)`): 4 แท็บ — พอร์ต · กราฟ · ประวัติ · AI — ไอคอน 15px + ป้าย 9.5px, active = `--brass`
- Sidebar ขวา (hamburger) เดิม: **ลบทิ้ง** — ทุกปุ่มย้ายที่ตาม §3.3
- แท็บ "เพิ่ม" เดิม: ย้ายเป็นปุ่ม `+ เพิ่มหลักทรัพย์` ท้าย list ในแท็บพอร์ต (เปิด sheet ฟอร์มเดิม)

### 3.2 จอกว้าง (≥900px)
- **Sidebar ซ้าย** กว้าง 184px, sticky: wordmark บนสุด → nav 4 รายการ (ไอคอน+ป้าย, active พื้น `--card2` ตัว `--brass`) → spacer → ชิป port → อีเมล+avatar
- **Topbar ใน content**: ช่องค้นหา (โฟกัสด้วยปุ่ม `/`) · ปุ่มอัพเดทราคา · ขวาสุด "ราคาเมื่อ {เวลา} · Cboe + CNBC"
- Content กว้างสุด 1,020px กึ่งกลาง
- ห้ามมี horizontal scroll ที่ body — ตารางกว้าง scroll ในกล่องตัวเอง

### 3.3 ตาราง map ปุ่มเดิม → ที่ใหม่ (ห้ามมี feature หาย)

| ปุ่มเดิม (sidebar/แท็บ) | ที่ใหม่ |
|---|---|
| 🔄 อัพเดทราคา | ปุ่ม primary ใน Hero card (มือถือ) / topbar (PC) |
| ☁️ Sync → Drive | เมนู avatar |
| 📥 Import CSV (holdings) | เมนูเครื่องมือ ⋯ ในแท็บพอร์ต |
| 📤 Export CSV | เมนูเครื่องมือ ⋯ ในแท็บพอร์ต |
| 🗑️ เคลียข้อมูลทั้งหมด | เมนูเครื่องมือ ⋯ ในแท็บพอร์ต (สี `--loss`, confirm เดิม) |
| 📋 วิเคราะห์ Port | การ์ดในแท็บ AI |
| ⚡ ตัวผิดปกติ (n) | การ์ดในแท็บ AI (badge จำนวน) |
| 🎯 จัดทัพ Port | การ์ดในแท็บ AI (เด่นสุด กรอบ brass) |
| 📥 Paste Target % | การ์ดในแท็บ AI (เปิดแผง textarea เดิม) |
| 💡 แนะนำหุ้นใหม่ | การ์ดในแท็บ AI |
| ➕ เพิ่ม (แท็บ) | ปุ่ม + ในแท็บพอร์ต → sheet |
| Import ประวัติ / Recalc FIFO / กู้คืน backup / Clear ประวัติ | เมนู ⋯ มุมขวาบนแท็บประวัติ |
| Login Google | เมนู avatar / ถ้ายังไม่ login แสดงแบนเนอร์เดิมในแท็บพอร์ต |

---

## 4. Component พื้นฐาน

### 4.1 ไอคอน (inline SVG, stroke=currentColor, stroke-width 2.2, fill none, viewBox 0 0 24 24)
สร้าง `app/components/icons.tsx` — ชุดนี้เท่านั้น:
`grid` (พอร์ต), `bars` (กราฟ), `clock` (ประวัติ), `spark` (AI), `search`, `refresh`, `arrow-down` (ซื้อ), `arrow-up` (ขาย), `split`, `dots` (⋯), `check`, `alert`, `x`, `plus`, `chev-right`, `edit`, `trash`

**SVG path พร้อมใช้** (จาก mockup — ตัวที่เหลือดูใน `docs/redesign-mockup.html` หรือวาดสไตล์เดียวกัน):
```
grid:    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
bars:    <path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>
clock:   <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
spark:   <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>
search:  <circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>
refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>
arrow-down: <path d="M12 5v14m0 0-5-5m5 5 5-5"/>
arrow-up:   <path d="M12 19V5m0 0-5 5m5-5 5 5"/>
split:   <path d="M8 3H5v18h3M16 3h3v18h-3"/>
check:   <path d="M4 12l5 5L20 7"/>
zap(ตัวผิดปกติ): <path d="M13 2 4 14h6l-1 8 9-12h-6z"/>
paste:   <path d="M12 16V4m0 12-4-4m4 4 4-4"/><path d="M4 20h16"/>
pencil(จัดทัพ): <path d="M3 21v-4l14-14 4 4L7 21H3z"/>
```

### 4.2 ปุ่ม (แก้ `app/lib/ui.ts`)
- `btnPrimary` — พื้น `--brass` ตัว `--on-brass` weight 800 radius `--r-sm`
- `btnGhost` — พื้น `--card2` ขอบ `--line` ตัว `--ink`
- `btnDanger` — พื้นโปร่ง ขอบ/ตัว `--loss`
- ปุ่มเดิมที่เรียก `btn(bg,color)` ทั่วไฟล์: เฟสแรกให้คงฟังก์ชัน `btn()` ไว้เพื่อ backward-compat แล้วทยอยเปลี่ยน call site เป็น 3 ตัวบนตามเฟส
- disabled = opacity .5 + cursor default · focus-visible = outline 2px `--brass`

### 4.3 Snackbar (ใหม่ — แทนข้อความจิ๋วบน header)
- `app/components/Snackbar.tsx`: fixed ล่าง (มือถือ: เหนือ tab bar ~70px; PC: ล่างขวา), พื้น `#212B35` ขอบ `--line` radius `--r-sm` shadow, ไอคอน check(gain)/alert(warn) + ข้อความ + ปุ่ม "ปิด"
- ต่อกับ state `status` เดิม: `msg()` คงพฤติกรรม (setStatus + auto-clear ตาม ms) — Snackbar render เมื่อ `status !== ""`
- `aria-live="polite"`
- ลบบรรทัด status เดิมใน header ทิ้ง (คงจำนวน "N ถืออยู่ · ขายหมด M" ไว้ใน Hero)

### 4.4 Sheet / Modal
- มือถือ: bottom sheet — เต็มความกว้าง ติดล่าง `border-radius: 18px 18px 0 0` + grab handle 36×4px, scrim `rgba(4,7,10,.55)` คลิกปิด
- PC: modal กลางจอเดิม (กว้าง ≤420px) หรือ side panel ขวา 380px สำหรับ Detail
- Modal เดิมทั้งหมด (ซื้อ/ขาย/แตกพาร์/แก้ tx/action menu) restyle เป็นระบบนี้ **logic เดิมทุกบรรทัด** (รวม preview FIFO ของ modal ขาย)

---

## 5. หน้าจอ (ตาม mockup — จอที่อ้างถึงคือ frame ใน artifact)

### 5.1 Hero summary card (แท็บพอร์ต บนสุด — frame 1)
- label "มูลค่าพอร์ต" (10.5px, `--faint`, uppercase, letter-spacing .14em)
- มูลค่า `tv` ตัวใหญ่ 27px weight 800
- ชิป 2 ตัว: `▲ วันนี้ +X.XX%` และ `รวม +XX.X%` (สีตามเครื่องหมาย)
  - **วันนี้ % ของทั้งพอร์ต** (ใหม่ — คำนวณจากข้อมูลที่มีอยู่):
    ```
    ต่อหุ้น: prev = currentPrice / (1 + changePct/100)   (ถ้า changePct == null → prev = currentPrice)
    todayChange$ = Σ shares×(currentPrice − prev)   บน activeHoldings
    todayPct = todayChange$ / Σ shares×prev × 100
    ```
- แถวสถิติ 3 ช่อง (คั่นเส้นบน): Unrealized `pnl` (สี gain/loss) · Realized `totalRealizedAll` · ถืออยู่ `activeHoldings.length` ตัว (+ "ขายหมด M" ถ้ามี)
- ปุ่ม **อัพเดทราคา** (btnPrimary เต็มกว้าง): ระหว่างโหลดแสดง `กำลังดึงราคา… (n/total)` + disabled (ใช้ state `refreshing` + progress จาก msg เดิม — ให้ refreshPrices เซ็ต state progress เพิ่มได้ แต่ห้ามแก้ logic ดึง)
- บรรทัดล่าง: `ราคาเมื่อ {dd/MM HH:mm} · Cboe + CNBC` จาก max(priceTime) หรือ lastUpdated
- แบนเนอร์ priceErrors เดิม: คงไว้ใต้ Hero (restyle เป็น token)

### 5.2 ค้นหา + เรียง (frame 1)
- state ใหม่: `query:string`, `sortBy:"value"|"pl"|"today"|"az"|"under"`, `sortDesc:boolean`
- ช่องค้นหา: filter `symbol.includes(q.toUpperCase()) || sector.toLowerCase().includes(q)`
- ชิปเรียง (แตะซ้ำสลับ ↓↑): มูลค่า (default ↓) · P&L % · วันนี้ (changePct, null ท้ายสุด) · A–Z · **ยังไม่ถึงเป้า** (ชิปนี้เป็น filter: `targetPct>0 && weight<targetPct` เรียงตาม gap มาก→น้อย)
- ใช้กับทั้ง card list (มือถือ) และตาราง (PC) — ตารางเพิ่มคลิกหัวคอลัมน์เรียงได้ด้วย

### 5.3 รายการหุ้น — มือถือ: Card (frame 1)
โครงต่อการ์ด (จาก `activeHoldings` ที่ผ่าน filter/sort):
- แถว 1: `SYMBOL` (13.5px, 800) · ป้าย sector เล็ก (ถ้ามี) · ขวา: ราคา `$X.XX` (700)
- แถว 2: `$มูลค่า · น้ำหนัก%` (`--mut`) · แถบเป้า 52×3.5px (fill `--brass` = min(weight/target,1); ไม่ตั้งเป้า → ไม่แสดงแถบ) · ขวา: `วันนี้ ±X.X% · P&L ±X.X%` (สี gain/loss; วันนี้แสดงเฉพาะเมื่อ |chg|≥3 เพื่อไม่รก — ไม่งั้นแสดงแค่ P&L)
- ตัวผิดปกติ (|changePct|≥3): แถบซ้าย 3px `--warn`
- ราคาเก่า (>24h จาก priceTime): บรรทัดจิ๋ว `⚠ ราคาเมื่อ dd/MM — เก่ากว่า 24 ชม.` สี `--warn`
- แตะการ์ด → Detail Sheet (5.4)

### 5.4 Detail Sheet (frame 2)
หัว: SYMBOL + sector + ราคา + ชิปวันนี้% · รายการ key-value (เส้นประคั่น):
`จำนวนหุ้น` (4dp + เต็มในวงเล็บ) · `ต้นทุน/หุ้น` + หมายเหตุจิ๋ว "FIFO ตรงโบรก" · `มูลค่า` · `Unrealized` (สี) · `Realized สะสม` (สี)
- ส่วนเป้า: `น้ำหนัก X% / เป้า Y%` + แถบ + ถ้าต่ำกว่าเป้า: `ซื้อเพิ่ม ~$Z ถึงเป้า` สี gain — สูตรเดิม `z=(t/100×tv−val)/(1−t/100)` · ถ้าเกินเป้า: `เกิน +$Z` สี loss · แก้เป้าได้ตรงนี้ (input % เล็ก)
- ปุ่ม 4: **ซื้อ** (primary) · ขาย · แตกพาร์ · ประวัติ (เปิด modal เดิม / ประวัติ = ไปแท็บประวัติ + filter symbol นั้น)
- เมนู ⋯ ใน sheet: แก้ไข (sector/note/ราคา manual — ฟิลด์ editId เดิม), ลบออกจาก Port (removeH เดิม)
- PC: เปิดเป็น side panel ขวาแทน bottom sheet

### 5.5 รายการหุ้น — PC: ตาราง (section 4 ของ mockup)
คอลัมน์ 9: หลักทรัพย์(+sector บรรทัดล่าง) | จำนวน | ต้นทุน | ราคา(+⚠เวลา ถ้าเก่า) | วันนี้ | P&L % | มูลค่า | น้ำหนัก/เป้า (ตัวเลข+แถบ) | ⋯
- หัวตาราง sticky + คอลัมน์แรก sticky (พฤติกรรมเดิมที่มีอยู่แล้ว — คงไว้)
- แถว hover พื้น `--card2` · คลิกแถว = เปิด Detail panel · ⋯ = action menu เดิม
- ตัวเลขชิดขวา tabular ทุกคอลัมน์ · แถวตัวผิดปกติ: แถบซ้าย `--warn` (แทน isAlert bg เดิม)

### 5.6 แท็บกราฟ (frame 3) — เขียนใหม่ทั้งแท็บ
แทน pie 2 วง (recharts) ด้วย 3 การ์ด (ลบ dependency recharts ได้ถ้าไม่เหลือที่ใช้):
1. **สัดส่วนตาม Sector** — แท่ง stacked แนวนอน สูง 14px radius 5px ช่องว่างระหว่าง segment 2px, สี `--c1..--c5` เรียงตามมูลค่ามาก→น้อย + "อื่นๆ" `--c6` · ใต้แท่ง: ตาราง legend แถวละ [สี่เหลี่ยม 9px | ชื่อ sector | $มูลค่า | %] · แตะแถว = ไป filter แท็บพอร์ตตาม sector นั้น (set query)
2. **Top 10 น้ำหนักพอร์ต** — แถวละ [SYMBOL 44px | แถงแนวนอน `--brass` เทียบตัวมากสุด | %] · แตะ = เปิด Detail
3. **กำไร/ขาดทุนสูงสุด (P&L %)** — 3 ตัวบวกสุด (แถบ `--gain`) แล้ว 3 ตัวลบสุด (แถบ `--loss`), ความยาวเทียบ |max|
- ท้ายแท็บ: หมายเหตุ `--faint`: "เฟสถัดไป: กราฟมูลค่าพอร์ตย้อนหลัง (ต้องเริ่มเก็บ snapshot รายวัน)"
- ข้อมูลจาก `activeHoldings` เท่านั้น

### 5.7 แท็บประวัติ (frame 4) — restyle + จัดกลุ่ม
- บนสุด: หัว "ประวัติ" + ปุ่ม **เครื่องมือ ⋯** (dropdown: Import ประวัติ CSV, Recalc FIFO, กู้คืน backup, Clear ประวัติ — เรียก handler เดิม, confirm เดิม)
- การ์ดสรุป 3 ช่อง: Realized รวม (สี) · Win rate % (nW/nL) · ธุรกรรม (จำนวน) — ค่าจาก logic เดิม (totalRealized, winRate, buyCount+sellTx+splitCount)
- ค้นหา symbol (แทน dropdown เดิม — filter `txFilterSymbol` logic เดิม) + ชิป filter ชนิด: ทั้งหมด/ซื้อ/ขาย/แตกพาร์ (state ใหม่ `txKindFilter`)
- **Timeline จัดกลุ่มตามเดือน**: หัวเดือนไทย เช่น "กรกฎาคม 2026" (`toLocaleDateString("th-TH",{month:"long",year:"numeric"})`)
- แถว transaction: ไอคอนกล่อง 26px — ซื้อ=arrow-down สี gain, ขาย=arrow-up สี loss, แตกพาร์=split สี `--c4`
  - ซื้อ: `ซื้อ SYMBOL` / `0.0416 หุ้น @ $71.95` / ขวา: `ทุนเฉลี่ย $65.83` (จาก avgCostAtBuy map เดิม) + วันเวลา
  - ขาย: `ขาย SYMBOL` / จำนวน @ ราคา / ขวา: `+$4.06 (+25.6%)` สีตามเครื่องหมาย + `fee −$x` ถ้ามี + วันเวลา
  - แตกพาร์: `แตกพาร์ SYMBOL` + ป้าย `1 : N` (N = ratio/sharesBefore ปัดสวย) / `ก่อน → หลัง หุ้น`
  - ขวาสุดทุกแถว: ⋯ → แก้ไข/ลบ (openEditTx/deleteTx เดิม)
- แผง Import TX เดิม: เปิดจากเมนูเครื่องมือ (textarea+ปุ่มเดิม restyle)

### 5.8 แท็บ AI (frame 5)
- หัว "ผู้ช่วยวิเคราะห์" + คำอธิบาย: "สร้างพรอมป์จากข้อมูลพอร์ตจริง → วางใน Claude แล้วนำผลกลับมาวาง"
- การ์ด 5 ใบ [ไอคอนกล่อง | ชื่อ+คำอธิบาย | ›]:
  1. วิเคราะห์พอร์ต — "ภาพรวม + หาตัวที่ควรขายจริงๆ ตามพื้นฐาน" → `copyForAnalysis()`
  2. ตัวผิดปกติวันนี้ + badge จำนวน (moversCount, ถ้า 0 → disabled) — "หุ้นขยับ ±3% — ค้นข่าวแล้ววิเคราะห์ว่าพื้นฐานเปลี่ยนไหม" → `copyMoversAnalysis()`
  3. **จัดทัพพอร์ต** (กรอบ `--brass`) — "แม่ทัพ / รองแม่ทัพ / ทหารเสริม → ได้ตาราง % พร้อมวางกลับ" → `copyAllocationAnalysis()`
  4. แนะนำหุ้นใหม่ — "หาหุ้นพื้นฐานดีที่ยังไม่มีในพอร์ต 3–5 ตัว" → `copyNewIdeas()`
  5. วางผลจัดทัพ (Target %) — "แปะตารางจาก Claude — ระบบตรวจรวม 100% ให้อัตโนมัติ" → เปิดแผง textarea + `parseAndApplyAllocation()`
- กดการ์ด copy แล้ว: snackbar "คัดลอกพรอมป์แล้ว — เปิด Claude แล้ววาง ✓"
- ท้าย: หมายเหตุ `--faint` "ทุกพรอมป์นับเฉพาะหุ้นที่ถืออยู่จริง ไม่รวมตัวที่ขายหมด/ลบแล้ว"

### 5.9 Empty states & micro-states (ทุกอันพื้นโปร่ง ไอคอน `--faint` 28px + ข้อความ `--mut` + ปุ่มถ้าระบุ)

| ที่ | เงื่อนไข | แสดง |
|---|---|---|
| แท็บพอร์ต | `holdings.length===0` | ไอคอน grid · "ยังไม่มีหลักทรัพย์" · ปุ่ม primary "+ เพิ่มหลักทรัพย์" + ปุ่ม ghost "Import CSV" |
| แท็บพอร์ต | ค้นหา/กรองแล้วว่าง | "ไม่พบ \"{query}\"" · ปุ่ม ghost "ล้างการค้นหา" |
| แท็บพอร์ต | ชิป "ยังไม่ถึงเป้า" แล้วว่าง | "ทุกตัวถึงเป้าแล้ว 🎉" (ข้อความเฉยๆ ไม่มีปุ่ม — อีโมจิใน copy ได้ ไม่ใช่ chrome) |
| แท็บกราฟ | `activeHoldings.length===0` | "ยังไม่มีข้อมูลให้แสดง — เพิ่มหุ้นก่อน" |
| แท็บประวัติ | ไม่มีธุรกรรม | ไอคอน clock · "ยังไม่มีประวัติ" · ปุ่ม ghost "Import ประวัติ CSV" |
| แท็บประวัติ | กรองแล้วว่าง | "ไม่พบธุรกรรมตามเงื่อนไข" · ปุ่ม ghost "ล้างตัวกรอง" |
| แท็บ AI | `holdings.length===0` | การ์ดทั้งหมด disabled + ข้อความ "เพิ่มหุ้นก่อนถึงจะวิเคราะห์ได้" |
| ราคายังไม่เคยดึง | `priceTime` ไม่มีทั้งพอร์ต | Hero บรรทัดล่างแสดง "ยังไม่เคยอัพเดทราคา — กดปุ่มด้านบน" |
| Sector ไม่ระบุ | holding ไม่มี sector | จัดกลุ่ม "ไม่ระบุ" ในกราฟ (ตาม `sectorData` เดิม) และไม่แสดงป้าย sector บนการ์ด |
| กำลังโหลดแอป | `!loaded` | จอ loading §1 |

**Dropdown/เมนูทุกตัว** (port chip, avatar, เครื่องมือ ⋯, action ⋯): ปิดเมื่อคลิกนอก/กด Esc · รายการสูง ≥40px · รายการอันตราย (ลบ/เคลียร์) สี `--loss` แยกโซนล่างด้วยเส้น `--line`

---

## 6. โครงไฟล์เป้าหมาย

```
app/
  globals.css            ← tokens + layout classes (แทน sidebar เดิม)
  layout.tsx             ← metadata SASOM
  page.tsx               ← state + handlers เดิมทั้งหมด, ประกอบ component (ผอมลงมาก)
  lib/ (portfolio.ts, drive.ts — ห้ามแตะ · ui.ts — ปุ่มใหม่)
  components/
    icons.tsx            ← ไอคอน SVG ชุดเดียว
    Snackbar.tsx
    AppShell.tsx         ← app bar + bottom tabs (มือถือ) / sidebar (PC) + สลับ 900px
    Hero.tsx             ← การ์ดสรุป + ปุ่มอัพเดท
    HoldingsList.tsx     ← search/sort chips + cards (มือถือ)
    HoldingsTable.tsx    ← ตาราง PC (ยก JSX ตารางเดิมมา restyle)
    DetailSheet.tsx
    Sheet.tsx            ← primitive bottom-sheet/modal ใช้ร่วม
    ChartsTab.tsx
    HistoryTab.tsx
    AiTab.tsx
    DateTimePicker24h.tsx (เดิม — เปลี่ยนสีเป็น token)
```
- ย้าย JSX จาก page.tsx ไป component โดย **ส่ง props เป็น handler เดิม** — อย่า duplicate logic
- อนุญาตให้คง state ทั้งหมดใน page.tsx (ไม่ต้องทำ context/store ใหม่)

---

## 7. เฟสการทำงาน (commit แยกเฟส · เฟสละ 1 PR)

### เฟส 1 — Tokens + แบรนด์ + Hero + Snackbar
1. เพิ่ม tokens ใน globals.css · เปลี่ยน body font/tabular-nums
2. กวาด map สีเก่า→ใหม่ทั้ง codebase (§2.1) — ระวัง `#7ee8a2` ต้องแยก context
3. layout.tsx → SASOM · loading screen ใหม่
4. Header เดิม → App bar ใหม่ (logo+port chip+avatar menu) + **Hero card** (§5.1 รวมสูตรวันนี้%)
5. Snackbar แทน status จิ๋ว
6. ปุ่ม primary (อัพเดทราคา) ย้ายมา Hero — sidebar เดิมยังอยู่ชั่วคราว (ตัดปุ่มอัพเดทออกจาก sidebar กันซ้ำ)
- ✅ เกณฑ์ผ่าน: build ผ่าน · ทุก feature กดได้ครบเดิม · ไม่มี hex เก่าเหลือใน header/hero ใหม่

### เฟส 2 — รายการหุ้น (การ์ด/ตาราง) + ค้นหา/เรียง + Detail Sheet
1. Sheet primitive + DetailSheet
2. HoldingsList (มือถือ) + HoldingsTable (PC ยกของเดิม restyle) สลับที่ 900px
3. search/sort state + ชิป (§5.2) ใช้ร่วมสองโหมด
4. modal ซื้อ/ขาย/แตกพาร์/action menu restyle เป็น Sheet (logic เดิม)
5. ปุ่ม + เพิ่มหลักทรัพย์ (ฟอร์มแท็บ add เดิม → sheet) และลบแท็บ add
- ✅ เกณฑ์: ซื้อ/ขาย/แตกพาร์/แก้ไข/ลบ ทำครบจากทั้งการ์ดและตาราง · ตัวเลขตรงกับก่อนแก้ทุกช่อง

### เฟส 3 — Navigation ใหม่ + แท็บ AI
1. AppShell: bottom tabs (มือถือ) / sidebar ซ้าย (PC)
2. AiTab การ์ด 5 ใบ (§5.8)
3. เมนูเครื่องมือ ⋯ แท็บพอร์ต (Import/Export/เคลียร์) + เมนู avatar (Sync/ออก)
4. **ลบ hamburger sidebar เดิม + CSS ของมัน** — เช็คทุกปุ่มมีที่อยู่ใหม่ตามตาราง §3.3
- ✅ เกณฑ์: ไม่มี feature ใดหาย (ไล่เช็คตาราง §3.3 ทีละแถว)

### เฟส 4 — กราฟ + ประวัติ
1. ChartsTab (§5.6) — ลบ recharts ออกจาก package.json ถ้าไม่เหลือผู้ใช้
2. HistoryTab (§5.7): เดือน/ไอคอน/ชิปกรอง/เครื่องมือ ⋯
- ✅ เกณฑ์: ยอด Realized/Win rate/นับธุรกรรม ตรงกับก่อนแก้ · Recalc/กู้คืน/Import ยังทำงาน

---

## 8. Regression checklist (ทดสอบท้ายทุกเฟส)

- [ ] `npx tsc --noEmit` + `npm run build` ผ่าน
- [ ] อัพเดทราคา: progress (n/total) แสดง, ผิดพลาดโชว์รายตัว, ราคา+เวลาเข้าตาราง/การ์ด
- [ ] Login Google / silent renew / ออกจากระบบ / สลับ-สร้าง-ลบ port / Sync Drive
- [ ] Import ประวัติ CSV: ซ้ำ→ข้าม, จำนวนไม่พอขาย→ข้าม+แจ้ง, split +/− ทำงาน
- [ ] ซื้อ/ขาย (preview = ค่าที่บันทึกจริง แบบ FIFO)/แตกพาร์/แก้ tx/ลบ tx
- [ ] ขายเกินจำนวน → alert "จำนวนไม่พอขาย"
- [ ] ลบหุ้นที่มีประวัติขาย → หายจากพอร์ตแต่ Realized ยังอยู่ในประวัติ
- [ ] Recalc FIFO / กู้คืน backup / Clear ประวัติ (มี backup ก่อนเสมอ)
- [ ] Paste Target % → normalize 100% + "ตัดออก"=0%
- [ ] Copy prompt ทั้ง 4 — **diff ข้อความ prompt กับของเดิมต้องว่างเปล่า**
- [ ] ตัวเลขหัว (มูลค่า/Unrealized/Realized/ถืออยู่·ขายหมด) = ผลรวมตาราง
- [ ] มือถือ 360px: ไม่มี horizontal scroll ของ body, tab bar ไม่ทับเนื้อหา
- [ ] PC 1280px: sidebar+ตาราง, sticky header/คอลัมน์แรกทำงาน

## 9. นอกสโคป (อย่าทำ)
- Light theme · PWA/manifest · กราฟมูลค่าย้อนหลัง (ต้องมี snapshot ก่อน) · เปลี่ยน API ราคา · unit tests (แยกงานต่างหาก) · i18n
