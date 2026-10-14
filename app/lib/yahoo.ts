// Server-side only (API routes): Yahoo's v8 chart API wants a session cookie + "crumb"
// from datacenter IPs. Shared by /api/history (closes) and /api/dividends (dividends/splits).

export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let crumbCache: { crumb: string; cookie: string; expires: number } | null = null;

export async function fetchCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (crumbCache && crumbCache.expires > Date.now()) return crumbCache;
  try {
    const home = await fetch("https://finance.yahoo.com/", { headers: { "User-Agent": UA }, cache: "no-store", redirect: "follow" });
    const raw = home.headers.get("set-cookie") ?? "";
    const cookie = raw.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
    const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie }, cache: "no-store" });
    const crumb = (await cr.text()).trim();
    if (!crumb || crumb.length > 40) return null;
    crumbCache = { crumb, cookie, expires: Date.now() + 25 * 60 * 1000 };
    return crumbCache;
  } catch { return null; }
}

// GET a v8 chart URL (no crumb param yet) with the crumb/cookie attached when available.
export async function yahooChart(base: string): Promise<any> {
  const c = await fetchCrumb();
  const url = c ? `${base}&crumb=${encodeURIComponent(c.crumb)}` : base;
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(c ? { Cookie: c.cookie } : {}) }, cache: "no-store" });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  return res.json();
}
