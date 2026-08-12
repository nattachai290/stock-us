// Unit tests for the target-weight suggestions (app/lib/portfolio.ts).
// Run: npm run test:portfolio

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = execSync("npx esbuild app/lib/portfolio.ts --format=esm", { cwd: ROOT }).toString();
const { addSuggestion, totalToTarget } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// A position holding `value` worth at $1/share, so shares double as dollars.
const H = (value, targetPct, avgCost = 1) => ({ shares: value, currentPrice: 1, avgCost, targetPct });

{
  // addSuggestion: buying alone lands exactly on target, since the buy grows the total too
  const tv = 1000;
  const h = H(50, 10);
  const { amount, shares } = addSuggestion(h, tv);
  t("addSuggestion solves for the position alone", near(amount, 50 / 0.9), `got ${amount}`);
  t("addSuggestion shares = amount / price", near(shares, amount));
  const w = (50 + amount) / (tv + amount) * 100;
  t("buying that amount alone hits the target exactly", near(w, 10), `landed at ${w}%`);
}

{
  // no target, at target, or over target → nothing to buy
  t("no target → 0", addSuggestion(H(50, 0), 1000).amount === 0);
  t("exactly at target → 0", addSuggestion(H(100, 10), 1000).amount === 0);
  t("over target → 0", addSuggestion(H(200, 10), 1000).amount === 0);
  t("100% target → 0 (no finite solve)", addSuggestion(H(50, 100), 1000).amount === 0);
  t("zero price → 0", addSuggestion({ shares: 10, currentPrice: 0, avgCost: 5, targetPct: 10 }, 1000).amount === 0);
}

{
  // belowCostPct is reported even when there is nothing to buy
  t("below cost flagged", near(addSuggestion(H(200, 10, 2), 1000).belowCostPct, -50));
  t("above cost → 0", addSuggestion(H(50, 10, 0.5), 1000).belowCostPct === 0);
}

{
  // totalToTarget: the joint solve, NOT the sum of the rows
  const tv = 1000;
  const hs = [H(50, 10), H(100, 20), H(400, 20)]; // third is over target, excluded
  const total = totalToTarget(hs, tv);
  t("joint total matches the closed form", near(total, (0.30 * 1000 - 150) / 0.70), `got ${total}`);

  const rowSum = hs.reduce((s, h) => s + addSuggestion(h, tv).amount, 0);
  t("joint total exceeds the sum of the rows", total > rowSum, `${total} vs ${rowSum}`);

  // spending it lands every under-target position on its target simultaneously
  const tv2 = tv + total;
  const w0 = (50 + (0.10 * tv2 - 50)) / tv2 * 100;
  const w1 = (100 + (0.20 * tv2 - 100)) / tv2 * 100;
  t("A lands on 10% after the joint buy", near(w0, 10), `got ${w0}`);
  t("B lands on 20% after the joint buy", near(w1, 20), `got ${w1}`);
  const spent = (0.10 * tv2 - 50) + (0.20 * tv2 - 100);
  t("per-position buys add up to the joint total", near(spent, total), `${spent} vs ${total}`);
}

{
  // the sum of the rows would have left both short — the bug this replaced
  const tv = 1000;
  const hs = [H(50, 10), H(100, 20)];
  const rowSum = hs.reduce((s, h) => s + addSuggestion(h, tv).amount, 0);
  const under = (50 + 50 / 0.9) / (tv + rowSum) * 100;
  t("summing the rows undershoots the target", under < 10, `would land at ${under}%`);
}

{
  t("nothing under target → 0", totalToTarget([H(200, 10)], 1000) === 0);
  t("empty portfolio → 0", totalToTarget([], 1000) === 0);
  t("null holdings → 0", totalToTarget(null, 1000) === 0);
}

{
  // targets summing past 100% have no finite joint solve → fall back to the per-row sum
  const tv = 1000;
  const hs = [H(50, 60), H(100, 70)];
  const total = totalToTarget(hs, tv);
  const rowSum = hs.reduce((s, h) => s + addSuggestion(h, tv).amount, 0);
  t("T ≥ 100% falls back to the row sum", near(total, rowSum) && total > 0, `got ${total}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
