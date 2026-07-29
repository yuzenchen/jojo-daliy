/**
 * 儲存抽象層。介面不變：get / set / delete / list（UI 只准呼叫這裡）。
 *
 * 方案 B（全家共用）已接上：
 *   shared=true  → 走同源 API（/api/kv/...，由 Pi 上的 SQLite 保存，全家同一份）
 *   shared=false → 留在本機 IndexedDB（例如「我是誰」）
 *
 * 併發安全（樂觀鎖 + 合併）：
 *   每個 key 有版本號。寫入帶上最後看到的版本，版本不符伺服器回 409 並附現值，
 *   這裡把「我要寫的」與「伺服器現有的」合併後重試——兩支手機同時記錄不會互相蓋掉。
 *   已知 key 的合併規則：
 *     jojo:logs    → 依 id 聯集，時間新到舊，維持 800 筆上限
 *     jojo:medical → vax / visits / weights 各依 id 聯集
 *     jojo:profile → skills 逐項取較大值，其餘欄位以本次寫入為準
 *   注意：發生衝突合併時，「刪除」可能被另一端的舊資料復活（罕見，重刪一次即可）。
 *
 * 一次性搬移：首次向伺服器要某個 key 拿到 404 時，若本機 IndexedDB 有舊資料
 * （純本機階段留下的），自動上傳當作初始資料。
 */

const API = "/api/kv";

/* ============ IndexedDB（shared=false 與舊資料搬移用） ============ */
const DB_NAME = "jojo";
const STORE = "kv";
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const prefixed = (key, shared) => `${shared ? "shared" : "self"}:${key}`;

async function idbGet(key, shared) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(prefixed(key, shared));
    req.onsuccess = () => {
      const v = req.result;
      resolve(v === undefined ? null : { key, value: v, shared });
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value, shared) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(value, prefixed(key, shared));
    t.oncomplete = () => resolve({ key, value, shared });
    t.onerror = () => reject(t.error);
  });
}

async function idbDel(key, shared) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).delete(prefixed(key, shared));
    t.oncomplete = () => resolve({ key, deleted: true, shared });
    t.onerror = () => reject(t.error);
  });
}

async function idbList(prefix, shared) {
  const db = await openDB();
  const full = prefixed(prefix, shared);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).getAllKeys();
    req.onsuccess = () => {
      const strip = `${shared ? "shared" : "self"}:`;
      const keys = req.result
        .filter((k) => typeof k === "string" && k.startsWith(full))
        .map((k) => k.slice(strip.length));
      resolve({ keys, prefix, shared });
    };
    req.onerror = () => reject(req.error);
  });
}

/* ============ 合併規則（衝突時用） ============ */

function mergeById(mine = [], theirs = []) {
  const m = new Map();
  [...theirs, ...mine].forEach((x) => x && x.id != null && m.set(x.id, x));
  return [...m.values()];
}

function mergeValue(key, mineStr, theirsStr) {
  if (theirsStr == null) return mineStr;
  try {
    const mine = JSON.parse(mineStr);
    const theirs = JSON.parse(theirsStr);
    if (key === "jojo:logs")
      return JSON.stringify(
        mergeById(mine, theirs).sort((a, b) => b.ts - a.ts).slice(0, 800)
      );
    if (key === "jojo:medical")
      return JSON.stringify({
        vax: mergeById(mine.vax, theirs.vax),
        visits: mergeById(mine.visits, theirs.visits),
        weights: mergeById(mine.weights, theirs.weights),
        temps: mergeById(mine.temps, theirs.temps),
      });
    if (key === "jojo:profile") {
      const skills = { ...(theirs.skills || {}) };
      for (const [k, v] of Object.entries(mine.skills || {}))
        skills[k] = Math.max(Number(v) || 0, Number(skills[k]) || 0);
      return JSON.stringify({ ...theirs, ...mine, skills });
    }
  } catch {
    /* 解析失敗就以本次寫入為準 */
  }
  return mineStr;
}

/* ============ API（shared=true） ============ */

// 各 key 最後看到的伺服器版本號（樂觀鎖用）
const seenVer = new Map();

async function apiGet(key) {
  const res = await fetch(`${API}/${encodeURIComponent(key)}`);
  if (res.status === 404) {
    // 伺服器沒有 → 舊的純本機資料自動搬上去（只會發生一次）
    const local = await idbGet(key, true);
    if (local) {
      try {
        await apiSet(key, local.value);
        return { key, value: local.value, shared: true };
      } catch {
        return local; // 搬移失敗仍讓 App 可讀舊資料
      }
    }
    return null;
  }
  if (!res.ok) throw new Error(`get ${key}: ${res.status}`);
  const d = await res.json();
  seenVer.set(key, d.ver);
  return { key, value: d.value, shared: true };
}

async function apiSet(key, value) {
  let v = value;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: v, baseVer: seenVer.get(key) }),
    });
    if (res.status === 409) {
      const cur = await res.json();
      v = mergeValue(key, v, cur.value);
      if (cur.ver != null) seenVer.set(key, cur.ver);
      else seenVer.delete(key);
      continue;
    }
    if (!res.ok) throw new Error(`set ${key}: ${res.status}`);
    const d = await res.json();
    seenVer.set(key, d.ver);
    return { key, value: v, shared: true };
  }
  throw new Error(`set ${key}: too many conflicts`);
}

async function apiDel(key) {
  const res = await fetch(`${API}/${encodeURIComponent(key)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete ${key}: ${res.status}`);
  seenVer.delete(key);
  return { key, deleted: true, shared: true };
}

async function apiList(prefix) {
  const res = await fetch(`${API}?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) throw new Error(`list ${prefix}: ${res.status}`);
  const d = await res.json();
  return { keys: d.keys, prefix, shared: true };
}

/* ============ 對外介面（與原型一致） ============ */

/** 取值。回傳 { key, value, shared } 或 null。 */
export async function get(key, shared = false) {
  return shared ? apiGet(key) : idbGet(key, false);
}

/** 存值。value 必須是 JSON 字串。回傳的 value 可能是衝突合併後的結果。 */
export async function set(key, value, shared = false) {
  return shared ? apiSet(key, value) : idbSet(key, value, false);
}

/** 刪除。 */
export async function del(key, shared = false) {
  return shared ? apiDel(key) : idbDel(key, false);
}

/** 列出符合前綴的 key。 */
export async function list(prefix = "", shared = false) {
  return shared ? apiList(prefix) : idbList(prefix, false);
}

export const storage = { get, set, delete: del, list };
export default storage;
