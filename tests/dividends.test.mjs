// Automatic dividends: provider parsing (app/lib/dividends.ts), what the portfolio earned
// from its own transactions, and the /api/dividends fallback order. Run: npm run test:dividends
process.env.TZ = "Asia/Bangkok"; // transaction dates are local Thai times, as in the browser

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = async (file, extra = "") => {
  const src = execSync(`npx esbuild ${file} --format=esm --bundle ${extra}`, { cwd: ROOT }).toString();
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
};
const { parseNasdaqDividends, parseYahooDividends, dividendRows, dividendSummary, exCutoff, WITHHOLDING } = await load("app/lib/dividends.ts");

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const sec = (iso) => Date.parse(iso) / 1000;

// ── provider parsing (payload shapes as returned live on 2026-10-14) ──────────────────
{
  const nas = { data: { dividends: { rows: [
    { exOrEffDate: "11/19/2026", type: "Cash", amount: "$0.98", paymentDate: "12/10/2026" },
    { exOrEffDate: "03/05/2024", type: "Cash", amount: "$0.04", paymentDate: "03/27/2024" },
    { exOrEffDate: "01/02/2020", type: "Stock", amount: "$0.10", paymentDate: "N/A" },
    { exOrEffDate: "N/A", type: "Cash", amount: "$0.50", paymentDate: "N/A" },
  ] } } };
  const e = parseNasdaqDividends(nas);
  t("nasdaq: cash rows only, oldest first", e.length === 2 && e[0].ex === "2024-03-05" && e[1].ex === "2026-11-19", JSON.stringify(e));
  t("nasdaq: amount and payment date parsed", e[1].amount === 0.98 && e[1].pay === "2026-12-10" && e[0].pay === "2024-03-27");
  t("nasdaq: no table (non-Nasdaq listing) → null", parseNasdaqDividends({ data: { dividends: { rows: null } }, message: "Dividend History for Non-Nasdaq symbols is not available" }) === null);
}
{
  // NVDA through the 10:1 split of 2024-06-10: Yahoo reports March's $0.04 as $0.004
  const y = { chart: { result: [{ events: {
    dividends: { a: { amount: 0.004, date: sec("2024-03-05T14:30:00Z") }, b: { amount: 0.01, date: sec("2024-06-11T13:30:00Z") } },
    splits: { s: { date: sec("2024-06-10T13:30:00Z"), numerator: 10, denominator: 1, splitRatio: "10:1" } },
  } }] } };
  const e = parseYahooDividends(y);
  t("yahoo: dividend before a split is converted back to the amount paid", near(e[0].amount, 0.04), JSON.stringify(e));
  t("yahoo: dividend after the split is untouched", near(e[1].amount, 0.01));
  t("yahoo: ex-date from the event timestamp, no payment date", e[0].ex === "2024-03-05" && e[0].pay === null);
  t("yahoo: chart with no dividends → []", JSON.stringify(parseYahooDividends({ chart: { result: [{}] } })) === "[]");
  t("yahoo: no chart → null", parseYahooDividends({ chart: { result: null } }) === null);
}

// ── what the portfolio earned ─────────────────────────────────────────────────────────
const NOW = Date.parse("2026-10-14T05:00:00Z");
{
  const h = { symbol: "MSFT",
    buyHistory: [
      { date: "2026-01-10T21:40:00", qty: 10, price: 400 },
      { date: "2026-05-20T22:00:00", qty: 5, price: 420 },   // Thai 22:00 on the ex-date = US session of the ex-date → too late
    ],
    realizedHistory: [{ date: "2026-08-21T01:30:00", qty: 15, sellPrice: 500 }], // sold everything
    splitHistory: [] };
  const divs = { MSFT: [
    { ex: "2026-02-19", pay: "2026-03-12", amount: 0.91 },
    { ex: "2026-05-20", pay: "2026-06-11", amount: 0.91 },
    { ex: "2026-08-20", pay: "2026-09-10", amount: 0.91 },
    { ex: "2026-11-19", pay: "2026-12-10", amount: 0.98 },
  ] };
  const rows = dividendRows([h], divs, NOW);
  const by = Object.fromEntries(rows.map(r => [r.ex, r]));
  t("buy before the ex-date earns the dividend", by["2026-02-19"]?.shares === 10);
  t("buy on the ex-date (Thai evening = that US session) does not", by["2026-05-20"]?.shares === 10, JSON.stringify(by["2026-05-20"]));
  // 2026-08-21 01:30 Thai = 2026-08-20 14:30 New York, during the ex-date session
  t("selling on the ex-date still collects it", by["2026-08-20"]?.shares === 15, JSON.stringify(by["2026-08-20"]));
  t("announced dividend after selling everything → nothing to collect", !by["2026-11-19"]);
  t("net = gross less withholding", near(by["2026-02-19"].net, 10 * 0.91 * (1 - WITHHOLDING)) && WITHHOLDING === 0.15);
  t("newest first", rows[0].ex === "2026-08-20");
  t("all past payments are paid", rows.every(r => r.status === "paid"));
}
{
  // ex-date cut-off in absolute terms: 08:00 UTC = 15:00 Thai on the ex-date
  t("cut-off is before any trade of the ex-date session", exCutoff("2026-08-20") === Date.parse("2026-08-20T08:00:00Z"));
}
{
  // split: shares counted in as-of-the-date terms, matched with the as-paid amount
  const h = { symbol: "NVDA",
    buyHistory: [{ date: "2024-01-05T22:00:00", qty: 2, price: 500 }],
    realizedHistory: [], splitHistory: [{ date: "2024-06-10T20:00:00", ratio: "20" }] };
  const divs = { NVDA: [{ ex: "2024-03-05", pay: "2024-03-27", amount: 0.04 }, { ex: "2024-06-11", pay: "2024-06-28", amount: 0.01 }] };
  const rows = dividendRows([h], divs, NOW);
  t("pre-split dividend on pre-split shares", rows.find(r => r.ex === "2024-03-05")?.gross === 2 * 0.04);
  t("post-split dividend on post-split shares", near(rows.find(r => r.ex === "2024-06-11")?.gross, 20 * 0.01));
}
{
  // statuses and the summary
  const h = { symbol: "KO", buyHistory: [{ date: "2025-01-02T22:00:00", qty: 100, price: 60 }], realizedHistory: [], splitHistory: [] };
  const divs = { KO: [
    { ex: "2025-03-14", pay: "2025-04-01", amount: 0.51 },
    { ex: "2025-11-28", pay: "2025-12-15", amount: 0.51 },
    { ex: "2026-06-13", pay: "2026-07-01", amount: 0.53 },
    { ex: "2026-09-30", pay: "2026-10-20", amount: 0.53 },   // ex passed, money not in yet
    { ex: "2026-11-27", pay: "2026-12-15", amount: 0.53 },   // announced
    { ex: "2026-08-01", pay: null, amount: 0.10 },            // Yahoo-only row: no payment date
  ] };
  const rows = dividendRows([h], divs, NOW);
  const st = Object.fromEntries(rows.map(r => [r.ex, r.status]));
  t("status: paid / pending / upcoming", st["2026-06-13"] === "paid" && st["2026-09-30"] === "pending" && st["2026-11-27"] === "upcoming", JSON.stringify(st));
  t("status: unknown payment date counts as paid once ex has passed", st["2026-08-01"] === "paid");
  const s = dividendSummary(rows, [h], divs, NOW);
  const n = (x) => 100 * x * 0.85;
  t("received = every paid row", near(s.received, n(0.51) + n(0.51) + n(0.53) + n(0.10)), String(s.received));
  t("this year by payment date", near(s.thisYear, n(0.53) + n(0.10)), String(s.thisYear));
  t("last 12 months", near(s.last12m, n(0.51) + n(0.53) + n(0.10)), String(s.last12m));
  t("coming = pending + upcoming", near(s.coming, n(0.53) * 2));
  // trailing 12 months by ex-date: 2025-11-28, 2026-06-13, 2026-08-01, 2026-09-30
  t("forward = trailing-12-month payout per share × shares now", near(s.forward, 100 * (0.51 + 0.53 + 0.10 + 0.53) * 0.85), String(s.forward));
  t("by year, newest first", s.byYear.map(y => y.year).join() === "2026,2025");
}
{
  t("no dividend data → no rows", dividendRows([{ symbol: "CRWD", buyHistory: [{ date: "2026-01-01T22:00:00", qty: 1, price: 1 }] }], {}, NOW).length === 0);
  t("hidden (deleted) positions still count", dividendRows([{ symbol: "KO", hidden: true,
    buyHistory: [{ date: "2025-01-02T22:00:00", qty: 1, price: 60 }], realizedHistory: [{ date: "2025-06-01T22:00:00", qty: 1, sellPrice: 70 }] }],
    { KO: [{ ex: "2025-03-14", pay: "2025-04-01", amount: 0.51 }] }, NOW).length === 1);
}

// ── /api/dividends: Nasdaq first, Yahoo for everything Nasdaq doesn't list ─────────────
{
  const calls = [];
  globalThis.fetch = async (url) => {
    url = String(url); calls.push(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "crumb1", headers: { get: () => "A=1; path=/" } });
    if (url.startsWith("https://finance.yahoo.com/")) return json({});
    if (url.includes("getcrumb")) return json({});
    if (url.includes("api.nasdaq.com/api/quote/MSFT/")) return json({ data: { dividends: { rows: [{ exOrEffDate: "08/20/2026", type: "Cash", amount: "$0.91", paymentDate: "09/10/2026" }] } } });
    if (url.includes("api.nasdaq.com")) return json({ data: { dividends: { rows: null } } });
    if (url.includes("/chart/SCHD")) return json({ chart: { result: [{ events: { dividends: { a: { amount: 0.278, date: sec("2025-12-10T14:30:00Z") } } } }] } });
    if (url.includes("/chart/CRWD")) return json({ chart: { result: [{}] } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { GET } = await load("app/api/dividends/route.ts", "--external:next/server");
  const res = await GET({ nextUrl: { searchParams: new URLSearchParams({ symbols: "MSFT,SCHD,CRWD,ZZZZ" }) } });
  const j = await res.json();
  t("route: Nasdaq listing answered by Nasdaq, with payment date", j.results.MSFT?.[0]?.pay === "2026-09-10", JSON.stringify(j.results.MSFT));
  t("route: Nasdaq has no table → Yahoo", near(j.results.SCHD?.[0]?.amount, 0.278) && calls.some(u => u.includes("/chart/SCHD")));
  t("route: pays no dividends → empty list, not an error", Array.isArray(j.results.CRWD) && j.results.CRWD.length === 0 && !j.errors.CRWD);
  t("route: nobody answers → error", !!j.errors.ZZZZ && !j.results.ZZZZ, JSON.stringify(j.errors));
  t("route: a failure isn't cached at the CDN", res.headers.get("Cache-Control") === "no-store");
  t("route: Yahoo carries the crumb", calls.some(u => u.includes("/chart/SCHD") && u.includes("crumb=crumb1")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
