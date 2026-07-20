// ── Google Drive persistence ──────────────────────────────────────────────────

// Called when Drive rejects the token (expired/revoked) so the UI can renew/logout.
let onDriveAuthExpired: (() => void) | null = null;
export function setOnDriveAuthExpired(fn: (() => void) | null) {
  onDriveAuthExpired = fn;
}

async function driveReq(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!res.ok) {
    // 401 = token expired/invalid. Google tokens (implicit flow) last ~1h with no
    // refresh, so let the UI renew silently (or log out) instead of silently failing.
    if (res.status === 401) onDriveAuthExpired?.();
    throw new Error(`Drive ${res.status}`);
  }
  return res;
}

export async function listPortfolios(token: string): Promise<{id: string, name: string}[]> {
  const res = await driveReq(`https://www.googleapis.com/drive/v3/files?q=name contains 'portfolio-' and mimeType='application/json' and trashed=false&fields=files(id,name)&orderBy=name`, token);
  const data = await res.json();
  return (data.files || []).map((f: any) => ({ id: f.id, name: f.name.replace("portfolio-","").replace(".json","") }));
}

export async function loadPortfolio(token: string, fileId: string): Promise<any[]> {
  const res = await driveReq(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, token);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function savePortfolio(token: string, fileId: string | null, name: string, holdings: any[]): Promise<string> {
  const json = JSON.stringify(holdings, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  if (fileId) {
    await driveReq(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: blob });
    return fileId;
  } else {
    const meta = JSON.stringify({ name: `portfolio-${name}.json`, mimeType: "application/json" });
    const boundary = "pb";
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const res = await driveReq("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", token, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    const created = await res.json();
    return created.id;
  }
}

export async function deletePortfolio(token: string, fileId: string) {
  await driveReq(`https://www.googleapis.com/drive/v3/files/${fileId}`, token, { method: "DELETE" });
}

// The portfolio's display name is encoded in the Drive filename (portfolio-{name}.json),
// so renaming is a metadata PATCH — no re-upload of the holdings blob.
export async function renamePortfolio(token: string, fileId: string, newName: string): Promise<void> {
  await driveReq(`https://www.googleapis.com/drive/v3/files/${fileId}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `portfolio-${newName}.json` }),
  });
}
