// Unit tests for the spot-gold price parsers (app/lib/goldprice.ts).
// The live endpoints can't be reached from CI/sandbox (egress-restricted), so
// these assert the parsing of each provider's known response shape + the symbol
// routing. Run: npm run test:gold

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = execSync("npx esbuild app/lib/goldprice.ts --format=esm", { cwd: ROOT }).toString();
const { parseGoldpriceOrg, parseGoldApiCom, isGoldSymbol, GOLD_ALIASES, gldOuncesPerShare, spotFromGld } =
  await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };

// ── symbol routing ──
t("XAUUSD is gold", isGoldSymbol("XAUUSD"));
t("XAU is gold", isGoldSymbol("XAU"));
t("lowercase xauusd is gold", isGoldSymbol("xauusd"));
t("AAPL is NOT gold", !isGoldSymbol("AAPL"));
t("GOLD (Barrick) is NOT routed to spot", !isGoldSymbol("GOLD"));

// ── goldprice.org shape ──
{
  const sample = { ts: 1784500000000, date: "Jul 20th 2026", items: [{ curr: "USD", xauPrice: 4001.23, xagPrice: 30.1, chgXau: -12.5, pcXau: -0.31, xauClose: 4013.7 }] };
  const q = parseGoldpriceOrg(sample, "XAUUSD");
  t("goldprice: price from xauPrice", q?.price === 4001.23, JSON.stringify(q));
  t("goldprice: changePct from pcXau (rounded 2dp)", q?.changePct === -0.31);
  t("goldprice: marketTime from ts", q?.marketTime === 1784500000000);
}
t("goldprice: empty items → null", parseGoldpriceOrg({ items: [] }, "XAU") === null);
t("goldprice: missing price → null", parseGoldpriceOrg({ items: [{ curr: "USD" }] }, "XAU") === null);
t("goldprice: zero price → null", parseGoldpriceOrg({ items: [{ xauPrice: 0 }] }, "XAU") === null);
{
  // pcXau absent → changePct null but price still valid
  const q = parseGoldpriceOrg({ ts: 1, items: [{ xauPrice: 4000 }] }, "XAU");
  t("goldprice: price valid even w/o pcXau", q?.price === 4000 && q?.changePct === null);
}

// ── gold-api.com shape ──
{
  const sample = { name: "Gold", price: 3998.7, symbol: "XAU", updatedAt: "2026-07-20T03:30:00Z", updatedAtReadable: "a minute ago" };
  const q = parseGoldApiCom(sample, "XAUUSD");
  t("gold-api: price", q?.price === 3998.7);
  t("gold-api: changePct null (not provided)", q?.changePct === null);
  t("gold-api: marketTime parsed from updatedAt", q?.marketTime === Date.parse("2026-07-20T03:30:00Z"));
  t("gold-api: keeps requested symbol", q?.symbol === "XAUUSD");
}
t("gold-api: no price → null", parseGoldApiCom({ name: "Gold" }, "XAU") === null);
{
  // bad updatedAt → marketTime still a number (falls back to now)
  const q = parseGoldApiCom({ price: 4000, updatedAt: "not-a-date" }, "XAU");
  t("gold-api: bad date → numeric marketTime", typeof q?.marketTime === "number" && q.marketTime > 0);
}

{
  // spot gold history derived from GLD closes (the only daily series Vercel can reach)
  const ok = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };
  ok("GLD: 0.1 oz per share at launch", Math.abs(gldOuncesPerShare("2004-11-18") - 0.1) < 1e-12);
  ok("GLD: ounces shrink 0.40% a year", Math.abs(gldOuncesPerShare("2005-11-18") / gldOuncesPerShare("2004-11-18") - 0.996) < 1e-4);
  // 2024-12-31: GLD closed $241.53, LBMA gold ~$2,624
  const s = spotFromGld({ "2024-12-31": 241.53, "2025-01-02": 0, "2026-10-26": 367.82 });
  ok("GLD → spot within 0.5% of the LBMA price", Math.abs(s["2024-12-31"] / 2624 - 1) < 0.005, String(s["2024-12-31"]));
  ok("GLD → spot: a zero close is dropped", !("2025-01-02" in s));
  ok("GLD → spot: recent close lands in today's range", s["2026-10-26"] > 3900 && s["2026-10-26"] < 4150, String(s["2026-10-26"]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
