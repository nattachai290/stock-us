// /api/history's shared cache in Supabase (app/lib/shardcache.ts + app/api/history/route.ts).
// A fake PostgREST stands in for Supabase; proves cached years skip the providers, misses
// are fetched once and upserted, and the route still works with no Supabase configured.
// Run: npm run test:shardcache

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = execSync("npx esbuild app/api/history/route.ts --format=esm --bundle --external:next/server", { cwd: ROOT }).toString();
const { GET } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };

const SB = "https://proj.supabase.co";
const cur = new Date().getUTCFullYear();
const today = new Date().toISOString().slice(0, 10);
let table, calls;
const reset = (rows = []) => { table = new Map(rows.map(r => [`${r.symbol}|${r.year}`, r])); calls = { sb: [], nasdaq: 0, writes: [] }; };

// Nasdaq history: one close per day for each Jan 2 from 2023 to this year, plus today
const nasdaqRows = () => {
  const rows = [];
  for (let y = 2023; y <= cur; y++) rows.push({ date: `01/02/${y}`, close: `$${100 + y - 2023}` });
  const [Y, M, D] = today.split("-");
  rows.push({ date: `${M}/${D}/${Y}`, close: "$150.00" });
  return rows;
};

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith(SB)) {
    calls.sb.push({ url, method: init.method || "GET", headers: init.headers });
    const u = new URL(url);
    if ((init.method || "GET") === "GET") {
      const sym = u.searchParams.get("symbol").replace(/^eq\./, "");
      const [lo, hi] = u.searchParams.getAll("year").map(v => +v.replace(/^(gte|lte)\./, ""));
      const rows = [...table.values()].filter(r => r.symbol === sym && r.year >= lo && r.year <= hi).map(r => ({ year: r.year, days: r.days }));
      return { ok: true, status: 200, json: async () => rows };
    }
    const rows = JSON.parse(init.body);
    calls.writes.push(...rows);
    for (const r of rows) table.set(`${r.symbol}|${r.year}`, r);
    return { ok: true, status: 201, json: async () => null };
  }
  if (url.includes("api.nasdaq.com")) {
    calls.nasdaq++;
    return { ok: true, status: 200, json: async () => ({ data: { tradesTable: { rows: nasdaqRows() } } }) };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
};
const call = async (q) => (await GET({ nextUrl: { searchParams: new URLSearchParams(q) } })).json();

process.env.SUPABASE_URL = SB;
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

{
  reset();
  const j = await call({ symbols: "SPY", from: "2024-01-01" });
  t("cold cache: closes come back", j.results.SPY?.["2024-01-02"] === 101 && j.cached === true, JSON.stringify(j));
  t("cold cache: providers asked once", calls.nasdaq === 1);
  const years = calls.writes.map(w => w.year).sort().join();
  t("cold cache: every year from the first missing one upserted in one request",
    years === Array.from({ length: cur - 2024 + 1 }, (_, i) => 2024 + i).join() && calls.sb.filter(c => c.method === "POST").length === 1, years);
  const post = calls.sb.find(c => c.method === "POST");
  t("upsert: merge-duplicates on (symbol, year)", post.url.includes("on_conflict=symbol,year") && post.headers.Prefer.includes("resolution=merge-duplicates"));
  t("secret key goes in apikey, not as a bearer token", post.headers.apikey === "sb_secret_test" && !post.headers.Authorization);
}
{
  // warm: past years from the table, current year fresh (has today) → no provider call
  const before = calls.nasdaq; calls.writes = [];
  const j = await call({ symbols: "SPY", from: "2024-01-01" });
  t("warm cache: served from Supabase, providers not asked", calls.nasdaq === before && j.results.SPY?.["2025-01-02"] === 102);
  t("warm cache: nothing written", calls.writes.length === 0);
}
{
  // stale current year (last close > 3 days ago) → refetched, past years left alone
  reset([
    { symbol: "SPY", year: cur - 1, days: { [`${cur - 1}-01-02`]: 1 } },
    { symbol: "SPY", year: cur, days: { [`${cur}-01-02`]: 2 } },
  ]);
  const j = await call({ symbols: "SPY", from: `${cur - 1}-01-01` });
  t("stale current year: providers asked", calls.nasdaq === 1);
  t("stale current year: only the current year rewritten", calls.writes.map(w => w.year).join() === String(cur), calls.writes.map(w => w.year).join());
  t("stale current year: past year still from the cache", j.results.SPY?.[`${cur - 1}-01-02`] === 1);
}
{
  // legacy service_role JWT is also sent as the bearer token
  reset();
  process.env.SUPABASE_SECRET_KEY = ""; process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOi.test";
  await call({ symbols: "QQQ", from: `${cur}-01-01` });
  const get = calls.sb.find(c => c.method === "GET");
  t("service_role JWT: apikey + Authorization", get?.headers.apikey === "eyJhbGciOi.test" && get?.headers.Authorization === "Bearer eyJhbGciOi.test");
}
{
  // no Supabase configured → straight to the providers, nothing cached
  reset();
  delete process.env.SUPABASE_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  const j = await call({ symbols: "SPY", from: `${cur}-01-01` });
  t("no cache configured: still answers", !!j.results.SPY && j.cached === false);
  t("no cache configured: Supabase never called", calls.sb.length === 0);
}

{
  // spot gold: no provider has XAUUSD history from Vercel, so it is derived from GLD
  reset();
  const asked = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes("api.nasdaq.com")) asked.push(String(url)); return prev(url, init); };
  const j = await call({ symbols: "XAUUSD", from: "2024-01-01" });
  globalThis.fetch = prev;
  t("gold: XAUUSD history comes back", j.results.XAUUSD && Object.keys(j.results.XAUUSD).length > 0, JSON.stringify(j));
  t("gold: built from GLD, never asks for XAUUSD itself", asked.length > 0 && asked.every(u => u.includes("/quote/GLD/")), asked.join(" "));
  t("gold: GLD $101 on 2024-01-02 → ~$1,096 an ounce", Math.abs(j.results.XAUUSD["2024-01-02"] - 101 / (0.1 * Math.pow(0.996, (Date.parse("2024-01-02") - Date.parse("2004-11-18")) / (365.25 * 86400000)))) < 0.01);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
