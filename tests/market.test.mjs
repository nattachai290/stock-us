// Unit tests for US market hours (app/lib/market.ts).
// Run: npm run test:market

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = execSync("npx esbuild app/lib/market.ts --format=esm", { cwd: ROOT }).toString();
const { isMarketOpen, marketState, nyClock } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };
const at = (iso) => new Date(iso); // callers pass explicit Z instants

{
  // DST is the whole reason this file exists: the SAME UTC instant is inside the
  // session in summer and outside it in winter.
  t("13:35 UTC is open in July (09:35 EDT)", isMarketOpen(at("2026-07-08T13:35:00Z")));
  t("13:35 UTC is CLOSED in January (08:35 EST)", !isMarketOpen(at("2026-01-08T13:35:00Z")));
  t("14:35 UTC is open in January (09:35 EST)", isMarketOpen(at("2026-01-08T14:35:00Z")));
  t("20:55 UTC is open in January (15:55 EST)", isMarketOpen(at("2026-01-08T20:55:00Z")));
  t("20:55 UTC is CLOSED in July (16:55 EDT)", !isMarketOpen(at("2026-07-08T20:55:00Z")));
}

{
  // Session edges, in EDT (UTC-4)
  t("09:29 ET is closed", !isMarketOpen(at("2026-07-08T13:29:00Z")));
  t("09:30 ET is open (inclusive)", isMarketOpen(at("2026-07-08T13:30:00Z")));
  t("15:59 ET is open", isMarketOpen(at("2026-07-08T19:59:00Z")));
  t("16:00 ET is closed (exclusive)", !isMarketOpen(at("2026-07-08T20:00:00Z")));
  t("03:00 ET pre-market is closed", !isMarketOpen(at("2026-07-08T07:00:00Z")));
}

{
  t("Saturday midday is closed", !isMarketOpen(at("2026-07-11T15:00:00Z")));
  t("Sunday midday is closed", !isMarketOpen(at("2026-07-12T15:00:00Z")));
}

{
  // Every listed holiday must read closed at an hour that is otherwise open
  const holidays = ["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
    "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
    "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31",
    "2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"];
  const bad = holidays.filter(d => isMarketOpen(at(`${d}T16:00:00Z`))); // 11:00/12:00 ET
  t(`all ${holidays.length} holidays read closed`, bad.length === 0, `open on ${bad.join(", ")}`);

  // ...and the surrounding ordinary weekdays must still read open, so the holiday
  // list cannot be "passing" by accidentally closing the market permanently.
  t("ordinary Wednesday is open", isMarketOpen(at("2026-07-08T16:00:00Z")));
  t("day after Independence Day holiday is open", isMarketOpen(at("2026-07-06T16:00:00Z")));
}

{
  // Half days close at 13:00 ET, not 16:00
  t("day after Thanksgiving open at 12:30 ET", isMarketOpen(at("2026-11-27T17:30:00Z")));
  t("day after Thanksgiving CLOSED at 13:30 ET", !isMarketOpen(at("2026-11-27T18:30:00Z")));
  t("a normal day is still open at 13:30 ET", isMarketOpen(at("2026-11-25T18:30:00Z")));
  t("half day reports the early close time", marketState(at("2026-11-27T17:30:00Z")).closesAt === 13 * 60);
  t("normal day reports the regular close time", marketState(at("2026-11-25T17:30:00Z")).closesAt === 16 * 60);
}

{
  // nyClock converts the instant, it does not read the host timezone
  const c = nyClock(at("2026-07-08T13:35:00Z"));
  t("nyClock date", c.date === "2026-07-08", c.date);
  t("nyClock weekday", c.weekday === "Wed", c.weekday);
  t("nyClock minutes = 9*60+35", c.minutes === 9 * 60 + 35, String(c.minutes));
  // midnight must be 0 minutes, not 1440 (hourCycle h23 vs h24)
  t("midnight ET is 0 minutes", nyClock(at("2026-07-08T04:00:00Z")).minutes === 0,
    String(nyClock(at("2026-07-08T04:00:00Z")).minutes));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
