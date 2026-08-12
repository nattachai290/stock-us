// Turns `npm audit --json` into the Markdown the audit workflow posts (.ci/audit.md).
// Pure formatting — reads .ci/audit-all.json and .ci/audit-prod.json, writes the report
// and a few GITHUB_OUTPUT flags the workflow branches on.
//
// Production vs dev matters more than raw counts here: a DoS in a build-time tool is
// noise, the same bug in a shipped dependency is not. The prod set is simply whatever
// `npm audit --omit=dev` still reports, so the two runs classify every finding.
import fs from "fs";

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const all = read(".ci/audit-all.json");
const prod = read(".ci/audit-prod.json");

// A failed audit run (registry down, malformed lockfile) must not read as "no vulnerabilities".
if (!all || !all.vulnerabilities) {
  const body = ["<!-- npm-audit-comment -->", "### ⚠️ npm audit รันไม่สำเร็จ", "",
    "`npm audit --json` ไม่คืน JSON ที่อ่านได้ — ดู log ของ job", ""].join("\n");
  fs.mkdirSync(".ci", { recursive: true });
  fs.writeFileSync(".ci/audit.md", body);
  fs.appendFileSync(process.env.GITHUB_OUTPUT || "/dev/null", "status=error\ntotal=0\ncritical_prod=0\n");
  console.log(body);
  process.exit(0);
}

const RANK = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
const ICON = { critical: "🟣", high: "🔴", moderate: "🟠", low: "🟡", info: "⚪" };
const prodNames = new Set(Object.keys(prod?.vulnerabilities || {}));

// `via` holds advisory objects for direct findings and plain package names for the
// transitive ones — split them so a row can say either what the bug is or where it came from.
const advisoriesOf = (v) => (v.via || []).filter((x) => typeof x === "object");
const throughOf = (v) => (v.via || []).filter((x) => typeof x === "string");

const fixOf = (v) => {
  const f = v.fixAvailable;
  if (f === true) return "`npm audit fix`";
  if (f && typeof f === "object") return `\`${f.name}@${f.version}\`${f.isSemVerMajor ? " ⚠️ major" : ""}`;
  return "_ยังไม่มี fix_";
};

const rows = Object.values(all.vulnerabilities)
  .sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || a.name.localeCompare(b.name));

const table = (list) => {
  if (!list.length) return ["_ไม่มี_", ""];
  const out = ["| Package | Severity | แก้ด้วย | เรื่อง |", "| --- | --- | --- | --- |"];
  for (const v of list) {
    const adv = advisoriesOf(v);
    const through = throughOf(v);
    // Several advisories on one package collapse to the first title + a count, so the
    // table stays readable; the full list is a click away on the advisory link.
    const what = adv.length
      ? `[${adv[0].title.replace(/\|/g, "\\|").slice(0, 110)}](${adv[0].url})${adv.length > 1 ? ` _(+${adv.length - 1})_` : ""}`
      : through.length ? `_ผ่าน ${through.join(", ")}_` : "_ไม่ระบุ_";
    out.push(`| \`${v.name}\` | ${ICON[v.severity] || ""} ${v.severity} | ${fixOf(v)} | ${what} |`);
  }
  return [...out, ""];
};

const m = all.metadata?.vulnerabilities || {};
const mp = prod?.metadata?.vulnerabilities || {};
const total = m.total || 0;
const prodRows = rows.filter((v) => prodNames.has(v.name));
const devRows = rows.filter((v) => !prodNames.has(v.name));
const criticalProd = mp.critical || 0;

const header = total === 0
  ? "### ✅ npm audit: ไม่พบช่องโหว่"
  : `### ⚠️ npm audit: พบ ${total} รายการ (prod ${mp.total || 0})`;

const counts = ["| Severity | ทั้งหมด | เฉพาะ prod |", "| --- | --- | --- |",
  ...["critical", "high", "moderate", "low"]
    .filter((s) => (m[s] || 0) > 0 || (mp[s] || 0) > 0)
    .map((s) => `| ${ICON[s]} ${s} | ${m[s] || 0} | ${mp[s] || 0} |`)];

const body = [
  "<!-- npm-audit-comment -->",
  header,
  "",
  ...(total ? [...counts, ""] : []),
  ...(prodRows.length ? ["#### 🚨 Production dependencies", "", "ตัวที่ติดไปกับแอปที่ deploy จริง — ควรแก้ก่อน", "", ...table(prodRows)] : []),
  ...(devRows.length ? [`<details><summary>🔧 Dev dependencies (${devRows.length}) — กระทบแค่ตอน build/test</summary>`, "", ...table(devRows), "</details>", ""] : []),
  ...(total ? ["```bash", "npm audit fix          # แก้เท่าที่ไม่ breaking", "npm audit --omit=dev   # ดูเฉพาะ prod", "```", ""] : []),
  `> _อัพเดทอัตโนมัติจาก \`.github/workflows/audit.yml\` — deps ทั้งหมด ${all.metadata?.dependencies?.total ?? "?"} ตัว_`,
].join("\n");

fs.mkdirSync(".ci", { recursive: true });
fs.writeFileSync(".ci/audit.md", body);
fs.appendFileSync(process.env.GITHUB_OUTPUT || "/dev/null",
  `status=${total === 0 ? "clean" : "found"}\ntotal=${total}\ncritical_prod=${criticalProd}\n`);
console.log(body);
