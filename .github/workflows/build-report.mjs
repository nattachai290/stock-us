// Turns the per-check logs written by the "Run all checks" step into a single
// Markdown comment (.ci/report.md). Pure formatting — reads .ci/<key>.log and
// .ci/<key>.code for each check and emits a status table + collapsible logs.
import fs from "fs";

const CHECKS = [
  { key: "tsc", label: "Type-check", cmd: "npx tsc --noEmit" },
  { key: "build", label: "Build", cmd: "next build" },
  { key: "gold", label: "Gold-price tests", cmd: "npm run test:gold" },
  { key: "invest", label: "Invested-series tests", cmd: "npm run test:invested" },
  { key: "ocr", label: "OCR pipeline tests", cmd: "npm run test:ocr" },
];

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const codeOf = (key) => { const c = read(`.ci/${key}.code`).trim(); return c === "" ? null : Number(c); };

// Pull the "N passed, M failed" line and any recall line out of a test log.
const summarize = (log) => {
  const lines = log.split("\n").map(l => l.trim()).filter(Boolean);
  const passed = [...log.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
  const recall = lines.find(l => l.startsWith("OCR exact recall overall:"));
  const bits = [];
  if (passed) bits.push(`${passed[1]} passed, ${passed[2]} failed`);
  if (recall) bits.push(recall.replace("OCR exact recall overall:", "recall").split(".")[0]);
  return bits.join(" · ");
};

const tail = (log, n = 60) => {
  const lines = log.replace(/\n+$/, "").split("\n");
  return (lines.length > n ? lines.slice(-n) : lines).join("\n");
};

// Pull the per-row detail lines out of the OCR log and sort them into the categories a
// reviewer scans by — flagged (value-correct vs value-off), missing, unread — so they
// can be shown OUTSIDE the collapsed log block. Empty categories are dropped entirely.
const ocrReview = (log) => {
  const L = log.split("\n").map(l => l.trim());
  const flagOk = L.filter(l => l.startsWith("⚠ [") && l.includes("(ตรง expect)"));
  const flagBad = L.filter(l => l.startsWith("⚠ [") && l.includes("(ไม่ตรง"));
  const missing = L.filter(l => l.startsWith("✗ ["));
  const incomplete = L.filter(l => l.startsWith("⊘ ["));
  const total = flagOk.length + flagBad.length + missing.length + incomplete.length;
  return { flagOk, flagBad, missing, incomplete, total };
};
const codeBlock = (lines) => ["```", ...lines, "```"];

let anyFail = false, anyMissing = false;
const rows = [];
const details = [];
let review = [];

for (const c of CHECKS) {
  const code = codeOf(c.key);
  const log = read(`.ci/${c.key}.log`);
  let icon, status;
  if (code === null) { icon = "⚪"; status = "did not run"; anyMissing = true; }
  else if (code === 0) { icon = "✅"; status = "passed"; }
  else { icon = "❌"; status = `failed (exit ${code})`; anyFail = true; }
  const extra = summarize(log);
  rows.push(`| ${icon} ${c.label} | \`${c.cmd}\` | ${status}${extra ? ` — ${extra}` : ""} |`);
  if (c.key === "ocr") review = ocrReview(log);
  if (log.trim()) {
    // The OCR log is long (unit tests + per-fixture detail); keep more of its tail so
    // the per-row lines aren't cut off.
    details.push(`<details><summary>${icon} ${c.label} — output</summary>\n\n\`\`\`\n${tail(log, c.key === "ocr" ? 200 : 60)}\n\`\`\`\n\n</details>`);
  }
}

// Always-visible "rows to review" section, grouped by category. Each header (and the
// flagged sub-headers) appears ONLY when it has rows; a fully clean run shows one note.
const reviewBlock = [];
if (!review || review.total === 0) {
  reviewBlock.push("_🔍 OCR: ทุกแถวผ่านสะอาด — ไม่มีแถวต้องตรวจ_");
} else {
  reviewBlock.push(`#### 🔍 OCR — รายการที่ต้องดู (${review.total})`, "");
  const flagged = review.flagOk.length + review.flagBad.length;
  if (flagged) {
    reviewBlock.push(`**⚠ ติดธง (${flagged})**`, "");
    if (review.flagOk.length) reviewBlock.push(`ค่าถูก (${review.flagOk.length})`, ...codeBlock(review.flagOk));
    if (review.flagBad.length) reviewBlock.push(`ค่าคลาดเคลื่อน (${review.flagBad.length})`, ...codeBlock(review.flagBad));
  }
  if (review.missing.length) reviewBlock.push(`**✗ หายไป (${review.missing.length})**`, ...codeBlock(review.missing));
  if (review.incomplete.length) reviewBlock.push(`**⊘ อ่านไม่ครบ (${review.incomplete.length})**`, ...codeBlock(review.incomplete));
}

const header = anyFail ? "### ❌ Tests: some checks failed"
  : anyMissing ? "### ⚠️ Tests: incomplete run"
  : "### ✅ Tests: all checks passed";

const body = [
  "<!-- test-results-comment -->",
  header,
  "",
  "| Check | Command | Result |",
  "| --- | --- | --- |",
  ...rows,
  "",
  ...reviewBlock,
  "",
  ...details,
  "",
  "> _OCR tests judge safety (nothing silently wrong), and report exact-match recall as a number — OCR never hits 100%; use English screenshots for best accuracy. Auto-updated on every push to this PR._",
].join("\n");

fs.mkdirSync(".ci", { recursive: true });
fs.writeFileSync(".ci/report.md", body);
console.log(body);
