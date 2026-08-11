// ── Client-side shard cache (IndexedDB) ───────────────────────────────────────
// Historical closes are sharded by (symbol, year). Past-year shards never change, so
// once fetched they live in IndexedDB forever — repeat sessions read them instantly and
// never re-download. Only the current year (and brand-new symbols) hit the network.
//
// Key = "SYMBOL:YEAR" → DayMap ({ "YYYY-MM-DD": close }).

export type DayMap = Record<string, number>;

const DB_NAME = "px-cache";
const STORE = "shards";

function openDB(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function getShards(keys: string[]): Promise<Record<string, DayMap>> {
  const db = await openDB();
  const out: Record<string, DayMap> = {};
  if (!db || !keys.length) return out;
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    let pending = keys.length;
    for (const k of keys) {
      const r = store.get(k);
      r.onsuccess = () => { if (r.result) out[k] = r.result; if (--pending === 0) resolve(); };
      r.onerror = () => { if (--pending === 0) resolve(); };
    }
    tx.onabort = () => resolve();
  });
  db.close();
  return out;
}

export async function putShards(entries: Record<string, DayMap>): Promise<void> {
  const keys = Object.keys(entries);
  const db = await openDB();
  if (!db || !keys.length) return;
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const k of keys) store.put(entries[k], k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}
