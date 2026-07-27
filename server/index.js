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

const qGet = db.prepare("SELECT value, ver FROM kv WHERE key = ?");
const qPut = db.prepare(`INSERT INTO kv (key, value, ver, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, ver = excluded.ver, updated_at = excluded.updated_at`);
const qDel = db.prepare("DELETE FROM kv WHERE key = ?");
const qList = db.prepare("SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key");

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

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });

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
