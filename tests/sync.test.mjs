// Unit tests for device ↔ Drive reconciliation (app/lib/syncstate.ts).
// Run: npm run test:sync
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = execSync("npx esbuild app/lib/syncstate.ts --format=esm", { cwd: ROOT }).toString();
const { decide, contentKey, summarize } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => { cond ? pass++ : fail++; console.log((cond ? "✓ " : "✗ FAIL ") + name + (cond ? "" : "  — " + detail)); };

const buy = (date, qty, price) => ({ date, qty, price, type: "import" });
const pos = (symbol, buys = [], extra = {}) => ({ id: symbol, symbol, shares: 0, avgCost: 0, currentPrice: 100, changePct: 1, targetPct: 2, note: "", sector: "", buyHistory: buys, realizedHistory: [], splitHistory: [], ...extra });
const B1 = buy("2026-10-01T10:00:00", 1, 10), B2 = buy("2026-10-06T13:07:00", 2, 20);
const old = [pos("NVDA", [B1])];
const newer = [pos("NVDA", [B1, B2])];

{
  t("identical → same", decide(old, structuredClone(old), null) === "same");
  t("prices alone never count as a change",
    decide([pos("NVDA", [B1], { currentPrice: 999, changePct: -5, priceTime: 123 })], old, null) === "same");
  t("key order does not matter", contentKey([{ a: 1, b: 2, symbol: "X" }]) === contentKey([{ symbol: "X", b: 2, a: 1 }]));
  t("no local copy → pull", decide(null, newer, null) === "pull");
}

{
  // with a stamp (the normal case once a device has synced with this version)
  t("stamp = local → Drive is newer → pull", decide(old, newer, contentKey(old)) === "pull");
  t("stamp = Drive → device has unsaved work → push", decide(newer, old, contentKey(old)) === "push");
  t("stamp matches neither → both changed → conflict",
    decide([pos("NVDA", [B1, buy("2026-10-07T09:00:00", 3, 30)])], newer, contentKey(old)) === "conflict");
}

{
  // no stamp (a device last synced before stamps existed) — the user's computer case
  t("legacy: old device copy, Drive ahead → pull (the computer that showed stale data)", decide(old, newer, null) === "pull");
  t("legacy: device ahead, Drive old → push (a phone whose save failed)", decide(newer, old, null) === "push");
  t("legacy: each side has a transaction the other lacks → conflict",
    decide([pos("NVDA", [B1, buy("2026-10-07T09:00:00", 3, 30)])], newer, null) === "conflict");
  t("legacy: Drive has more history but the device changed a target → conflict, never silently lose the edit",
    decide([pos("NVDA", [B1], { targetPct: 5 })], newer, null) === "conflict");
  // Known limit, legacy only: without a stamp, a device that DELETED a transaction is
  // indistinguishable from one that is merely behind, so it pulls and the row comes back.
  // Once the device has synced with this version it carries a stamp and this is exact:
  t("legacy limit: a local deletion looks like staleness and pulls", decide([pos("NVDA", [B2])], newer, null) === "pull");
  t("...with a stamp the same deletion is pushed", decide([pos("NVDA", [B2])], newer, contentKey(newer)) === "push");
  t("legacy: a new position on Drive only → pull", decide(old, [...newer, pos("AAPL", [B1])], null) === "pull");
}

{
  const s = summarize([pos("NVDA", [B1, B2]), pos("OLD", [B1], { hidden: true })]);
  t("summary counts transactions", s.transactions === 3, JSON.stringify(s));
  t("summary latest date", s.latest === "2026-10-06T13:07:00", s.latest);
  t("summary positions exclude hidden", s.positions === 1, String(s.positions));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
