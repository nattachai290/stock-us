// Unit tests for the invested-capital time series (app/lib/invested.ts).
// Run: npm run test:invested

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = execSync("npx esbuild app/lib/invested.ts --format=esm", { cwd: ROOT }).toString();
const { investedSeries } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };

const B = (date, qty, price) => ({ date, qty, price });

{
  // buys accumulate in date order regardless of holding/entry order
  const pts = investedSeries([
    { buyHistory: [B("2026-03-01T10:00:00", 2, 50), B("2026-01-01T10:00:00", 1, 100)] },
    { buyHistory: [B("2026-02-01T10:00:00", 4, 25)] },
  ]);
  t("sorted by date", pts.map(p => p.v).join(",") === "100,200,300", JSON.stringify(pts));
  t("timestamps ascending", pts[0].t < pts[1].t && pts[1].t < pts[2].t);
}

{
  // sells never subtract (mirrors the ลงทุนสะสมทั้งหมด stat): realizedHistory is ignored
  const pts = investedSeries([{
    buyHistory: [B("2026-01-01", 10, 10)],
    realizedHistory: [{ date: "2026-02-01", qty: 10, price: 99 }],
  }]);
  t("sells ignored", pts.length === 1 && pts[0].v === 100, JSON.stringify(pts));
}

{
  // entries without buyHistory contribute shares×avgCost as a flat baseline
  const pts = investedSeries([
    { shares: 3, avgCost: 100 },
    { buyHistory: [B("2026-01-01", 1, 50)] },
  ]);
  t("baseline under the line", pts.length === 1 && pts[0].v === 350, JSON.stringify(pts));
}

{
  // a buy with an unparseable date folds into the baseline instead of being dropped
  const pts = investedSeries([{ buyHistory: [B("not-a-date", 1, 40), B("2026-01-01", 1, 60)] }]);
  t("bad date → baseline", pts.length === 1 && pts[0].v === 100, JSON.stringify(pts));
}

{
  t("empty portfolio → no points", investedSeries([]).length === 0);
  t("null holdings tolerated", investedSeries(null).length === 0);
  // zero/negative amounts don't create points
  t("zero-amount buys skipped", investedSeries([{ buyHistory: [B("2026-01-01", 0, 100)] }]).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
