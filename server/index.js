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
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

/* ============ 匯出到 Google 試算表 ============ */
// 目標是使用者自建的 Google Apps Script Web App（設定方式見 README）。
// URL 由環境變數 EXPORT_SHEET_URL 提供，不寫死在程式裡。
const TYPE_LABEL = { meal: "吃飯", walk: "散步", potty: "便便", train: "訓練", care: "照顧", med: "餵藥", supp: "營養品" };
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
