/**
 * JOJO 共用資料 API — 零依賴（Node 24+ 內建 node:sqlite / node:http）。
 *
 * 提供 storage.js 的 shared=true 後端：一張 KV 表，值是 JSON 字串。
 *
 * 併發策略（樂觀鎖）：每個 key 有遞增版本號 ver。
 *   PUT 必須帶客戶端最後看到的 baseVer；不符（或沒帶而 key 已存在）就回 409
 *   並附上目前的 value/ver，由客戶端合併後重試。
 *   這樣兩支手機同時記錄不會互相蓋掉——合併邏輯在 src/lib/storage.js。
 */
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import webpush from "web-push";

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || "./data/jojo.db";
const MAX_BODY = 2 * 1024 * 1024; // 值最大 2MB（logs 上限 800 筆遠小於此）

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  ver        INTEGER NOT NULL,
  updated_at TEXT NOT NULL
)`);

// 日誌歸檔：熱資料（jojo:logs 的 JSON 包）有 800 筆上限，這張表永久保存每一筆，
// 供歷史調閱與完整匯出。每次寫入 jojo:logs 時同步 upsert；熱資料範圍內被刪的也同步移除。
db.exec(`CREATE TABLE IF NOT EXISTS logs_archive (
  id   TEXT PRIMARY KEY,
  ts   INTEGER NOT NULL,
  by   TEXT, type TEXT, val TEXT, note TEXT
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_archive_ts ON logs_archive(ts)");

const qGet = db.prepare("SELECT value, ver FROM kv WHERE key = ?");
const qPut = db.prepare(`INSERT INTO kv (key, value, ver, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, ver = excluded.ver, updated_at = excluded.updated_at`);
const qDel = db.prepare("DELETE FROM kv WHERE key = ?");
const qList = db.prepare("SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key");
const qArcUp = db.prepare(`INSERT INTO logs_archive (id, ts, by, type, val, note) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, by = excluded.by, type = excluded.type, val = excluded.val, note = excluded.note`);
const qArcRange = db.prepare("SELECT id, ts, by, type, val, note FROM logs_archive WHERE ts >= ? AND ts <= ? ORDER BY ts DESC");
const qArcIdsSince = db.prepare("SELECT id FROM logs_archive WHERE ts >= ?");
const qArcDelOne = db.prepare("DELETE FROM logs_archive WHERE id = ?");
const qArcAll = db.prepare("SELECT id, ts, by, type, val, note FROM logs_archive ORDER BY ts ASC");

function syncArchive(valueStr) {
  let logs;
  try { logs = JSON.parse(valueStr); } catch { return; }
  if (!Array.isArray(logs)) return;
  db.exec("BEGIN");
  try {
    let minTs = Infinity;
    const ids = new Set();
    for (const l of logs) {
      if (!l || l.id == null || !Number.isFinite(Number(l.ts))) continue;
      qArcUp.run(String(l.id), Number(l.ts), String(l.by ?? ""), String(l.type ?? ""), String(l.val ?? ""), String(l.note ?? ""));
      ids.add(String(l.id));
      if (l.ts < minTs) minTs = l.ts;
    }
    // 熱資料時間範圍內、但這次清單沒有的 id ＝ 使用者刪了 → 歸檔同步移除
    // （比 minTs 更舊的是被 800 上限擠出的，保留）
    if (ids.size) {
      for (const row of qArcIdsSince.all(minTs)) {
        if (!ids.has(row.id)) qArcDelOne.run(row.id);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.error("archive sync failed:", e.message);
  }
}

// 啟動時把現有熱資料補進歸檔（升級後第一次跑會用到，之後等同 no-op）
{
  const row = qGet.get("jojo:logs");
  if (row) syncArchive(row.value);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

/* ============ Web Push：疫苗/驅蟲到期通知 ============ */
// VAPID 金鑰第一次啟動時產生，存在資料目錄（換金鑰會讓既有訂閱全部失效，所以要持久化）
const VAPID_PATH = join(dirname(DB_PATH), "vapid.json");
let vapid;
if (existsSync(VAPID_PATH)) {
  vapid = JSON.parse(readFileSync(VAPID_PATH, "utf8"));
} else {
  vapid = webpush.generateVAPIDKeys();
  writeFileSync(VAPID_PATH, JSON.stringify(vapid));
}
webpush.setVapidDetails("mailto:b97170098@gmail.com", vapid.publicKey, vapid.privateKey);

db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  sub        TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);
// 已通知的（項目 id + 到期日）：同一週期只提醒一次，更新日期後的新週期會再提醒
db.exec("CREATE TABLE IF NOT EXISTS push_sent (k TEXT PRIMARY KEY, sent_at TEXT NOT NULL)");
const qSubUp = db.prepare(`INSERT INTO push_subs (endpoint, sub, created_at) VALUES (?, ?, ?)
  ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub`);
const qSubDel = db.prepare("DELETE FROM push_subs WHERE endpoint = ?");
const qSubAll = db.prepare("SELECT endpoint, sub FROM push_subs");
const qSentGet = db.prepare("SELECT k FROM push_sent WHERE k = ?");
const qSentUp = db.prepare("INSERT OR REPLACE INTO push_sent (k, sent_at) VALUES (?, ?)");

async function pushToAll(payload) {
  const body = JSON.stringify(payload);
  let sent = 0, removed = 0;
  for (const row of qSubAll.all()) {
    try {
      await webpush.sendNotification(JSON.parse(row.sub), body);
      sent++;
    } catch (e) {
      // 410/404 = 訂閱已失效（使用者關通知或換瀏覽器），清掉
      if (e.statusCode === 404 || e.statusCode === 410) { qSubDel.run(row.endpoint); removed++; }
      else console.error("push failed:", e.statusCode || e.message);
    }
  }
  return { sent, removed, total: qSubAll.all().length };
}

const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function checkVaxDue() {
  try {
    const row = qGet.get("jojo:medical");
    if (!row) return;
    const med = JSON.parse(row.value);
    for (const v of med.vax || []) {
      if (!v?.date || !v?.cycleDays) continue;
      const due = new Date(new Date(v.date).getTime() + v.cycleDays * 86400000);
      const daysLeft = Math.round((due - Date.now()) / 86400000);
      if (daysLeft > 3 || daysLeft < 0) continue;
      const k = `${v.id}|${localDay(due)}`;
      if (qSentGet.get(k)) continue;
      const dueStr = `${due.getMonth() + 1}/${due.getDate()}`;
      pushToAll({
        title: "JOJO 疫苗/驅蟲提醒",
        body: daysLeft === 0 ? `「${v.name}」今天（${dueStr}）到期！` : `「${v.name}」還有 ${daysLeft} 天到期（${dueStr}）`,
      }).then((r) => {
        // 還沒有任何訂閱時不標記，之後有人訂閱了會補通知
        if (r.sent > 0) qSentUp.run(k, new Date().toISOString());
      });
    }
  } catch (e) { console.error("vax check failed:", e.message); }
}
setInterval(checkVaxDue, 3600 * 1000); // 每小時檢查
setTimeout(checkVaxDue, 10 * 1000);    // 啟動後也跑一次

/* ============ 匯出到 Google 試算表 ============ */
// 目標是使用者自建的 Google Apps Script Web App（設定方式見 README）。
// URL 由環境變數 EXPORT_SHEET_URL 提供，不寫死在程式裡。
const TYPE_LABEL = { meal: "吃飯", walk: "散步", potty: "便便", train: "訓練", care: "照顧", med: "餵藥", supp: "營養品", cond: "狀態" };
const SKILL_LABEL = {
  sit: "坐下", down: "趴下", stay: "等待", come: "召回", leash: "牽繩不暴衝", potty: "定點上廁所",
  paw: "握手", roll: "翻滾", dead: "裝死", weave: "繞腿", fetch: "尋回", quiet: "安靜指令",
};
const pad2 = (n) => String(n).padStart(2, "0");

function buildExportPayload() {
  const read = (key) => { const row = qGet.get(key); return row ? JSON.parse(row.value) : null; };
  const logs = qArcAll.all(); // 從歸檔匯出＝完整歷史，不受熱資料 800 筆上限影響
  const med = read("jojo:medical") || {};
  return {
    logs: logs.map((l) => {
      const d = new Date(l.ts);
      const val = l.type === "train" ? (SKILL_LABEL[l.val] || l.val) : l.type === "walk" ? `${l.val} 分鐘` : String(l.val ?? "");
      return [
        `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
        `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
        l.by || "", TYPE_LABEL[l.type] || l.type, val, l.note || "",
      ];
    }),
    weights: (med.weights || []).map((w) => [w.date, w.kg]),
    temps: (med.temps || []).map((t) => [t.date, t.c]),
    vax: (med.vax || []).map((v) => [v.name, v.date, v.cycleDays]),
    visits: (med.visits || []).map((v) => [v.date, v.clinic || "", v.reason || "", v.med || ""]),
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });

    // Web Push
    if (url.pathname === "/api/push/key" && req.method === "GET")
      return send(res, 200, { key: vapid.publicKey });
    if (url.pathname === "/api/push/subscribe" && req.method === "POST") {
      const sub = await readBody(req);
      if (!sub?.endpoint) return send(res, 400, { error: "bad subscription" });
      qSubUp.run(sub.endpoint, JSON.stringify(sub), new Date().toISOString());
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/push/unsubscribe" && req.method === "POST") {
      const b = await readBody(req);
      if (b?.endpoint) qSubDel.run(b.endpoint);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/push/test" && req.method === "POST") {
      const r = await pushToAll({ title: "JOJO 測試通知", body: "通知功能正常，到期提醒會像這樣出現 🐶" });
      return send(res, 200, { ok: true, ...r });
    }

    // 歷史調閱：依時間範圍查歸檔（毫秒 timestamp）
    if (url.pathname === "/api/history" && req.method === "GET") {
      const fromTs = Number(url.searchParams.get("fromTs") || 0);
      const toTs = Number(url.searchParams.get("toTs") || Date.now());
      if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return send(res, 400, { error: "bad range" });
      return send(res, 200, { rows: qArcRange.all(fromTs, toTs) });
    }

    if (url.pathname === "/api/export" && req.method === "POST") {
      const target = process.env.EXPORT_SHEET_URL;
      if (!target) return send(res, 400, { error: "EXPORT_SHEET_URL not set" });
      const payload = buildExportPayload();
      const resp = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "text/plain" }, // 避免 GAS 的 CORS/預檢問題
        body: JSON.stringify(payload),
        redirect: "follow",
      });
      const text = await resp.text();
      return send(res, resp.ok ? 200 : 502, {
        ok: resp.ok, status: resp.status, rows: payload.logs.length, result: text.slice(0, 200),
      });
    }

    if (url.pathname === "/api/kv" && req.method === "GET") {
      const prefix = url.searchParams.get("prefix") || "";
      const like = prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
      const keys = qList.all(like).map((r) => r.key);
      return send(res, 200, { keys, prefix });
    }

    const m = url.pathname.match(/^\/api\/kv\/(.+)$/);
    if (!m) return send(res, 404, { error: "not found" });
    const key = decodeURIComponent(m[1]);

    if (req.method === "GET") {
      const row = qGet.get(key);
      if (!row) return send(res, 404, { error: "no such key", key });
      return send(res, 200, { key, value: row.value, ver: row.ver });
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      if (typeof body.value !== "string") return send(res, 400, { error: "value must be a string" });
      const row = qGet.get(key);
      const current = row ? row.ver : null;
      // 樂觀鎖：baseVer 對不上（含「沒帶 baseVer 但 key 已存在」）→ 409 附現值
      if (current !== null ? body.baseVer !== current : body.baseVer !== undefined)
        return send(res, 409, { error: "version conflict", key, value: row?.value ?? null, ver: current });
      const ver = (current || 0) + 1;
      qPut.run(key, body.value, ver, new Date().toISOString());
      if (key === "jojo:logs") syncArchive(body.value);
      return send(res, 200, { key, ver });
    }

    if (req.method === "DELETE") {
      qDel.run(key);
      return send(res, 200, { key, deleted: true });
    }

    return send(res, 405, { error: "method not allowed" });
  } catch (e) {
    return send(res, 400, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`jojo api listening on :${PORT}, db at ${DB_PATH}`);
});
