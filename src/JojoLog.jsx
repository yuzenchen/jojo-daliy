import React, { useState, useEffect, useMemo, useRef } from "react";
import { storage } from "./lib/storage";

/* ============ 資料鍵 ============ */
const K = {
  prof: "jojo:profile",
  logs: "jojo:logs",
  med: "jojo:medical",
  me: "jojo:me",
};

/* ============ 像素狗 ============ */
const DOG_AWAKE = [
  "..##........##..",
  ".####......####.",
  ".######..######.",
  "..############..",
  ".##############.",
  ".##############.",
  ".###.######.###.",
  ".##############.",
  ".######..######.",
  "..####....####..",
  "..############..",
  "...##########...",
  "..############..",
  ".####......####.",
  ".###........###.",
  "..##........##..",
];
function Pixels({ grid, label }) {
  const cell = 7;
  const rects = [];
  grid.forEach((row, y) =>
    row.split("").forEach((c, x) => {
      if (c === "#")
        rects.push(
          <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} />
        );
    })
  );
  return (
    <svg viewBox={`0 0 ${16 * cell} ${16 * cell}`} className="dog" aria-label={label}>
      <g fill="var(--ink)">{rects}</g>
    </svg>
  );
}

/* ============ 快速記錄設定（依設計 handoff） ============ */
const QUICK_CFG = {
  meal: { icon: "🍚", label: "吃飯", segName: "餐別", seg: ["早餐", "午餐", "晚餐", "點心"], chipsName: "內容", chips: ["雞肉", "鹿肉", "飼料", "鮮食"] },
  walk: { icon: "🚶", label: "散步", segName: "時長", seg: ["15 分鐘", "30 分鐘", "45 分鐘", "60 分鐘"] },
  potty: { icon: "💩", label: "便便", segName: "狀態", seg: ["正常", "偏軟", "偏硬", "拉肚子"] },
  care: { icon: "🧼", label: "照顧", chipsName: "項目", chips: ["洗澡", "梳毛", "剪指甲", "清耳朵"] },
  health: { icon: "🩺", label: "健康", segName: "類型", seg: ["餵藥", "營養品", "看診"] },
};

/** 12 小時制時間標籤：「上午 09:50」 */
const fmtTime = (ts) => {
  const d = new Date(ts);
  const h = d.getHours();
  return `${h < 12 ? "上午" : "下午"} ${pad2(((h + 11) % 12) + 1)}:${pad2(d.getMinutes())}`;
};

/** 紀錄列標題／副行（今天列表與月曆共用） */
const recTitle = (r) =>
  r.type === "train" ? `訓練 ${SKILLS.find((s) => s.id === r.val)?.name || r.val}`
  : r.type === "walk" ? `散步 ${r.val} 分鐘`
  : r.type === "med" ? `餵藥${r.val ? "" : ""}`
  : r.type === "supp" ? "營養品"
  : `${TYPE_META[r.type]?.label || r.type}${r.val ? ` ${r.val}` : ""}`;
const recSub = (r) =>
  [...(r.chips || []), (r.type === "med" || r.type === "supp") && r.val ? r.val : null, r.note]
    .filter(Boolean).join("・");

/* ============ 頭像上傳（置中裁方形 → data URL） ============ */
function cropTo(img, size, mime, q) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL(mime, q);
}
const imageToDataUrl = (img) => cropTo(img, 128, "image/jpeg", 0.85); // 畫面顯示用，約 5–10KB
const imageToIconUrl = (img) => cropTo(img, 192, "image/png");        // PWA/favicon/通知圖示用

/* ============ 到期通知（Web Push） ============ */
const b64ToU8 = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

function PushSetup({ flash }) {
  const [state, setState] = useState("checking"); // checking/unsupported/denied/off/on
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext)
      return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      setState(sub ? "on" : "off");
    } catch { setState("off"); }
  };
  useEffect(() => { refresh(); }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const { key } = await (await fetch("/api/push/key")).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
      await fetch("/api/push/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub),
      });
      setState("on"); flash("🔔 到期通知已開啟");
    } catch {
      flash(Notification.permission === "denied" ? "通知權限被拒絕了" : "開啟失敗，請稍後再試");
      refresh();
    }
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off"); flash("🔕 已關閉通知");
    } catch { refresh(); }
    setBusy(false);
  };

  return (
    <div className="inlineForm">
      <p className="formHint">
        疫苗／驅蟲剩 3 天內到期時推播提醒（本裝置）。
        {state === "unsupported" && " 此環境不支援：請用 https 網址開啟；iPhone 需 iOS 16.4+ 並先「加入主畫面」。"}
        {state === "denied" && " 你先前拒絕了通知權限，要到瀏覽器設定裡重新允許。"}
      </p>
      {state === "off" && <button className="primary" disabled={busy} onClick={enable}>🔔 開啟到期通知</button>}
      {state === "on" && (
        <>
          <button className="primary" disabled={busy} onClick={async () => {
            try {
              const reg = await navigator.serviceWorker.getRegistration();
              const sub = reg && (await reg.pushManager.getSubscription());
              if (!sub) { flash("此裝置尚未訂閱，請重新開啟通知"); setState("off"); return; }
              const res = await fetch("/api/push/test", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endpoint: sub.endpoint }),
              });
              const r = await res.json();
              if (res.ok && r.sent > 0) flash("已發送測試通知到本裝置");
              else if (r.error === "not subscribed") { flash("伺服器沒有這台裝置的訂閱，請關閉後重新開啟通知"); setState("off"); }
              else flash("測試發送失敗，請關閉後重新開啟通知");
            } catch { flash("測試發送失敗，請稍後再試"); }
          }}>發送測試通知（本裝置）</button>
          <button className="ghost" disabled={busy} onClick={disable}>關閉本裝置的通知</button>
        </>
      )}
    </div>
  );
}

function MeQuickEdit({ me, onSave }) {
  const [v, setV] = useState(me || "");
  const dirty = v.trim() && v.trim() !== me;
  return (
    <div className="inlineForm">
      <label className="lab">我的名字（記錄者標記，只影響之後的新紀錄）
        <input className="input" value={v} maxLength={8} onChange={(e) => setV(e.target.value)} />
      </label>
      {dirty && <button className="primary" onClick={() => onSave(v.trim())}>儲存名字</button>}
    </div>
  );
}

function ProfileQuickEdit({ prof, onSave }) {
  const [birth, setBirth] = useState(prof?.birth || "");
  const [goalKg, setGoalKg] = useState(prof?.goalKg ?? "");
  const dirty = birth !== (prof?.birth || "") || String(goalKg) !== String(prof?.goalKg ?? "");
  return (
    <div className="inlineForm">
      <label className="lab">生日（或到家日）
        <input className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
      </label>
      <label className="lab">目標體重（公斤）
        <input className="input" type="number" step="0.1" value={goalKg} onChange={(e) => setGoalKg(e.target.value)} />
      </label>
      {dirty && (
        <button className="primary" onClick={() => onSave({ birth, goalKg: Number(goalKg) || null })}>
          儲存基本資料
        </button>
      )}
    </div>
  );
}

function AvatarForm({ prof, onSave }) {
  const [picked, setPicked] = useState(null); // { avatar, avatarIcon }

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const img = await createImageBitmap(f);
      setPicked({ avatar: imageToDataUrl(img), avatarIcon: imageToIconUrl(img) });
    } catch { setPicked(null); }
  };

  return (
    <>
      <p className="formHint">
        挑一張 JOJO 的照片當頭像（全家都看得到，App 圖示與通知也會用它）。會自動置中裁成正方形。
      </p>
      <input className="input" type="file" accept="image/*" onChange={onFile} />
      {picked && (
        <>
          <div className="avatarPrev"><img className="dogPhoto" src={picked.avatar} alt="頭像預覽" /></div>
          <button className="primary" onClick={() => onSave(picked)}>就用這張</button>
        </>
      )}
      {prof?.avatar && (
        <button className="ghost" onClick={() => onSave(null)}>恢復預設像素狗</button>
      )}
    </>
  );
}

/* ============ 技能樹 ============ */
const SKILLS = [
  { id: "sit", name: "坐下", tier: "基礎" },
  { id: "down", name: "趴下", tier: "基礎" },
  { id: "stay", name: "等待", tier: "基礎" },
  { id: "come", name: "召回", tier: "基礎" },
  { id: "leash", name: "牽繩不暴衝", tier: "基礎" },
  { id: "potty", name: "定點上廁所", tier: "基礎" },
  { id: "paw", name: "握手", tier: "進階" },
  { id: "roll", name: "翻滾", tier: "進階" },
  { id: "dead", name: "裝死", tier: "進階" },
  { id: "weave", name: "繞腿", tier: "進階" },
  { id: "fetch", name: "尋回", tier: "進階" },
  { id: "quiet", name: "安靜指令", tier: "進階" },
];
const TIERS = [
  { at: 0, label: "未開始" },
  { at: 10, label: "學習中" },
  { at: 25, label: "熟練" },
  { at: 50, label: "精通" },
];
const skillLevel = (reps) => {
  let l = 0;
  TIERS.forEach((t, i) => { if (reps >= t.at) l = i; });
  return l;
};

/* ============ 工具 ============ */
const uid = () => Math.random().toString(36).slice(2, 9);
const pad2 = (n) => String(n).padStart(2, "0");
/** ts → datetime-local 欄位值（本地時區） */
const tsToLocalInput = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
/** 生日 → 「X 歲 Y 個月」（未滿一歲只顯示月）。無效或未設回傳 null。 */
function ageText(birth) {
  if (!birth) return null;
  const b = new Date(birth), now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months--;
  if (!Number.isFinite(months) || months < 0) return null;
  const y = Math.floor(months / 12), m = months % 12;
  return y > 0 ? `${y} 歲${m ? ` ${m} 個月` : ""}` : `${m} 個月`;
}
const dayKey = (d) => new Date(d).toLocaleDateString("sv-SE");
const today = () => dayKey(Date.now());
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const TYPE_META = {
  meal: { label: "吃飯", icon: "🍚" },
  walk: { label: "散步", icon: "🚶" },
  potty: { label: "便便", icon: "💩" },
  train: { label: "訓練", icon: "🎓" },
  care: { label: "照顧", icon: "🧼" },
  med: { label: "餵藥", icon: "💊" },
  supp: { label: "營養品", icon: "🌿" },
  cond: { label: "狀態", icon: "🩺" },
  weight: { label: "體重", icon: "⚖️" },
};

/* ============ 主元件 ============ */
export default function JojoLog() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState(null);
  const [prof, setProf] = useState(null);
  const [logs, setLogs] = useState([]);
  const [med, setMed] = useState({ vax: [], visits: [], weights: [], temps: [] });
  const [tab, setTab] = useState("today");
  const [sheet, setSheet] = useState(null);      // "settings" ＝ JOJO 設定面板
  const [quick, setQuick] = useState(null);      // 快速記錄 bottom sheet：{type, seg, chips, note, at, editId}
  const [menuId, setMenuId] = useState(null);    // 長壓選單指向的紀錄 id
  const [confirmDel, setConfirmDel] = useState(false); // 刪除需要點兩次確認
  useEffect(() => { setConfirmDel(false); }, [menuId]);
  const [toast, setToast] = useState("");
  const [wx, setWx] = useState(null);

  /* 板橋天氣：載入時抓一次，之後每 30 分鐘更新（伺服器端另有快取） */
  useEffect(() => {
    let stop = false;
    const load = async () => { const w = await storage.weather(); if (!stop && w) setWx(w); };
    load();
    const t = setInterval(load, 30 * 60 * 1000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  /* 載入 */
  useEffect(() => {
    (async () => {
      const read = async (key, shared, fallback) => {
        try {
          const r = await storage.get(key, shared);
          return r ? JSON.parse(r.value) : fallback;
        } catch { return fallback; }
      };
      setMe(await read(K.me, false, null));
      setProf(await read(K.prof, true, null));
      setLogs(await read(K.logs, true, []));
      setMed(await read(K.med, true, { vax: [], visits: [], weights: [], temps: [] }));
      setReady(true);
    })();
  }, []);

  /* 輪詢：每 20 秒（與切回前景時）拉共用資料，家人剛記的紀錄才看得到 */
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const refresh = async () => {
      try {
        const [p, l, m] = await Promise.all([
          storage.get(K.prof, true),
          storage.get(K.logs, true),
          storage.get(K.med, true),
        ]);
        if (stop) return;
        if (p) setProf(JSON.parse(p.value));
        if (l) setLogs(JSON.parse(l.value));
        if (m) setMed(JSON.parse(m.value));
      } catch { /* 離線或伺服器沒開：維持現狀，下次再試 */ }
    };
    const t = setInterval(refresh, 20000);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [ready]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 1600); };

  const setterFor = { [K.prof]: setProf, [K.logs]: setLogs, [K.med]: setMed };
  const save = async (key, val, shared) => {
    try {
      const sent = JSON.stringify(val);
      const r = await storage.set(key, sent, shared);
      // 寫入時撞到別人的更新 → storage 層已合併，畫面同步成合併後的結果
      if (shared && r && r.value !== sent) setterFor[key]?.(JSON.parse(r.value));
    } catch { flash("存檔失敗，請再試一次"); }
  };

  const addLog = async (entry) => {
    const { ts, ...rest } = entry;
    const e = { id: uid(), ts: ts || Date.now(), by: me || "?", ...rest };
    // 補記過去時間的紀錄也要落在正確位置，統一依時間新到舊排
    const next = [e, ...logs].sort((a, b) => b.ts - a.ts).slice(0, 800);
    setLogs(next); await save(K.logs, next, true);
    setSheet(null); setQuick(null);
    flash(`已記錄 ${TYPE_META[entry.type]?.icon || ""} ✓`);
  };

  const deleteLog = async (id) => {
    const n = logs.filter((l) => l.id !== id);
    setLogs(n); await save(K.logs, n, true);
    setMenuId(null);
    flash("已刪除");
  };

  /* 快速記錄面板：儲存（新增或更新） */
  const saveQuick = async (q, v) => {
    const ts = v.at ? new Date(v.at).getTime() : undefined;
    if (q.editId) {
      const orig = logs.find((l) => l.id === q.editId);
      if (!orig) { setQuick(null); return; }
      const patch = { note: v.note, chips: v.chips, ts: ts ?? orig.ts };
      if (q.type === "meal") patch.val = v.seg || orig.val;
      else if (q.type === "walk") patch.val = parseInt(v.seg) || orig.val;
      else if (q.type === "potty") patch.val = v.seg || orig.val;
      else if (q.type === "care") patch.val = "";
      else if (q.type === "health") { patch.val = ""; patch.type = v.seg === "營養品" ? "supp" : "med"; }
      const next = logs.map((l) => (l.id === q.editId ? { ...l, ...patch } : l)).sort((a, b) => b.ts - a.ts);
      setLogs(next); await save(K.logs, next, true);
      setQuick(null); flash("已更新 ✓");
      return;
    }
    if (q.type === "health" && v.seg === "看診") {
      await saveMed({ ...med, visits: [{ id: uid(), date: today(), clinic: "", reason: v.note || "看診", med: "" }, ...(med.visits || [])] });
      setQuick(null); flash("已記錄 🩺 ✓");
      return;
    }
    const h = new Date().getHours();
    const mealDefault = h < 10 ? "早餐" : h < 14 ? "午餐" : h < 17 ? "點心" : "晚餐";
    if (q.type === "meal") await addLog({ type: "meal", val: v.seg || mealDefault, chips: v.chips, note: v.note, ts });
    else if (q.type === "walk") await addLog({ type: "walk", val: parseInt(v.seg) || 30, note: v.note, ts });
    else if (q.type === "potty") await addLog({ type: "potty", val: v.seg || "正常", note: v.note, ts });
    else if (q.type === "care") await addLog({ type: "care", val: "", chips: v.chips, note: v.note, ts });
    else if (q.type === "health") await addLog({ type: v.seg === "營養品" ? "supp" : "med", val: "", chips: [], note: v.note, ts });
  };

  /* 長壓選單 → 編輯：把該筆帶回對應面板 */
  const startEdit = (r) => {
    const map = { meal: "meal", walk: "walk", potty: "potty", care: "care", med: "health", supp: "health" };
    const qt = map[r.type];
    if (!qt) return;
    setMenuId(null);
    setQuick({
      type: qt, editId: r.id,
      seg: r.type === "walk" ? `${r.val} 分鐘`
        : r.type === "med" ? "餵藥" : r.type === "supp" ? "營養品"
        : r.val || null,
      chips: r.chips ? [...r.chips]
        : qt === "care" && r.val && QUICK_CFG.care.chips.includes(r.val) ? [r.val] : [],
      note: (r.type === "med" || r.type === "supp") && r.val
        ? [r.val, r.note].filter(Boolean).join("・")
        : qt === "care" && r.val && !QUICK_CFG.care.chips.includes(r.val)
          ? [r.val, r.note].filter(Boolean).join("・")
          : r.note || "",
      at: tsToLocalInput(r.ts),
    });
  };

  /* 事後編輯日誌（內容/備註/時間），改完依時間重排 */
  const editLog = async (id, patch) => {
    const next = logs.map((l) => (l.id === id ? { ...l, ...patch } : l)).sort((a, b) => b.ts - a.ts);
    setLogs(next); await save(K.logs, next, true);
    flash("✏️ 修改好了");
  };

  const saveMed = async (next) => { setMed(next); await save(K.med, next, true); };
  const saveProf = async (next) => { setProf(next); await save(K.prof, next, true); };


  /* 屬性計算 —— 全部來自真實紀錄 */
  const stats = useMemo(() => {
    const now = Date.now();
    const within = (d) => logs.filter((l) => now - l.ts < d * 86400000);

    const walk7 = within(7).filter((l) => l.type === "walk")
      .reduce((s, l) => s + (Number(l.val) || 0), 0);
    const vitality = clamp(Math.round((walk7 / (7 * 60)) * 100), 0, 100);

    const reps = prof?.skills || {};
    const skillTotal = SKILLS.reduce((s, k) => s + Math.min(reps[k.id] || 0, 50), 0);
    const skill = Math.round((skillTotal / (SKILLS.length * 50)) * 100);

    const days = new Set(within(30).map((l) => dayKey(l.ts)));
    const bond = clamp(Math.round((days.size / 30) * 100), 0, 100);

    const w = med.weights?.slice().sort((a, b) => a.date.localeCompare(b.date));
    const latest = w?.length ? w[w.length - 1].kg : null;
    let body = null;
    if (latest && prof?.goalKg) {
      const off = Math.abs(latest - prof.goalKg) / prof.goalKg;
      body = clamp(Math.round(100 - off * 320), 15, 100);
    }
    return { vitality, skill, bond, body, walk7, latest };
  }, [logs, prof, med]);

  const streak = useMemo(() => {
    const set = new Set(logs.map((l) => dayKey(l.ts)));
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const d = dayKey(Date.now() - i * 86400000);
      if (set.has(d)) n++;
      else if (i > 0) break;
    }
    return n;
  }, [logs]);

  const todayLogs = logs.filter((l) => dayKey(l.ts) === today());
  // 心情：依今天散步次數。兩次以上＝好、一次＝普通、還沒散步＝差
  const walksToday = todayLogs.filter((l) => l.type === "walk").length;
  const moodText = walksToday >= 2 ? "😊 好" : walksToday >= 1 ? "🙂 普通" : "😞 差";
  const age = prof?.birth ? daysBetween(prof.birth, Date.now()) : null;
  const menuRec = menuId ? logs.find((l) => l.id === menuId) : null;

  if (!ready) return <Shell><div className="loading">載入中…</div></Shell>;
  if (!me) return <Shell><NameSetup onDone={(n) => { setMe(n); save(K.me, n, false); }} /></Shell>;
  if (!prof) return <Shell><ProfileSetup onDone={saveProf} /></Shell>;

  return (
    <Shell>
      {/* 頭部列 */}
      <header className="top">
        <button className="avatarBtn" title="JOJO 設定" onClick={() => setSheet("avatar")}>
          {typeof prof.avatar === "string"
            ? <img className="avatarImg" src={prof.avatar} alt="JOJO" />
            : <span className="avatarFallback"><Pixels grid={DOG_AWAKE} label="JOJO" /></span>}
        </button>
        <div className="who">
          <div className="petName">{prof.name || "JOJO"}</div>
          <div className="petAge">{ageText(prof.birth) || "尚未設定生日"}</div>
        </div>
        <div className="pills">
          {age !== null && <span className="pill day">DAY {age}</span>}
          <span className="pill streak">🔥 連續 {streak}</span>
        </div>
      </header>

      {/* 狀態卡 */}
      <section className="statusCard">
        <div className="essentials">
          <div><span className="esLabel">心情</span><span className="esVal">{moodText}</span></div>
          <div><span className="esLabel">體重</span><span className="esVal">{stats.latest ? `${stats.latest} kg` : "—"}</span></div>
          <div><span className="esLabel">今日筆數</span><span className="esVal">{todayLogs.length} 筆</span></div>
        </div>
        {wx && (
          <div className={wx.temp >= 32 ? "wxLine hot" : "wxLine"}>
            <span>📍</span> 板橋 {wx.temp}°C・濕度 {wx.humidity}%{wx.temp >= 32 ? "（高溫注意）" : ""}
          </div>
        )}
      </section>

      {/* 分頁列 */}
      <div className="tabRow">
        <span className="tabName">
          {{ today: "今天", health: "健康", cal: "月曆" }[tab]}
          {tab === "today" && <span className="tabCount"> {todayLogs.length}</span>}
        </span>
        <div className="tabPills">
          {[["today", "今天"], ["health", "健康"], ["cal", "月曆"]].map(([k, l]) => (
            <button key={k} className={tab === k ? "tabPill on" : "tabPill"} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      <main className="content">
        {tab === "today" && <TodayGroups logs={todayLogs} onMenu={setMenuId} />}
        {tab === "health" && <HealthView med={med} prof={prof} onSave={saveMed} onAddLog={addLog} />}
        {tab === "cal" && <CalendarView logs={logs} onEdit={editLog} onDelete={async (id) => {
          const n = logs.filter((l) => l.id !== id); setLogs(n); await save(K.logs, n, true);
        }} />}
      </main>

      {/* 底部快速記錄列 */}
      <div className="actionBarWrap">
        <div className="actionBar">
          {Object.entries(QUICK_CFG).map(([k, c]) => (
            <button key={k} className="actionBtn"
              onClick={() => setQuick({ type: k, seg: null, chips: [], note: "", at: "", editId: null })}>
              <span className="aIcon">{c.icon}</span>
              <span className="aLabel">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 長壓選單 */}
      {menuRec && (
        <div className="menuBack" onClick={() => setMenuId(null)}>
          <div className="menuCard" onClick={(e) => e.stopPropagation()}>
            <div className="menuHead">
              <span className="menuIcon">{TYPE_META[menuRec.type]?.icon}</span>
              <span className="menuTitle">{recTitle(menuRec)}</span>
            </div>
            <div className="menuActs">
              {["meal", "walk", "potty", "care", "med", "supp"].includes(menuRec.type) && (
                <button className="menuEdit" onClick={() => startEdit(menuRec)}>✏️ 編輯</button>
              )}
              <button className={confirmDel ? "menuDel confirm" : "menuDel"}
                onClick={() => (confirmDel ? deleteLog(menuRec.id) : setConfirmDel(true))}>
                {confirmDel ? "確定刪除？再點一次" : "🗑 刪除"}
              </button>
              <button className="menuCancel" onClick={() => setMenuId(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 快速記錄面板 */}
      {quick && (
        <QuickSheet key={quick.editId || quick.type} q={quick}
          onSave={(v) => saveQuick(quick, v)}
          onClose={() => setQuick(null)} />
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(null)} title="JOJO 設定">
          {sheet === "avatar" && <>
            <MeQuickEdit me={me} onSave={async (n) => {
              setMe(n); await save(K.me, n, false);
              flash("✍️ 名字改好了");
            }} />
            <ProfileQuickEdit prof={prof} onSave={async (patch) => {
              await saveProf({ ...prof, ...patch });
              flash("📝 基本資料更新了");
            }} />
            <AvatarForm prof={prof} onSave={async (picked) => {
              await saveProf({ ...prof, avatar: picked?.avatar ?? null, avatarIcon: picked?.avatarIcon ?? null });
              setSheet(null); flash(picked ? "🐶 頭像換好了" : "🐶 回到預設狗");
            }} />
            <PushSetup flash={flash} />
            <div className="inlineForm">
              <p className="formHint">把全部紀錄匯出到 Google 試算表（覆蓋更新，設定方式見 README）。</p>
              <button className="primary" onClick={async () => {
                flash("📤 匯出中…");
                try {
                  const r = await fetch("/api/export", { method: "POST" });
                  const d = await r.json();
                  if (r.ok && d.ok) flash(`📤 匯出完成，共 ${d.rows} 筆紀錄`);
                  else flash(d.error === "EXPORT_SHEET_URL not set" ? "尚未設定匯出網址（見 README）" : "匯出失敗，請稍後再試");
                } catch { flash("匯出失敗，請稍後再試"); }
              }}>📤 匯出到 Google 試算表</button>
            </div>
          </>}
        </Sheet>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  );
}

/* ============ 外殼與樣式 ============ */
function Shell({ children }) {
  return (
    <div className="root">
      <style>{CSS}</style>
      <div className="frame">{children}</div>
    </div>
  );
}

/* ============ 設定流程 ============ */
function NameSetup({ onDone }) {
  const [v, setV] = useState("");
  return (
    <div className="setup">
      <h1 className="setupTitle">你是誰？</h1>
      <p className="setupHint">每筆紀錄都會標記記錄者，家人才知道飯餵過沒有。</p>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="例如：媽、阿哲" maxLength={8} />
      <button className="primary" disabled={!v.trim()} onClick={() => onDone(v.trim())}>開始</button>
    </div>
  );
}

function ProfileSetup({ onDone }) {
  const [f, setF] = useState({ name: "JOJO", birth: "", breed: "", goalKg: "" });
  return (
    <div className="setup">
      <h1 className="setupTitle">JOJO 的基本資料</h1>
      <label className="lab">名字<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="lab">生日（或到家日）<input className="input" type="date" value={f.birth} onChange={(e) => setF({ ...f, birth: e.target.value })} /></label>
      <label className="lab">品種<input className="input" value={f.breed} onChange={(e) => setF({ ...f, breed: e.target.value })} placeholder="米克斯" /></label>
      <label className="lab">目標體重（公斤）<input className="input" type="number" step="0.1" value={f.goalKg} onChange={(e) => setF({ ...f, goalKg: e.target.value })} placeholder="12.5" /></label>
      <button className="primary" onClick={() => onDone({ ...f, goalKg: Number(f.goalKg) || null, skills: {} })}>建立</button>
    </div>
  );
}

/* ============ 記錄表單 ============ */
function Row({ children }) { return <div className="row">{children}</div>; }

/** 記錄時間欄：留空＝現在。回傳給表單的是 datetime-local 字串。 */
function TimePick({ value, onChange }) {
  return (
    <label className="lab">時間（留空＝現在，可補記過去）
      <input className="input" type="datetime-local" value={value}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
const pickTs = (at) => (at ? new Date(at).getTime() : undefined);

/* ============ 今天：時間群組列表（長壓編輯/刪除） ============ */
function LogRow({ r, onMenu }) {
  const timer = useRef(null);
  const start = () => { clearTimeout(timer.current); timer.current = setTimeout(() => onMenu(r.id), 450); };
  const cancel = () => clearTimeout(timer.current);
  return (
    <div className="lrow"
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel}
      onContextMenu={(e) => { e.preventDefault(); cancel(); onMenu(r.id); }}>
      <span className="lIcon">{TYPE_META[r.type]?.icon || "📝"}</span>
      <div className="lBody">
        <div className="lTitle">{recTitle(r)}</div>
        {recSub(r) && <div className="lSub">{recSub(r)}</div>}
      </div>
      <span className="lBy">{r.by}</span>
    </div>
  );
}

function TodayGroups({ logs, onMenu }) {
  if (!logs.length)
    return <Empty text="今天還沒有紀錄。用下方按鈕記第一筆；過去的紀錄到「月曆」點日期查看。" />;
  const groups = [];
  logs.forEach((r) => {
    const t = fmtTime(r.ts);
    const g = groups[groups.length - 1];
    if (g && g.time === t) g.items.push(r);
    else groups.push({ time: t, items: [r] });
  });
  return (
    <>
      {groups.map((g, i) => (
        <div key={i} className="tGroup">
          <div className="tTime">{g.time}</div>
          <div className="tCard">
            {g.items.map((r) => <LogRow key={r.id} r={r} onMenu={onMenu} />)}
          </div>
        </div>
      ))}
      <div className="pressHint">長壓任一筆可編輯或刪除</div>
    </>
  );
}

/* ============ 快速記錄面板（bottom sheet，依設計 handoff） ============ */
function QuickSheet({ q, onSave, onClose }) {
  const cfg = QUICK_CFG[q.type];
  const [seg, setSeg] = useState(q.seg);
  const [chips, setChips] = useState(q.chips || []);
  const [note, setNote] = useState(q.note || "");
  const [at, setAt] = useState(q.at || "");
  const editing = !!q.editId;
  // 編輯既有日誌時不提供「看診」（那是健康頁的就診資料，不是日誌）
  const segOpts = editing && q.type === "health" ? cfg.seg.filter((s) => s !== "看診") : cfg.seg;

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="qsWrap">
      <div className="qsBack" onClick={onClose} />
      <div className="qsPanel">
        <div className="qsHandle" />
        <div className="qsHead">
          <span className="qsIcon">{cfg.icon}</span>
          <span className="qsTitle">{editing ? "編輯・" : ""}{cfg.label}</span>
          <span className="qsNow">{fmtTime(at ? new Date(at).getTime() : Date.now())}</span>
        </div>
        {segOpts && (
          <>
            <div className="qsField">{cfg.segName}</div>
            <div className="qsSegRow">
              {segOpts.map((s) => (
                <button key={s} className={seg === s ? "qsSeg on" : "qsSeg"} onClick={() => setSeg(s)}>{s}</button>
              ))}
            </div>
          </>
        )}
        {cfg.chips && (
          <>
            <div className="qsField">{cfg.chipsName}（可複選、可跳過）</div>
            <div className="qsChipRow">
              {cfg.chips.map((c) => (
                <button key={c} className={chips.includes(c) ? "qsChip on" : "qsChip"}
                  onClick={() => setChips(chips.includes(c) ? chips.filter((x) => x !== c) : [...chips, c])}>{c}</button>
              ))}
            </div>
          </>
        )}
        <input className="qsNote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="備註⋯" />
        <div className="qsField">時間（留空＝現在，可補記）</div>
        <input className="qsNote qsTimeInput" type="datetime-local" value={at}
          placeholder="例：上午 09:30" onChange={(e) => setAt(e.target.value)} />
        <button className="qsSave" onClick={() => onSave({ seg, chips, note, at })}>
          {editing ? "更新紀錄" : "儲存紀錄"}
        </button>
      </div>
    </div>
  );
}

function WeightForm({ med, initial, onSave }) {
  const last = med.weights?.[med.weights.length - 1];
  const [kg, setKg] = useState(initial?.kg ?? "");
  const [date, setDate] = useState(initial?.date || today());
  return (
    <>
      {!initial && <p className="formHint">{last ? `上次 ${last.kg} kg（${last.date}）` : "還沒有體重紀錄"}</p>}
      <label className="lab">日期<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <input className="input" type="number" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="公斤" />
      <button className="primary" disabled={!kg || !date} onClick={() => onSave({ date, kg: Number(kg) })}>
        {initial ? "儲存修改" : "記下體重"}
      </button>
    </>
  );
}

const TEMP_LO = 37.5, TEMP_HI = 39.2; // 犬隻正常肛溫範圍（僅顯示提示，不影響任何數值）
function TempForm({ med, initial, onSave }) {
  const last = med.temps?.[med.temps.length - 1];
  const [c, setC] = useState(initial?.c ?? "");
  const [date, setDate] = useState(initial?.date || today());
  return (
    <>
      {!initial && (
        <p className="formHint">
          {last ? `上次 ${last.c}°C（${last.date}）。` : ""}狗狗正常體溫約 {TEMP_LO}–{TEMP_HI}°C。
        </p>
      )}
      <label className="lab">日期<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <input className="input" type="number" step="0.1" value={c} onChange={(e) => setC(e.target.value)} placeholder="°C，例如 38.5" />
      <button className="primary" disabled={!c || !date} onClick={() => onSave({ date, c: Number(c) })}>
        {initial ? "儲存修改" : "記下體溫"}
      </button>
    </>
  );
}

/** 名稱＋時間的簡單日誌表單（餵藥／營養品共用） */
/** 每日健康狀態：常見狀況一鍵選，或自訂文字。純紀錄，不影響任何遊戲數值。 */
function CondForm({ onSubmit }) {
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [at, setAt] = useState("");
  return (
    <>
      <p className="formHint">記今天的整體狀況；異常時的細節寫在備註，回診給獸醫看很有用。</p>
      <Row>
        {["正常", "皮膚搔癢", "食慾不振", "精神不佳", "嘔吐", "咳嗽"].map((s) => (
          <button key={s} className="opt"
            onClick={() => onSubmit({ type: "cond", val: s, note, ts: pickTs(at) })}>{s}</button>
        ))}
      </Row>
      <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)}
        placeholder="其他狀況（自訂），例如 走路跛腳" />
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="補充說明（選填）" />
      <TimePick value={at} onChange={setAt} />
      {custom.trim() && (
        <button className="primary"
          onClick={() => onSubmit({ type: "cond", val: custom.trim(), note, ts: pickTs(at) })}>
          記下「{custom.trim()}」
        </button>
      )}
    </>
  );
}

/** 主畫面「健康」快捷鍵：狀態／體重／體溫／餵藥／營養品／疫苗驅蟲／就診 一次到位 */
/* ============ 分頁：今天 ============ */
const ENTRY_OPTS = {
  meal: ["早餐", "午餐", "晚餐", "點心"],
  potty: ["尿尿", "正常", "偏軟", "偏硬", "腹瀉", "有血"],
  care: ["洗澡", "剪指甲", "刷牙", "清耳朵", "梳毛"],
};

function EntryEditForm({ l, onSave }) {
  const [val, setVal] = useState(String(l.val ?? ""));
  const [note, setNote] = useState(l.note || "");
  const [at, setAt] = useState(tsToLocalInput(l.ts));
  const fixedVal = l.type === "train"; // 改技能會讓輪數對不上，只開放改時間

  return (
    <div className="inlineForm">
      {fixedVal && <p className="formHint">訓練紀錄只能改時間（技能輪數不受影響）。</p>}
      {ENTRY_OPTS[l.type] && (
        <Row>
          {ENTRY_OPTS[l.type].map((o) => (
            <button key={o} className={val === o ? "opt on" : "opt"} onClick={() => setVal(o)}>{o}</button>
          ))}
        </Row>
      )}
      {l.type === "walk" && (
        <input className="input" type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder="分鐘" />
      )}
      {(l.type === "med" || l.type === "supp" || l.type === "cond") && (
        <input className="input" value={val} onChange={(e) => setVal(e.target.value)}
          placeholder={l.type === "cond" ? "狀況描述" : "名稱與劑量"} />
      )}
      {!fixedVal && (
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="備註（選填）" />
      )}
      <label className="lab">時間
        <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <button className="primary"
        disabled={!fixedVal && ((l.type === "walk" && !(Number(val) > 0)) || ((l.type === "med" || l.type === "supp" || l.type === "cond") && !val.trim()))}
        onClick={() => onSave({
          ...(fixedVal ? {} : { val: l.type === "walk" ? Number(val) : val.trim ? val.trim() : val, note }),
          ts: at ? new Date(at).getTime() : l.ts,
        })}>儲存修改</button>
    </div>
  );
}

function EntryRow({ l, onDelete, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const askDelete = () => {
    if (confirmDel) { onDelete(l.id); return; }
    setConfirmDel(true);
    setTimeout(() => setConfirmDel(false), 2500); // 沒接著點就自動還原
  };
  return (
    <>
      <div className="entry">
        <span className="entryIcon">{TYPE_META[l.type]?.icon}</span>
        <span className="entryTime">
          {new Date(l.ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="entryBody">
          {recTitle(l)}
          {recSub(l) ? <small> · {recSub(l)}</small> : null}
        </span>
        <span className="entryBy">{l.by}</span>
        {onEdit && <button className="del" title="修改" onClick={() => setEditing(!editing)}>✎</button>}
        {onDelete && (
          <button className={confirmDel ? "del confirm" : "del"} onClick={askDelete} aria-label="刪除">
            {confirmDel ? "確定?" : "×"}
          </button>
        )}
      </div>
      {editing && onEdit && (
        <EntryEditForm l={l} onSave={async (patch) => { await onEdit(l.id, patch); setEditing(false); }} />
      )}
    </>
  );
}

/* ============ 病歷匯入 ============ */
const IMPORT_TYPES = {
  vax: {
    label: "疫苗/驅蟲",
    hint: "每行一筆：名稱, 日期, 週期天數",
    example: "八合一疫苗, 2024-06-01, 365",
  },
  visit: {
    label: "就診",
    hint: "每行一筆：日期, 醫院, 主訴, 用藥（選填）",
    example: "2024-03-02, 大安動物醫院, 皮膚過敏, 類固醇藥膏",
  },
  weight: {
    label: "體重",
    hint: "每行一筆：日期, 公斤",
    example: "2024-05-01, 12.3",
  },
};

/** 接受 2024-06-01 / 2024/6/1 / 2024.6.1，統一成 YYYY-MM-DD；無效回傳 null。 */
function normDate(s) {
  const m = String(s).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 解析匯入文字。回傳 { rows, errors }；rows 已含 dup 標記。 */
function parseImport(type, text, med) {
  const dupKeys = new Set(
    type === "vax" ? (med.vax || []).map((v) => `${v.name}|${v.date}`)
    : type === "visit" ? (med.visits || []).map((v) => `${v.date}|${v.reason}`)
    : (med.weights || []).map((w) => `${w.date}|${w.kg}`)
  );
  const rows = [], errors = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[,，\t]/).map((p) => p.trim());
    const err = (msg) => errors.push({ line: i + 1, msg, raw: line });

    if (type === "vax") {
      const [name, dateRaw, cycleRaw] = parts;
      const date = normDate(dateRaw || "");
      const cycleDays = Number(cycleRaw);
      if (!name || !date || !cycleRaw || !Number.isFinite(cycleDays) || cycleDays <= 0)
        return err("格式：名稱, 日期, 週期天數");
      rows.push({ name, date, cycleDays, dup: dupKeys.has(`${name}|${date}`) });
    } else if (type === "visit") {
      const [dateRaw, clinic, reason, medNote] = parts;
      const date = normDate(dateRaw || "");
      if (!date || !reason) return err("格式：日期, 醫院, 主訴, 用藥（選填）");
      rows.push({ date, clinic: clinic || "", reason, med: medNote || "", dup: dupKeys.has(`${date}|${reason}`) });
    } else {
      const [dateRaw, kgRaw] = parts;
      const date = normDate(dateRaw || "");
      const kg = Number(kgRaw);
      if (!date || !Number.isFinite(kg) || kg <= 0) return err("格式：日期, 公斤");
      rows.push({ date, kg, dup: dupKeys.has(`${date}|${kg}`) });
    }
  });
  return { rows, errors };
}

function ImportForm({ med, onImport }) {
  const [type, setType] = useState("vax");
  const [text, setText] = useState("");
  const meta = IMPORT_TYPES[type];
  const { rows, errors } = useMemo(() => parseImport(type, text, med), [type, text, med]);
  const fresh = rows.filter((r) => !r.dup);
  const dups = rows.length - fresh.length;

  return (
    <div className="inlineForm">
      <Row>
        {Object.entries(IMPORT_TYPES).map(([k, m]) => (
          <button key={k} className={type === k ? "opt on" : "opt"}
            onClick={() => { setType(k); setText(""); }}>{m.label}</button>
        ))}
      </Row>
      <p className="formHint">{meta.hint}<br />例：{meta.example}</p>
      <textarea className="input importBox" rows={5} value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={meta.example} />
      {errors.map((e) => (
        <p key={e.line} className="importErr">第 {e.line} 行「{e.raw}」看不懂 —— {e.msg}</p>
      ))}
      {rows.length > 0 && (
        <div className="importPreview">
          {rows.map((r, i) => (
            <div key={i} className={r.dup ? "importRow dup" : "importRow"}>
              {type === "vax" && <>「{r.name}」 {r.date} · 每 {r.cycleDays} 天</>}
              {type === "visit" && <>{r.date} {r.clinic} — {r.reason}{r.med ? `（${r.med}）` : ""}</>}
              {type === "weight" && <>{r.date} · {r.kg} kg</>}
              {r.dup && <small> 已存在，會略過</small>}
            </div>
          ))}
        </div>
      )}
      <button className="primary" disabled={!fresh.length || errors.length > 0}
        onClick={() => { onImport(type, fresh); setText(""); }}>
        匯入 {fresh.length} 筆{dups > 0 ? `（略過重複 ${dups} 筆）` : ""}
      </button>
    </div>
  );
}

/* ============ 分頁：健康 ============ */
function HealthView({ med, prof, onSave, onAddLog }) {
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null); // { kind, item }
  const vax = (med.vax || []).map((v) => {
    const due = new Date(new Date(v.date).getTime() + v.cycleDays * 86400000);
    return { ...v, due: dayKey(due), left: daysBetween(Date.now(), due) };
  }).sort((a, b) => a.left - b.left);

  const weights = (med.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const temps = (med.temps || []).slice().sort((a, b) => b.date.localeCompare(a.date));

  // 依 id 就地取代（修改用）
  const replaceIn = async (arrName, item) => {
    await onSave({ ...med, [arrName]: (med[arrName] || []).map((x) => (x.id === item.id ? item : x)) });
    setEditing(null);
  };
  const editBtn = (kind, item) => (
    <button className="del" title="修改" onClick={() => setEditing(editing?.item?.id === item.id ? null : { kind, item })}>✎</button>
  );

  const doImport = (type, rows) => {
    if (type === "vax")
      onSave({ ...med, vax: [...(med.vax || []), ...rows.map((r) => ({ id: uid(), name: r.name, date: r.date, cycleDays: r.cycleDays }))] });
    else if (type === "visit")
      onSave({ ...med, visits: [...rows.map((r) => ({ id: uid(), date: r.date, clinic: r.clinic, reason: r.reason, med: r.med })), ...(med.visits || [])] });
    else
      onSave({ ...med, weights: [...(med.weights || []), ...rows.map((r) => ({ id: uid(), date: r.date, kg: r.kg }))] });
    setForm(null);
  };

  return (
    <div className="health">
      <div className="secHead">
        <h2 className="dayHead">病歷匯入</h2>
        <button className="mini" onClick={() => setForm(form === "import" ? null : "import")}>
          {form === "import" ? "收起" : "批次匯入"}
        </button>
      </div>
      {form === "import" && <ImportForm med={med} onImport={doImport} />}

      <div className="secHead">
        <h2 className="dayHead">每日狀態</h2>
        <button className="mini" onClick={() => setForm(form === "cond" ? null : "cond")}>＋ 記錄</button>
      </div>
      {form === "cond" && (
        <div className="inlineForm">
          <CondForm onSubmit={(e) => { onAddLog(e); setForm(null); }} />
        </div>
      )}

      <div className="secHead">
        <h2 className="dayHead">疫苗與驅蟲</h2>
        <button className="mini" onClick={() => setForm(form === "vax" ? null : "vax")}>＋ 新增</button>
      </div>
      {form === "vax" && <VaxForm onAdd={(v) => { onSave({ ...med, vax: [...(med.vax || []), v] }); setForm(null); }} />}
      {!vax.length && <Empty text="把手上的疫苗紀錄補進來，之後會自動倒數。" />}
      {vax.map((v) => (
        <React.Fragment key={v.id}>
          <div className={v.left < 0 ? "vax over" : v.left < 30 ? "vax soon" : "vax"}>
            <div><b>{v.name}</b><small> 上次 {v.date}</small></div>
            <div className="vaxRight">
              <span className="vaxDue">{v.due}</span>
              <span className="vaxLeft">{v.left < 0 ? `逾期 ${-v.left} 天` : `還有 ${v.left} 天`}</span>
            </div>
            {editBtn("vax", v)}
            <button className="del" onClick={() => onSave({ ...med, vax: med.vax.filter((x) => x.id !== v.id) })}>×</button>
          </div>
          {editing?.kind === "vax" && editing.item.id === v.id && (
            <VaxForm initial={editing.item} onAdd={(nv) => replaceIn("vax", nv)} />
          )}
        </React.Fragment>
      ))}

      <div className="secHead">
        <h2 className="dayHead">體重曲線</h2>
        <button className="mini" onClick={() => setForm(form === "weight" ? null : "weight")}>＋ 新增</button>
      </div>
      {form === "weight" && (
        <div className="inlineForm">
          <WeightForm med={med} onSave={async (w) => {
            await onSave({ ...med, weights: [...(med.weights || []), { id: uid(), ...w }] });
            setForm(null);
          }} />
        </div>
      )}
      {weights.length < 2 ? <Empty text="記滿兩筆體重就會畫出曲線。" /> : (
        <WeightChart data={weights} goal={prof?.goalKg} />
      )}
      {weights.slice(-6).reverse().map((w) => (
        <React.Fragment key={w.id}>
          <div className="mrow">
            <b>{w.date}</b><span>{w.kg} kg</span>
            <span className="mrowSpace" />
            {editBtn("weight", w)}
            <button className="del" onClick={() => onSave({ ...med, weights: med.weights.filter((x) => x.id !== w.id) })}>×</button>
          </div>
          {editing?.kind === "weight" && editing.item.id === w.id && (
            <div className="inlineForm">
              <WeightForm med={med} initial={editing.item}
                onSave={(nw) => replaceIn("weights", { id: w.id, ...nw })} />
            </div>
          )}
        </React.Fragment>
      ))}

      <div className="secHead">
        <h2 className="dayHead">體溫</h2>
        <button className="mini" onClick={() => setForm(form === "temp" ? null : "temp")}>＋ 新增</button>
      </div>
      {form === "temp" && (
        <div className="inlineForm">
          <TempForm med={med} onSave={async (t) => {
            await onSave({ ...med, temps: [...(med.temps || []), { id: uid(), ...t }] });
            setForm(null);
          }} />
        </div>
      )}
      {!temps.length && <Empty text="還沒有體溫紀錄。" />}
      {temps.slice(0, 8).map((t) => (
        <React.Fragment key={t.id}>
          <div className="mrow">
            <b>{t.date}</b>
            <span className={t.c < TEMP_LO || t.c > TEMP_HI ? "tempBad" : ""}>
              {t.c}°C{(t.c < TEMP_LO || t.c > TEMP_HI) ? "（超出正常範圍）" : ""}
            </span>
            <span className="mrowSpace" />
            {editBtn("temp", t)}
            <button className="del" onClick={() => onSave({ ...med, temps: med.temps.filter((x) => x.id !== t.id) })}>×</button>
          </div>
          {editing?.kind === "temp" && editing.item.id === t.id && (
            <div className="inlineForm">
              <TempForm med={med} initial={editing.item}
                onSave={(nt) => replaceIn("temps", { id: t.id, ...nt })} />
            </div>
          )}
        </React.Fragment>
      ))}

      <div className="secHead">
        <h2 className="dayHead">就診紀錄</h2>
        <button className="mini" onClick={() => setForm(form === "visit" ? null : "visit")}>＋ 新增</button>
      </div>
      {form === "visit" && <VisitForm onAdd={(v) => { onSave({ ...med, visits: [v, ...(med.visits || [])] }); setForm(null); }} />}
      {(med.visits || []).map((v) => (
        <React.Fragment key={v.id}>
          <div className="visit">
            <b>{v.date}</b> <span>{v.clinic}</span>
            <p>{v.reason}</p>
            {v.med && <p className="visitMed">用藥：{v.med}</p>}
            <span className="visitOps">
              {editBtn("visit", v)}
              <button className="del" onClick={() => onSave({ ...med, visits: med.visits.filter((x) => x.id !== v.id) })}>×</button>
            </span>
          </div>
          {editing?.kind === "visit" && editing.item.id === v.id && (
            <VisitForm initial={editing.item} onAdd={(nv) => replaceIn("visits", nv)} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function VaxForm({ onAdd, initial }) {
  const [f, setF] = useState(
    initial ? { name: initial.name, date: initial.date, cycleDays: initial.cycleDays }
            : { name: "", date: today(), cycleDays: 365 }
  );
  return (
    <div className="inlineForm">
      <Row>
        {[["八合一疫苗", 365], ["狂犬病", 365], ["體內驅蟲", 90], ["體外驅蟲", 30], ["心絲蟲預防", 30]].map(([n, c]) => (
          <button key={n} className={f.name === n ? "opt on" : "opt"} onClick={() => setF({ ...f, name: n, cycleDays: c })}>{n}</button>
        ))}
      </Row>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="項目名稱" />
      <label className="lab">施打／使用日<input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className="lab">週期（天）<input className="input" type="number" value={f.cycleDays} onChange={(e) => setF({ ...f, cycleDays: Number(e.target.value) })} /></label>
      <button className="primary" disabled={!f.name} onClick={() => onAdd({ id: initial?.id || uid(), ...f })}>
        {initial ? "儲存修改" : "加入"}
      </button>
    </div>
  );
}

function VisitForm({ onAdd, initial }) {
  const [f, setF] = useState(
    initial ? { date: initial.date, clinic: initial.clinic, reason: initial.reason, med: initial.med }
            : { date: today(), clinic: "", reason: "", med: "" }
  );
  return (
    <div className="inlineForm">
      <label className="lab">日期<input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <input className="input" value={f.clinic} onChange={(e) => setF({ ...f, clinic: e.target.value })} placeholder="醫院名稱" />
      <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="主訴／診斷" />
      <input className="input" value={f.med} onChange={(e) => setF({ ...f, med: e.target.value })} placeholder="用藥與劑量（選填）" />
      <button className="primary" disabled={!f.reason} onClick={() => onAdd({ id: initial?.id || uid(), ...f })}>
        {initial ? "儲存修改" : "加入"}
      </button>
    </div>
  );
}

function WeightChart({ data, goal }) {
  const W = 320, H = 130, P = 26;
  const ks = data.map((d) => d.kg);
  const lo = Math.min(...ks, goal || Infinity) - 0.5;
  const hi = Math.max(...ks, goal || -Infinity) + 0.5;
  const x = (i) => P + (i / Math.max(1, data.length - 1)) * (W - P * 2);
  const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - P * 2);
  const pts = data.map((d, i) => `${x(i)},${y(d.kg)}`).join(" ");
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {goal && (
          <>
            <line x1={P} x2={W - P} y1={y(goal)} y2={y(goal)} className="goalLine" />
            <text x={W - P} y={y(goal) - 5} className="goalText" textAnchor="end">目標 {goal}kg</text>
          </>
        )}
        <polyline points={pts} className="wline" />
        {data.map((d, i) => <circle key={d.id} cx={x(i)} cy={y(d.kg)} r="3.5" className="wdot" />)}
        <text x={P} y={H - 6} className="axis">{data[0].date.slice(5)}</text>
        <text x={W - P} y={H - 6} className="axis" textAnchor="end">{data[data.length - 1].date.slice(5)}</text>
      </svg>
      <p className="chartNow">目前 {data[data.length - 1].kg} kg</p>
    </div>
  );
}

/* ============ 分頁：月曆印章 ============ */
function CalendarView({ logs, onDelete, onEdit }) {
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState(null); // 'YYYY-MM-DD'，點日期展開該日紀錄
  const [monthRows, setMonthRows] = useState(null); // 伺服器歸檔的當月資料；null = 用熱資料頂著
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + offset);
  const year = base.getFullYear(), month = base.getMonth();
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();

  // 月曆改吃伺服器歸檔：不受 800 筆上限影響，再舊的月份都查得到
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const from = new Date(year, month, 1).getTime();
        const to = new Date(year, month + 1, 1).getTime() - 1;
        const rows = await storage.history(from, to);
        if (!stop) setMonthRows(rows);
      } catch { if (!stop) setMonthRows(null); /* 離線時退回熱資料 */ }
    })();
    return () => { stop = true; };
  }, [year, month, logs]);

  // 該月每日溫濕度（Open-Meteo 歷史資料，點日期時顯示）
  const [wxDays, setWxDays] = useState(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      const lastDay = new Date(year, month + 1, 0).getDate();
      const w = await storage.weatherDaily(
        `${year}-${pad2(month + 1)}-01`,
        `${year}-${pad2(month + 1)}-${pad2(lastDay)}`
      );
      if (!stop) setWxDays(w?.days || null);
    })();
    return () => { stop = true; };
  }, [year, month]);

  const source = monthRows ?? logs;
  const hotIds = useMemo(() => new Set(logs.map((l) => l.id)), [logs]);

  const byDay = useMemo(() => {
    const m = {};
    source.forEach((l) => {
      const d = dayKey(l.ts);
      (m[d] = m[d] || new Set()).add(l.type);
    });
    return m;
  }, [source]);

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const full = cells.filter((d) => d && (byDay[dayKey(new Date(year, month, d))]?.size || 0) >= 3).length;

  const selLogs = sel ? source.filter((l) => dayKey(l.ts) === sel) : [];

  return (
    <div className="cal">
      <div className="calHead">
        <button className="mini" onClick={() => { setOffset(offset - 1); setSel(null); }}>‹</button>
        <b>{year} 年 {month + 1} 月</b>
        <button className="mini" onClick={() => { setOffset(offset + 1); setSel(null); }} disabled={offset >= 0}>›</button>
      </div>
      <div className="calGrid">
        {["日", "一", "二", "三", "四", "五", "六"].map((w) => <span key={w} className="wd">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="cell" />;
          const key = dayKey(new Date(year, month, d));
          const n = byDay[key]?.size || 0;
          const cls = [
            "cell",
            n >= 3 ? "stamp full" : n > 0 ? "stamp part" : "",
            sel === key ? "selDay" : "",
          ].join(" ").trim();
          return (
            <button key={i} className={cls} onClick={() => setSel(sel === key ? null : key)}>
              <i>{d}</i>
            </button>
          );
        })}
      </div>
      {sel && (
        <section className="calDayList">
          <h2 className="dayHead">{sel === today() ? "今天" : sel} · {selLogs.length} 筆</h2>
          {wxDays?.[sel] && (
            <p className="calWx">
              📍 板橋 {Math.round(wxDays[sel].tmin)}–{Math.round(wxDays[sel].tmax)}°C
              {wxDays[sel].h != null ? ` ・ 濕度均 ${Math.round(wxDays[sel].h)}%` : ""}
            </p>
          )}
          {selLogs.length
            ? selLogs.map((l) => (
                <EntryRow key={l.id} l={l}
                  onDelete={hotIds.has(l.id) ? onDelete : null}
                  onEdit={hotIds.has(l.id) ? onEdit : null} />
              ))
            : <p className="empty">這天沒有紀錄。</p>}
        </section>
      )}
      <p className="calFoot">
        本月蓋了 <b>{full}</b> 個實心爪印（一天記滿 3 類就算）。淺色是有記但未滿 3 類。
        點日期可查看該天的紀錄。
      </p>
    </div>
  );
}

function Empty({ text }) { return <p className="empty">{text}</p>; }

function Sheet({ title, children, onClose }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="sheetBack" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetHead"><b>{title}</b><button className="del" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

/* ============ 樣式 ============ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Caprasimo&family=DotGothic16&family=Figtree:wght@400;600;700&family=Noto+Sans+TC:wght@400;500;600;700&display=swap');

html, body{margin:0; padding:0; background:#171310;}

.root{
  --bg:#221c15; --out:#171310; --card:#2e261d; --raise:#3a3126; --inputbg:#221c15;
  --tx:#f5ead8; --tx2:#b8a88f; --tx3:#8f8271; --tx4:#7d715f;
  --acc:#c67139; --accHov:#d5803f; --accDn:#a85c2c; --accLt:#e5b58f;
  --sage:#7a8a5e; --sageLt:#c3d1a4; --line:rgba(245,234,216,.08); --ink:#c3d1a4;
  min-height:100vh; background:var(--out);
  font-family:'Figtree','Noto Sans TC',system-ui,sans-serif; color:var(--tx);
  display:flex; justify-content:center; -webkit-tap-highlight-color:transparent;
}
.frame{width:100%; max-width:430px; background:var(--bg); min-height:100vh;
  padding:0 22px 110px; box-sizing:border-box; position:relative;}
.root :where(button){border:none; background:none; color:inherit; cursor:pointer; padding:0; font-family:inherit;}
.root *:focus-visible{outline:2px solid var(--acc); outline-offset:2px;}
.loading{color:var(--tx2); text-align:center; padding:60px 0; font-family:'DotGothic16',monospace;}

/* 頭部列 */
.top{padding-top:24px; display:flex; align-items:center; gap:14px;}
.avatarBtn{width:64px; height:64px; border-radius:50%; flex:none; overflow:hidden;
  box-shadow:0 0 0 3px var(--bg), 0 0 0 6px var(--sage); background:rgba(122,138,94,.25);}
.avatarImg{width:100%; height:100%; object-fit:cover; display:block;}
.avatarFallback{display:grid; place-items:center; width:100%; height:100%; padding:9px; box-sizing:border-box;}
.who{flex:1; min-width:0;}
.petName{font-family:'Caprasimo',serif; font-size:24px; color:var(--tx); letter-spacing:1px;}
.petAge{font-size:12px; color:var(--tx2); margin-top:2px;}
.pills{display:flex; flex-direction:column; gap:5px; align-items:flex-end;}
.pill{font-family:'DotGothic16',monospace; font-size:11px; padding:4px 10px; border-radius:999px; white-space:nowrap;}
.pill.day{color:var(--accLt); background:rgba(198,113,57,.18);}
.pill.streak{color:var(--sageLt); background:rgba(122,138,94,.22);}

/* 狀態卡 */
.statusCard{margin-top:16px; background:var(--card); border-radius:22px; padding:14px 16px;}
.essentials{display:flex; justify-content:space-between; text-align:center;}
.essentials>div{flex:1; display:flex; flex-direction:column; gap:3px;}
.esLabel{font-size:11px; color:var(--tx2);}
.esVal{font-size:16px; font-weight:700; color:var(--tx);}
.wxLine{margin-top:12px; padding-top:10px; border-top:1px solid var(--line);
  display:flex; align-items:center; justify-content:center; gap:6px; font-size:12.5px; color:var(--tx2);}
.wxLine.hot{color:var(--accLt); font-weight:600;}

/* 分頁列 */
.tabRow{margin-top:18px; display:flex; justify-content:space-between; align-items:baseline;}
.tabName{font-family:'Caprasimo',serif; font-size:16px; color:var(--tx);}
.tabCount{font-family:'DotGothic16',monospace; color:var(--acc);}
.tabPills{display:flex; gap:6px;}
.tabPill{white-space:nowrap; font-size:12.5px; padding:5px 10px; border-radius:999px; color:var(--tx3);}
.tabPill:hover{background:rgba(198,113,57,.18);}
.tabPill.on{font-weight:700; color:var(--bg); background:var(--acc);}
.tabPill.on:hover{background:var(--acc);}

.content{margin-top:12px; display:flex; flex-direction:column; gap:14px;}

/* 今天：時間群組列表 */
.tTime{font-family:'DotGothic16',monospace; font-size:11px; color:var(--tx3); margin:0 0 6px 4px;}
.tCard{background:var(--card); border-radius:18px; overflow:hidden;}
.lrow{display:flex; gap:11px; align-items:center; padding:11px 14px;
  border-bottom:1px solid rgba(245,234,216,.06); cursor:pointer;
  user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; touch-action:pan-y;}
.lrow *{user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;}
.lrow:last-child{border-bottom:none;}
.lrow:hover{background:rgba(245,234,216,.04);}
.lrow:active{background:rgba(245,234,216,.07);}
.lIcon{width:32px; height:32px; border-radius:50%; background:rgba(122,138,94,.18);
  display:grid; place-items:center; font-size:15px; flex:none; pointer-events:none;}
.lBody{flex:1; min-width:0; pointer-events:none;}
.lTitle{font-size:13.5px; font-weight:600; color:var(--tx);}
.lSub{font-size:11.5px; color:var(--tx2); margin-top:1px;}
.lBy{font-size:10px; color:var(--tx4); pointer-events:none;}
.pressHint{text-align:center; font-size:10.5px; color:var(--tx4);}

/* 底部快速記錄列 */
.actionBarWrap{position:fixed; bottom:0; left:50%; transform:translateX(-50%);
  width:100%; max-width:430px; padding:14px 18px 16px; box-sizing:border-box; z-index:30;
  background:linear-gradient(180deg, rgba(34,28,21,0), #221c15 40%);}
.actionBar{background:var(--raise); border-radius:999px; padding:8px 10px;
  display:flex; justify-content:space-between; box-shadow:0 10px 28px rgba(0,0,0,.45);}
.actionBtn{display:flex; flex-direction:column; align-items:center; gap:1px;
  padding:5px 9px; border-radius:999px; transition:transform .08s;}
.actionBtn:hover{background:rgba(198,113,57,.25);}
.actionBtn:active{background:rgba(198,113,57,.4); transform:scale(.94);}
.aIcon{font-size:18px; pointer-events:none;}
.aLabel{font-size:9.5px; color:#d8c9ad; pointer-events:none;}

/* 長壓選單 */
.menuBack{position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:40; display:grid; place-items:center;
  user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;}
.menuBack *{user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;}
.menuCard{width:270px; background:var(--card); border-radius:22px; padding:18px; animation:popIn .16s ease-out;}
@keyframes popIn{from{opacity:0; transform:scale(.94)} to{opacity:1; transform:scale(1)}}
.menuHead{display:flex; align-items:center; gap:10px; margin-bottom:14px;}
.menuIcon{width:34px; height:34px; border-radius:50%; background:rgba(122,138,94,.18);
  display:grid; place-items:center; font-size:16px;}
.menuTitle{font-size:14px; font-weight:600; color:var(--tx);}
.menuActs{display:flex; flex-direction:column; gap:8px;}
.menuEdit{text-align:center; padding:11px 0; border-radius:999px; background:rgba(245,234,216,.08);
  color:var(--tx); font-size:13.5px; font-weight:600;}
.menuEdit:hover{background:rgba(245,234,216,.14);}
.menuDel{text-align:center; padding:11px 0; border-radius:999px; background:rgba(192,81,47,.2);
  color:#e5967a; font-size:13.5px; font-weight:600;}
.menuDel:hover{background:rgba(192,81,47,.32);}
.menuDel.confirm{background:#c0512f; color:#f5ead8; font-weight:700;}
.del.confirm{color:#e5967a; font-weight:700; font-size:12px;}
.menuCancel{text-align:center; padding:9px 0; color:var(--tx3); font-size:12.5px;}

/* 快速記錄面板 */
.qsWrap{position:fixed; inset:0; z-index:50;}
.qsBack{position:absolute; inset:0; background:rgba(0,0,0,.55);}
.qsPanel{position:absolute; left:50%; transform:translateX(-50%); bottom:0; width:100%; max-width:430px;
  box-sizing:border-box; background:var(--card); border-radius:28px 28px 0 0; padding:18px 22px 24px;
  box-shadow:0 -12px 40px rgba(0,0,0,.5); animation:sheetUp .22s ease-out; max-height:86vh; overflow-y:auto;}
@keyframes sheetUp{from{transform:translate(-50%,100%)} to{transform:translate(-50%,0)}}
.qsHandle{width:40px; height:4px; border-radius:2px; background:rgba(245,234,216,.2); margin:0 auto 16px;}
.qsHead{display:flex; align-items:center; gap:10px; margin-bottom:16px;}
.qsIcon{width:38px; height:38px; border-radius:50%; background:rgba(198,113,57,.2);
  display:grid; place-items:center; font-size:18px;}
.qsTitle{font-family:'Caprasimo',serif; font-size:19px; color:var(--tx);}
.qsNow{margin-left:auto; font-family:'DotGothic16',monospace; font-size:11px; color:var(--tx2);}
.qsField{font-size:12px; color:var(--tx2); margin-bottom:7px;}
.qsSegRow{display:flex; gap:7px; margin-bottom:15px;}
.qsSeg{white-space:nowrap; flex:1; text-align:center; padding:9px 0; border-radius:999px;
  font-size:13px; background:rgba(245,234,216,.08); color:var(--tx2);}
.qsSeg:hover{opacity:.85;}
.qsSeg.on{background:var(--sage); color:var(--bg); font-weight:700;}
.qsChipRow{display:flex; flex-wrap:wrap; gap:7px; margin-bottom:15px;}
.qsChip{white-space:nowrap; padding:7px 14px; border-radius:999px; font-size:12.5px;
  color:var(--tx2); border:1px solid rgba(245,234,216,.15);}
.qsChip:hover{opacity:.85;}
.qsChip.on{background:rgba(198,113,57,.25); color:var(--accLt); border-color:rgba(198,113,57,.5);}
.qsNote{width:100%; box-sizing:border-box; background:var(--inputbg); border:none; outline:none;
  border-radius:16px; padding:12px 14px; font-size:13.5px; color:var(--tx); margin-bottom:14px; font-family:inherit;}
.qsNote:focus{box-shadow:0 0 0 2px var(--acc);}
.qsNote::placeholder{color:var(--tx3);}
.qsTimeInput{color-scheme:dark; margin-bottom:18px; min-height:44px; line-height:20px;
  appearance:none; -webkit-appearance:none; display:block;}
.qsSave{width:100%; text-align:center; padding:13px 0; border-radius:999px;
  background:var(--acc); color:var(--bg); font-size:14px; font-weight:700;}
.qsSave:hover{background:var(--accHov);}
.qsSave:active{background:var(--accDn);}

/* Toast */
.toast{white-space:nowrap; position:fixed; bottom:96px; left:50%; transform:translateX(-50%);
  background:var(--sage); color:var(--bg); font-size:13px; font-weight:700; padding:9px 18px;
  border-radius:999px; z-index:60; animation:toastIn .2s ease-out; box-shadow:0 8px 20px rgba(0,0,0,.4);}
@keyframes toastIn{from{opacity:0; transform:translate(-50%,10px)} to{opacity:1; transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){.qsPanel,.menuCard,.sheet,.toast{animation:none}}

/* ===== 通用表單元素（設定/健康/月曆共用） ===== */
.setup{background:var(--card); border-radius:22px; padding:22px; margin-top:40px;}
.setupTitle{font-family:'Caprasimo',serif; font-size:19px; margin:0 0 6px; color:var(--tx);}
.setupHint{font-size:13px; color:var(--tx2); line-height:1.7; margin:0 0 16px;}
.input{width:100%; box-sizing:border-box; background:var(--inputbg); border:1px solid rgba(245,234,216,.1);
  border-radius:14px; padding:11px 13px; font-size:14px; font-family:inherit; margin-bottom:9px;
  color:var(--tx); color-scheme:dark;}
.input:focus{outline:none; box-shadow:0 0 0 2px var(--acc);}
.input::placeholder{color:var(--tx3);}
.primary{width:100%; background:var(--acc); color:var(--bg); border-radius:999px; padding:13px;
  font-size:14px; font-weight:700;}
.primary:hover{background:var(--accHov);}
.primary:active{background:var(--accDn);}
.primary:disabled{opacity:.4;}
.ghost{width:100%; background:rgba(245,234,216,.08); color:var(--tx2); border-radius:999px;
  padding:11px; font-size:13px; margin-top:8px;}
.lab{display:block; font-size:12px; color:var(--tx2); margin-bottom:2px;}
.formHint{font-size:12px; color:var(--tx2); margin:0 0 10px; line-height:1.6;}
.inlineForm{background:var(--card); border-radius:18px; padding:12px; margin-bottom:10px;}
.sheet .inlineForm{background:var(--inputbg);}
.row{display:flex; flex-wrap:wrap; gap:7px; margin-bottom:10px;}
.opt{background:rgba(245,234,216,.08); border:1px solid transparent; border-radius:999px;
  padding:9px 13px; font-size:13px; color:var(--tx2);}
.opt.on{background:var(--sage); color:var(--bg); font-weight:700;}
.opt small{color:inherit; opacity:.7; font-size:10px;}
.mini{background:rgba(198,113,57,.18); color:var(--accLt); border-radius:999px; padding:5px 12px;
  font-size:12px; font-weight:700;}
.mini:hover{background:rgba(198,113,57,.3);}
.mini:disabled{opacity:.35;}
.del{color:var(--tx3); font-size:16px; line-height:1; padding:0 4px;}
.dayHead{font-family:'DotGothic16',monospace; font-size:11px; color:var(--tx3);
  margin:16px 0 8px; letter-spacing:.04em;}
section:first-child .dayHead{margin-top:0;}
.secHead{display:flex; align-items:center; justify-content:space-between;}
.empty{font-size:13px; color:var(--tx2); text-align:center; padding:24px 14px; line-height:1.7;
  background:var(--card); border-radius:18px;}

/* 設定面板（Sheet 元件） */
.sheetBack{position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex;
  align-items:flex-end; justify-content:center; z-index:50;}
.sheet{background:var(--card); width:100%; max-width:430px; border-radius:28px 28px 0 0;
  padding:16px 22px 24px; animation:sheetUp2 .22s ease-out; max-height:88vh; overflow-y:auto;
  box-shadow:0 -12px 40px rgba(0,0,0,.5); box-sizing:border-box;}
@keyframes sheetUp2{from{transform:translateY(40px); opacity:0} to{transform:none; opacity:1}}
.sheetHead{display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;
  font-family:'Caprasimo',serif; font-size:17px; color:var(--tx);}
.sheetHead .del{font-size:20px;}

/* 健康 */
.vax{display:flex; align-items:center; gap:8px; background:var(--card); border-radius:18px;
  padding:11px 12px; margin-bottom:7px; font-size:13px;}
.vax small{color:var(--tx2); font-size:11px;}
.vaxRight{margin-left:auto; text-align:right;}
.vaxDue{display:block; font-family:'DotGothic16',monospace; font-size:10px; color:var(--tx3);}
.vaxLeft{font-size:12px; font-weight:700; color:var(--tx);}
.vax.soon .vaxLeft{color:var(--accLt);}
.vax.over{background:rgba(192,81,47,.16);}
.vax.over .vaxLeft{color:#e5967a;}
.visit{background:var(--card); border-radius:18px; padding:11px 12px; margin-bottom:7px;
  font-size:13px; position:relative; color:var(--tx);}
.visitOps{position:absolute; top:8px; right:8px; display:flex; gap:2px;}
.visit p{margin:4px 0 0; color:var(--tx2);}
.visitMed{color:var(--tx3); font-size:12px;}
.mrow{display:flex; align-items:center; gap:10px; background:var(--card); border-radius:18px;
  padding:10px 12px; margin-bottom:6px; font-size:13px; color:var(--tx);}
.mrowSpace{flex:1;}
.tempBad{color:#e5967a; font-weight:700;}
.chart{background:var(--card); border-radius:18px; padding:10px;}
.chart svg{width:100%; height:auto;}
.wline{fill:none; stroke:var(--acc); stroke-width:2.5; stroke-linejoin:round;}
.wdot{fill:var(--sageLt);}
.goalLine{stroke:rgba(245,234,216,.25); stroke-width:1; stroke-dasharray:4 3;}
.goalText,.axis{font-family:'DotGothic16',monospace; font-size:8px; fill:var(--tx3);}
.chartNow{text-align:center; font-size:12px; color:var(--tx2); margin:4px 0 0;}

/* 病歷匯入 */
.importBox{resize:vertical; min-height:90px; line-height:1.6; font-size:13px;}
.importErr{font-size:12px; color:#e5967a; margin:0 0 6px; line-height:1.5;}
.importPreview{background:var(--inputbg); border-radius:14px; padding:8px 10px; margin-bottom:9px;}
.importRow{font-size:12px; padding:3px 0; border-bottom:1px dashed rgba(245,234,216,.1); color:var(--tx);}
.importRow:last-child{border-bottom:none;}
.importRow.dup{color:var(--tx4); text-decoration:line-through;}
.importRow.dup small{text-decoration:none; margin-left:4px;}

/* 月曆 */
.calHead{display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;
  font-size:14px; color:var(--tx);}
.calGrid{display:grid; grid-template-columns:repeat(7,1fr); gap:4px;}
.wd{text-align:center; font-size:10px; color:var(--tx3); padding-bottom:2px;}
.cell{aspect-ratio:1; border-radius:10px; background:rgba(245,234,216,.05); display:flex;
  align-items:center; justify-content:center; font-family:'DotGothic16',monospace; font-size:9px;
  color:var(--tx4);}
.cell i{font-style:normal;}
.cell.stamp.part{background:rgba(122,138,94,.28); color:var(--sageLt);}
.cell.stamp.full{background:var(--sage); color:var(--bg); box-shadow:0 0 0 2px var(--acc) inset; font-weight:700;}
.cell.selDay{outline:2px solid var(--acc); outline-offset:1px;}
.calDayList{margin-top:12px; border-top:1px solid var(--line); padding-top:4px;}
.calWx{font-size:12px; color:var(--tx2); margin:-2px 0 8px;}
.calFoot{font-size:12px; color:var(--tx3); margin-top:12px; line-height:1.6;}

/* 月曆內紀錄列（含 ✎/×） */
.entry{display:flex; align-items:center; gap:8px; padding:9px 0;
  border-bottom:1px solid rgba(245,234,216,.06); font-size:13px;}
.entryIcon{font-size:15px;}
.entryTime{font-family:'DotGothic16',monospace; font-size:10px; color:var(--tx3); flex:none;}
.entryBody{flex:1; color:var(--tx);}
.entryBody small{color:var(--tx2);}
.entryBy{font-size:11px; background:rgba(245,234,216,.08); color:var(--tx2);
  padding:2px 8px; border-radius:999px; flex:none;}

/* 頭像設定 */
.avatarPrev{width:128px; margin:4px auto 10px; background:var(--inputbg); border-radius:16px; padding:10px;}
.dogPhoto{display:block; width:100%; aspect-ratio:1; object-fit:cover; border-radius:12px;}
.dog{width:100%; height:auto; image-rendering:pixelated;}
`;
