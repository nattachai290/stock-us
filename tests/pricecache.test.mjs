// The /api/price quote cache (app/api/price/route.ts).
// Proves a repeated poll is served from memory instead of hitting the provider again,
// and that a failure is never cached. Run: npm run test:pricecache

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = execSync("npx esbuild app/api/price/route.ts --format=esm --bundle --external:next/server", { cwd: ROOT }).toString();

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };

// Count what the route asks the outside world for.
let upstream = [];
const quote = (price) => JSON.stringify({ data: { current_price: price, prev_day_close: price - 1, last_trade_time: "2026-08-20T15:00:00Z" } });
globalThis.fetch = async (url) => {
  upstream.push(String(url));
  return { ok: true, status: 200, json: async () => JSON.parse(quote(100)) };
};

const { GET } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const req = (symbols) => ({ nextUrl: { searchParams: new URLSearchParams({ symbols }) } });
const call = async (symbols) => (await GET(req(symbols))).json();

{
  upstream = [];
  const a = await call("AAA,BBB");
  t("first call fetches both symbols", upstream.length === 2, `fetched ${upstream.length}`);
  t("first call returns both quotes", a.results.length === 2 && a.results.every(r => r.price === 100));

  upstream = [];
  const b = await call("AAA,BBB");
  t("second call hits no provider at all", upstream.length === 0, `fetched ${upstream.length}`);
  t("second call still returns the quotes", b.results.length === 2 && b.results.every(r => r.price === 100));

  upstream = [];
  const c = await call("AAA,CCC");
  t("only the uncached symbol is fetched", upstream.length === 1 && upstream[0].includes("CCC"), upstream.join(","));
  t("order follows the request, not the cache", c.results.map(r => r.symbol).join(",") === "AAA,CCC",
    c.results.map(r => r.symbol).join(","));
}

{
  // A provider outage must not stick for the whole TTL.
  globalThis.fetch = async (url) => { upstream.push(String(url)); return { ok: false, status: 404, json: async () => ({}) }; };
  upstream = [];
  const a = await call("DDD");
  t("failure surfaces as an error", !!a.results[0].error, JSON.stringify(a.results[0]));

  upstream = [];
  await call("DDD");
  t("failure is retried, never cached", upstream.length > 0, "no retry — the error was cached");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
