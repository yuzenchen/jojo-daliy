import React, { useState, useEffect, useMemo } from "react";
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
const DOG_WAG = [
  "..##........##..",
  ".####......####.",
  ".######..######.",
  "..############..",
  ".##############.",
  ".###.######.###.",
  ".##############.",
  ".##############.",
  ".######..######.",
  "..####....####..",
  "..############..",
  "..###########.##",
  "..###########.##",
  ".####......####.",
  ".###........###.",
  "..##........##..",
];
const DOG_SLEEP = [
  "................",
  "................",
  "..##........##..",
  ".####......####.",
  ".######..######.",
  "..############..",
  ".##############.",
  ".###.######.###.",
  ".##############.",
  ".######..######.",
  "..############..",
  "...##########...",
  "..############..",
  ".####......####.",
  "..##........##..",
  "................",
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

function PixelDog({ mood, custom }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (custom || reduce || mood === "sleep") return;
    const t = setInterval(() => setFrame((f) => 1 - f), 620);
    return () => clearInterval(t);
  }, [mood, custom]);

  // 自訂頭像：字串 = 照片 data URL；陣列 = 舊版點陣（相容早期存的資料）
  if (typeof custom === "string") return <img className="dogPhoto" src={custom} alt="JOJO" />;
  if (Array.isArray(custom)) return <Pixels grid={custom} label="JOJO" />;
  const grid = mood === "sleep" ? DOG_SLEEP : frame === 0 ? DOG_AWAKE : DOG_WAG;
  return <Pixels grid={grid} label="JOJO" />;
}

/* ============ 頭像上傳（置中裁方形 → 128×128 → data URL） ============ */
function imageToDataUrl(img) {
  const SIZE = 128;
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d");
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
  return c.toDataURL("image/jpeg", 0.85); // 約 5–10KB，存進共用 profile 沒負擔
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
  const [dataUrl, setDataUrl] = useState(null);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { setDataUrl(imageToDataUrl(await createImageBitmap(f))); }
    catch { setDataUrl(null); }
  };

  return (
    <>
      <p className="formHint">
        挑一張 JOJO 的照片當頭像（全家都看得到）。會自動置中裁成正方形。
      </p>
      <input className="input" type="file" accept="image/*" onChange={onFile} />
      {dataUrl && (
        <>
          <div className="avatarPrev"><img className="dogPhoto" src={dataUrl} alt="頭像預覽" /></div>
          <button className="primary" onClick={() => onSave(dataUrl)}>就用這張</button>
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
  weight: { label: "體重", icon: "⚖️" },
};

/* ============ 主元件 ============ */
export default function JojoLog() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState(null);
  const [prof, setProf] = useState(null);
  const [logs, setLogs] = useState([]);
  const [med, setMed] = useState({ vax: [], visits: [], weights: [] });
  const [tab, setTab] = useState("today");
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState("");

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
      setMed(await read(K.med, true, { vax: [], visits: [], weights: [] }));
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

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

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
    const e = { id: uid(), ts: Date.now(), by: me || "?", ...entry };
    const next = [e, ...logs].slice(0, 800);
    setLogs(next); await save(K.logs, next, true);
    setSheet(null);
    flash(`${TYPE_META[entry.type]?.icon || "✓"} 記錄好了`);
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
  const todayKinds = new Set(todayLogs.map((l) => l.type));
  // 心情：依今天散步次數。兩次以上＝好（搖尾）、一次＝普通、還沒散步＝差（睡覺）
  const walksToday = todayLogs.filter((l) => l.type === "walk").length;
  const mood = walksToday >= 2 ? "wag" : walksToday >= 1 ? "awake" : "sleep";
  const moodText = walksToday >= 2 ? "😊 好" : walksToday >= 1 ? "🙂 普通" : "😞 差";
  const age = prof?.birth ? daysBetween(prof.birth, Date.now()) : null;

  if (!ready) return <Shell><div className="loading">載入中…</div></Shell>;
  if (!me) return <Shell><NameSetup onDone={(n) => { setMe(n); save(K.me, n, false); }} /></Shell>;
  if (!prof) return <Shell><ProfileSetup onDone={saveProf} /></Shell>;

  return (
    <Shell>
      <div className="device">
        <div className="brand">
          <span className="dot" />
          <span className="brandName">JOJO</span>
          <span className="brandMeta">
            {age !== null ? `第 ${age} 天` : ""} · 連續 {streak} 天
          </span>
        </div>

        <div className="lcd">
          <div className="scan" />
          <div className="lcdInner">
            <div className="dogWrap" role="button" tabIndex={0} title="點擊更換頭像"
              onClick={() => setSheet("avatar")}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSheet("avatar")}>
              <PixelDog mood={mood} custom={prof.avatar || null} />
            </div>
            <div className="bars">
              <Bar label="體態" v={stats.body} note={stats.body === null ? "先記體重" : null} />
              <Bar label="活力" v={stats.vitality} />
              <Bar label="技能" v={stats.skill} />
              <Bar label="羈絆" v={stats.bond} />
            </div>
          </div>
          <div className="infoRow">
            <span>年紀 {ageText(prof.birth) || "未設生日"}</span>
            <span>體重 {stats.latest ? `${stats.latest} kg` : "未記錄"}</span>
            <span>心情 {moodText}</span>
          </div>
          <div className="todayRow">
            {Object.entries(TYPE_META).slice(0, 5).map(([k, m]) => (
              <span key={k} className={todayKinds.has(k) ? "chip on" : "chip"}>
                {m.icon}
              </span>
            ))}
            <span className="todayCount">今天 {todayLogs.length} 筆</span>
          </div>
        </div>

        <div className="pad">
          {[
            ["meal", "吃飯"], ["walk", "散步"], ["potty", "便便"],
            ["train", "訓練"], ["care", "照顧"], ["health", "健康"],
          ].map(([k, l]) => (
            <button key={k} className="key" onClick={() => setSheet(k)}>
              <span className="keyIcon">{TYPE_META[k]?.icon || "🩺"}</span>
              <span className="keyLabel">{l}</span>
            </button>
          ))}
        </div>
      </div>

      <nav className="tabs">
        {[["today", "今天"], ["skills", "技能"], ["health", "健康"], ["cal", "月曆"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "tab on" : "tab"} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      <main className="page">
        {tab === "today" && <TodayView logs={logs} me={me} onDelete={async (id) => {
          const n = logs.filter((l) => l.id !== id); setLogs(n); await save(K.logs, n, true);
        }} />}
        {tab === "skills" && <SkillsView prof={prof} onTrain={async (id) => {
          const skills = { ...(prof.skills || {}) };
          skills[id] = (skills[id] || 0) + 1;
          const p = { ...prof, skills }; await saveProf(p);
          addLog({ type: "train", val: id });
        }} />}
        {tab === "health" && <HealthView med={med} prof={prof} onSave={saveMed} />}
        {tab === "cal" && <CalendarView logs={logs} />}
      </main>

      {sheet && (
        <Sheet onClose={() => setSheet(null)} title={
          { meal: "記一餐", walk: "記散步", potty: "記排泄", train: "記訓練", care: "記照顧", health: "記健康", avatar: "JOJO 設定" }[sheet]
        }>
          {sheet === "meal" && <MealForm onSubmit={addLog} />}
          {sheet === "walk" && <WalkForm onSubmit={addLog} />}
          {sheet === "potty" && <PottyForm onSubmit={addLog} />}
          {sheet === "train" && <TrainForm prof={prof} onSubmit={async (id) => {
            const skills = { ...(prof.skills || {}) };
            skills[id] = (skills[id] || 0) + 1;
            await saveProf({ ...prof, skills });
            addLog({ type: "train", val: id });
          }} />}
          {sheet === "care" && <CareForm onSubmit={addLog} />}
          {sheet === "avatar" && <>
            <ProfileQuickEdit prof={prof} onSave={async (patch) => {
              await saveProf({ ...prof, ...patch });
              flash("📝 基本資料更新了");
            }} />
            <AvatarForm prof={prof} onSave={async (grid) => {
              await saveProf({ ...prof, avatar: grid });
              setSheet(null); flash(grid ? "🐶 頭像換好了" : "🐶 回到預設狗");
            }} />
          </>}
          {sheet === "health" && <QuickWeight med={med} onSave={async (kg) => {
            const next = { ...med, weights: [...med.weights, { id: uid(), date: today(), kg }] };
            await saveMed(next); setSheet(null); flash("⚖️ 體重記錄好了");
          }} />}
        </Sheet>
      )}

      {toast && <div className="toast">{toast}</div>}
      <p className="footnote">
        資料由 {me} 等所有使用此頁面的人共用。連續紀錄不會因為漏記而扣分。
      </p>
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

function Bar({ label, v, note }) {
  const filled = v === null ? 0 : Math.round(v / 10);
  return (
    <div className="bar">
      <span className="barLabel">{label}</span>
      <span className="barTrack">
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} className={i < filled ? "seg on" : "seg"} />
        ))}
      </span>
      <span className="barVal">{v === null ? note : v}</span>
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

function MealForm({ onSubmit }) {
  const [note, setNote] = useState("");
  return (
    <>
      <Row>
        {["早餐", "午餐", "晚餐", "點心"].map((m) => (
          <button key={m} className="opt" onClick={() => onSubmit({ type: "meal", val: m, note })}>{m}</button>
        ))}
      </Row>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="吃了什麼／吃完沒（選填）" />
    </>
  );
}

function WalkForm({ onSubmit }) {
  const [n, setN] = useState(30);
  return (
    <>
      <Row>
        {[15, 30, 45, 60].map((m) => (
          <button key={m} className={n === m ? "opt on" : "opt"} onClick={() => setN(m)}>{m} 分</button>
        ))}
      </Row>
      <input className="input" type="number" value={n} onChange={(e) => setN(Number(e.target.value))} />
      <button className="primary" onClick={() => onSubmit({ type: "walk", val: n })}>記下 {n} 分鐘</button>
    </>
  );
}

function PottyForm({ onSubmit }) {
  const [note, setNote] = useState("");
  return (
    <>
      <p className="formHint">便便狀態異常時記下來，回診時給獸醫看很有用。</p>
      <Row>
        {["尿尿", "正常", "偏軟", "偏硬", "腹瀉", "有血"].map((s) => (
          <button key={s} className="opt" onClick={() => onSubmit({ type: "potty", val: s, note })}>{s}</button>
        ))}
      </Row>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="補充說明（選填），例如顏色、在哪上的" />
    </>
  );
}

function TrainForm({ prof, onSubmit }) {
  const reps = prof?.skills || {};
  return (
    <>
      <p className="formHint">按一次＝練一輪。10 輪學習中、25 輪熟練、50 輪精通。</p>
      <div className="trainGrid">
        {SKILLS.map((s) => (
          <button key={s.id} className="opt" onClick={() => onSubmit(s.id)}>
            {s.name}<small> {reps[s.id] || 0}</small>
          </button>
        ))}
      </div>
    </>
  );
}

function CareForm({ onSubmit }) {
  const [note, setNote] = useState("");
  return (
    <>
      <Row>
        {["洗澡", "剪指甲", "刷牙", "清耳朵", "梳毛", "餵藥"].map((c) => (
          <button key={c} className="opt" onClick={() => onSubmit({ type: "care", val: c, note })}>{c}</button>
        ))}
      </Row>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="補充說明（選填），例如餵什麼藥、剪了幾指" />
    </>
  );
}

function QuickWeight({ med, onSave }) {
  const last = med.weights?.[med.weights.length - 1];
  const [kg, setKg] = useState(last?.kg || "");
  return (
    <>
      <p className="formHint">{last ? `上次 ${last.kg} kg（${last.date}）` : "還沒有體重紀錄"}</p>
      <input className="input" type="number" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="公斤" />
      <button className="primary" disabled={!kg} onClick={() => onSave(Number(kg))}>記下體重</button>
    </>
  );
}

/* ============ 分頁：今天 ============ */
function TodayView({ logs, onDelete }) {
  const groups = useMemo(() => {
    const g = {};
    logs.slice(0, 120).forEach((l) => {
      const d = dayKey(l.ts);
      (g[d] = g[d] || []).push(l);
    });
    return Object.entries(g);
  }, [logs]);

  if (!logs.length) return <Empty text="還沒有任何紀錄。按上面的按鈕記第一筆。" />;

  return (
    <div className="timeline">
      {groups.map(([d, items]) => (
        <section key={d}>
          <h2 className="dayHead">{d === today() ? "今天" : d}</h2>
          {items.map((l) => (
            <div key={l.id} className="entry">
              <span className="entryIcon">{TYPE_META[l.type]?.icon}</span>
              <span className="entryTime">
                {new Date(l.ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="entryBody">
                {l.type === "train"
                  ? `訓練 ${SKILLS.find((s) => s.id === l.val)?.name || l.val}`
                  : l.type === "walk" ? `散步 ${l.val} 分鐘`
                  : `${TYPE_META[l.type]?.label} ${l.val || ""}`}
                {l.note ? <small> · {l.note}</small> : null}
              </span>
              <span className="entryBy">{l.by}</span>
              <button className="del" onClick={() => onDelete(l.id)} aria-label="刪除">×</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ============ 分頁：技能 ============ */
function SkillsView({ prof, onTrain }) {
  const reps = prof?.skills || {};
  return (
    <div className="skillWrap">
      {["基礎", "進階"].map((tier) => (
        <section key={tier}>
          <h2 className="dayHead">{tier}</h2>
          {SKILLS.filter((s) => s.tier === tier).map((s) => {
            const r = reps[s.id] || 0;
            const lv = skillLevel(r);
            const next = TIERS[lv + 1];
            const pct = next ? ((r - TIERS[lv].at) / (next.at - TIERS[lv].at)) * 100 : 100;
            return (
              <div key={s.id} className="skill">
                <div className="skillTop">
                  <b>{s.name}</b>
                  <span className={`lv lv${lv}`}>{TIERS[lv].label}</span>
                </div>
                <div className="skillBar"><i style={{ width: `${clamp(pct, 0, 100)}%` }} /></div>
                <div className="skillFoot">
                  <span>{r} 輪{next ? ` · 再 ${next.at - r} 輪升級` : " · 已精通"}</span>
                  <button className="mini" onClick={() => onTrain(s.id)}>＋1</button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
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
function HealthView({ med, prof, onSave }) {
  const [form, setForm] = useState(null);
  const vax = (med.vax || []).map((v) => {
    const due = new Date(new Date(v.date).getTime() + v.cycleDays * 86400000);
    return { ...v, due: dayKey(due), left: daysBetween(Date.now(), due) };
  }).sort((a, b) => a.left - b.left);

  const weights = (med.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));

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
        <h2 className="dayHead">疫苗與驅蟲</h2>
        <button className="mini" onClick={() => setForm(form === "vax" ? null : "vax")}>＋ 新增</button>
      </div>
      {form === "vax" && <VaxForm onAdd={(v) => { onSave({ ...med, vax: [...(med.vax || []), v] }); setForm(null); }} />}
      {!vax.length && <Empty text="把手上的疫苗紀錄補進來，之後會自動倒數。" />}
      {vax.map((v) => (
        <div key={v.id} className={v.left < 0 ? "vax over" : v.left < 30 ? "vax soon" : "vax"}>
          <div><b>{v.name}</b><small> 上次 {v.date}</small></div>
          <div className="vaxRight">
            <span className="vaxDue">{v.due}</span>
            <span className="vaxLeft">{v.left < 0 ? `逾期 ${-v.left} 天` : `還有 ${v.left} 天`}</span>
          </div>
          <button className="del" onClick={() => onSave({ ...med, vax: med.vax.filter((x) => x.id !== v.id) })}>×</button>
        </div>
      ))}

      <h2 className="dayHead">體重曲線</h2>
      {weights.length < 2 ? <Empty text="記滿兩筆體重就會畫出曲線。" /> : (
        <WeightChart data={weights} goal={prof?.goalKg} />
      )}

      <div className="secHead">
        <h2 className="dayHead">就診紀錄</h2>
        <button className="mini" onClick={() => setForm(form === "visit" ? null : "visit")}>＋ 新增</button>
      </div>
      {form === "visit" && <VisitForm onAdd={(v) => { onSave({ ...med, visits: [v, ...(med.visits || [])] }); setForm(null); }} />}
      {(med.visits || []).map((v) => (
        <div key={v.id} className="visit">
          <b>{v.date}</b> <span>{v.clinic}</span>
          <p>{v.reason}</p>
          {v.med && <p className="visitMed">用藥：{v.med}</p>}
          <button className="del" onClick={() => onSave({ ...med, visits: med.visits.filter((x) => x.id !== v.id) })}>×</button>
        </div>
      ))}
    </div>
  );
}

function VaxForm({ onAdd }) {
  const [f, setF] = useState({ name: "", date: today(), cycleDays: 365 });
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
      <button className="primary" disabled={!f.name} onClick={() => onAdd({ id: uid(), ...f })}>加入</button>
    </div>
  );
}

function VisitForm({ onAdd }) {
  const [f, setF] = useState({ date: today(), clinic: "", reason: "", med: "" });
  return (
    <div className="inlineForm">
      <label className="lab">日期<input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <input className="input" value={f.clinic} onChange={(e) => setF({ ...f, clinic: e.target.value })} placeholder="醫院名稱" />
      <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="主訴／診斷" />
      <input className="input" value={f.med} onChange={(e) => setF({ ...f, med: e.target.value })} placeholder="用藥與劑量（選填）" />
      <button className="primary" disabled={!f.reason} onClick={() => onAdd({ id: uid(), ...f })}>加入</button>
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
function CalendarView({ logs }) {
  const [offset, setOffset] = useState(0);
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + offset);
  const year = base.getFullYear(), month = base.getMonth();
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();

  const byDay = useMemo(() => {
    const m = {};
    logs.forEach((l) => {
      const d = dayKey(l.ts);
      (m[d] = m[d] || new Set()).add(l.type);
    });
    return m;
  }, [logs]);

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const full = cells.filter((d) => d && (byDay[dayKey(new Date(year, month, d))]?.size || 0) >= 3).length;

  return (
    <div className="cal">
      <div className="calHead">
        <button className="mini" onClick={() => setOffset(offset - 1)}>‹</button>
        <b>{year} 年 {month + 1} 月</b>
        <button className="mini" onClick={() => setOffset(offset + 1)} disabled={offset >= 0}>›</button>
      </div>
      <div className="calGrid">
        {["日", "一", "二", "三", "四", "五", "六"].map((w) => <span key={w} className="wd">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="cell" />;
          const n = byDay[dayKey(new Date(year, month, d))]?.size || 0;
          const cls = n >= 3 ? "cell stamp full" : n > 0 ? "cell stamp part" : "cell";
          return <span key={i} className={cls}><i>{d}</i></span>;
        })}
      </div>
      <p className="calFoot">
        本月蓋了 <b>{full}</b> 個實心爪印（一天記滿 3 類就算）。淺色是有記但未滿 3 類。
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
@import url('https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap');

.root{
  --grape:#3B2B4F; --grape-lt:#57426F; --grape-dk:#241833;
  --lcd:#C6D49B; --lcd-dim:#AFC083; --ink:#2C3A1B;
  --tang:#FF7A45; --paper:#EFE9F3; --muted:#8B7C9B;
  min-height:100vh; background:var(--grape-dk);
  font-family:'Noto Sans TC',system-ui,sans-serif; color:#211A2B;
  padding:14px; display:flex; justify-content:center;
}
.frame{width:100%; max-width:430px;}
.root *:focus-visible{outline:2px solid var(--tang); outline-offset:2px;}
.loading{color:var(--lcd); text-align:center; padding:60px 0; font-family:'Silkscreen',monospace;}

/* 機殼 */
.device{background:linear-gradient(160deg,var(--grape-lt),var(--grape) 55%,var(--grape-dk));
  border-radius:28px; padding:14px; box-shadow:0 18px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.18);}
.brand{display:flex; align-items:center; gap:8px; padding:2px 6px 10px;}
.dot{width:8px;height:8px;border-radius:50%;background:var(--tang);box-shadow:0 0 8px var(--tang);}
.brandName{font-family:'Silkscreen',monospace; color:#F2ECF7; font-size:15px; letter-spacing:.06em;}
.brandMeta{margin-left:auto; color:#C3B2D6; font-size:11px;}

/* LCD */
.lcd{background:var(--lcd); border-radius:14px; padding:12px; position:relative; overflow:hidden;
  box-shadow:inset 0 3px 12px rgba(44,58,27,.35);}
.scan{position:absolute; inset:0; pointer-events:none;
  background:repeating-linear-gradient(to bottom,rgba(44,58,27,.07) 0 1px,transparent 1px 3px);}
.lcdInner{display:flex; gap:12px; align-items:center;}
.dogWrap{width:96px; flex:none; cursor:pointer; border-radius:8px;}
.dog{width:100%; height:auto; image-rendering:pixelated;}
.bars{flex:1; display:flex; flex-direction:column; gap:7px;}
.bar{display:flex; align-items:center; gap:6px;}
.barLabel{font-size:11px; color:var(--ink); font-weight:700; width:28px; flex:none;}
.barTrack{display:flex; gap:2px; flex:1;}
.seg{flex:1; height:9px; background:var(--lcd-dim); border-radius:1px;}
.seg.on{background:var(--ink);}
.barVal{font-family:'Silkscreen',monospace; font-size:10px; color:var(--ink); width:34px; text-align:right; flex:none;}
.infoRow{display:flex; justify-content:space-between; gap:6px; margin-top:10px; position:relative;
  font-size:11px; font-weight:700; color:var(--ink); border-top:1px solid var(--lcd-dim); padding-top:8px;}
.todayRow{display:flex; align-items:center; gap:5px; margin-top:8px; position:relative;}
.chip{font-size:14px; filter:grayscale(1); opacity:.3;}
.chip.on{filter:none; opacity:1;}
.todayCount{margin-left:auto; font-family:'Silkscreen',monospace; font-size:10px; color:var(--ink);}

/* 按鈕 */
.pad{display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:14px;}
.key{background:linear-gradient(180deg,#F6F1FA,#DCD1E6); border:none; border-radius:14px;
  padding:10px 4px; cursor:pointer; box-shadow:0 3px 0 #A493B5; transition:transform .08s, box-shadow .08s;
  display:flex; flex-direction:column; align-items:center; gap:3px;}
.key:active{transform:translateY(3px); box-shadow:0 0 0 #A493B5;}
.keyIcon{font-size:18px;}
.keyLabel{font-size:12px; font-weight:700; color:#3B2B4F;}

/* 分頁 */
.tabs{display:flex; gap:4px; margin:16px 0 10px;}
.tab{flex:1; background:none; border:none; color:#9C8AB0; font-family:'Noto Sans TC'; font-size:13px;
  font-weight:700; padding:8px 0; cursor:pointer; border-bottom:2px solid transparent;}
.tab.on{color:#F2ECF7; border-bottom-color:var(--tang);}
.page{background:var(--paper); border-radius:16px; padding:14px; min-height:200px;}

.dayHead{font-family:'Silkscreen',monospace; font-size:11px; color:var(--muted);
  margin:14px 0 8px; letter-spacing:.04em;}
section:first-child .dayHead{margin-top:0;}
.secHead{display:flex; align-items:center; justify-content:space-between;}

/* 時間軸 */
.entry{display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #E1D8E8; font-size:13px;}
.entryIcon{font-size:15px;}
.entryTime{font-family:'Silkscreen',monospace; font-size:10px; color:var(--muted); flex:none;}
.entryBody{flex:1;}
.entryBody small{color:var(--muted);}
.entryBy{font-size:11px; background:#DFD4E8; color:#4A3760; padding:2px 7px; border-radius:9px; flex:none;}
.del{background:none; border:none; color:#B9A9C6; font-size:17px; cursor:pointer; line-height:1; padding:0 3px;}

/* 技能 */
.skill{background:#fff; border-radius:11px; padding:11px; margin-bottom:8px;}
.skillTop{display:flex; justify-content:space-between; align-items:center; font-size:14px;}
.lv{font-size:10px; padding:2px 7px; border-radius:8px; background:#EDE6F2; color:var(--muted);}
.lv1{background:#E4EFD4; color:#5B7238;} .lv2{background:#FFE3D4; color:#B4501F;}
.lv3{background:var(--grape); color:#F2ECF7;}
.skillBar{height:5px; background:#EDE6F2; border-radius:3px; margin:8px 0 6px; overflow:hidden;}
.skillBar i{display:block; height:100%; background:var(--tang);}
.skillFoot{display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--muted);}
.mini{background:var(--grape); color:#F2ECF7; border:none; border-radius:8px; padding:4px 11px;
  font-size:12px; font-weight:700; cursor:pointer;}
.mini:disabled{opacity:.35;}

/* 健康 */
.vax{display:flex; align-items:center; gap:8px; background:#fff; border-radius:11px; padding:10px; margin-bottom:7px; font-size:13px;}
.vax small{color:var(--muted); font-size:11px;}
.vaxRight{margin-left:auto; text-align:right;}
.vaxDue{display:block; font-family:'Silkscreen',monospace; font-size:10px; color:var(--muted);}
.vaxLeft{font-size:12px; font-weight:700;}
.vax.soon .vaxLeft{color:#B4501F;}
.vax.over{background:#FFE9E1;} .vax.over .vaxLeft{color:#C0341B;}
.visit{background:#fff; border-radius:11px; padding:10px; margin-bottom:7px; font-size:13px; position:relative;}
.visit .del{position:absolute; top:6px; right:6px;}
.visit p{margin:4px 0 0;} .visitMed{color:var(--muted); font-size:12px;}
.chart{background:#fff; border-radius:11px; padding:8px;}
.chart svg{width:100%; height:auto;}
.wline{fill:none; stroke:var(--tang); stroke-width:2.5; stroke-linejoin:round;}
.wdot{fill:var(--grape);}
.goalLine{stroke:#C6B8D2; stroke-width:1; stroke-dasharray:4 3;}
.goalText,.axis{font-family:'Silkscreen',monospace; font-size:8px; fill:var(--muted);}
.chartNow{text-align:center; font-size:12px; color:var(--muted); margin:2px 0 0;}

/* 月曆 */
.calHead{display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; font-size:14px;}
.calGrid{display:grid; grid-template-columns:repeat(7,1fr); gap:4px;}
.wd{text-align:center; font-size:10px; color:var(--muted); padding-bottom:2px;}
.cell{aspect-ratio:1; border-radius:8px; background:#E5DCEB; display:flex; align-items:center;
  justify-content:center; font-family:'Silkscreen',monospace; font-size:9px; color:#B0A0BE;}
.cell i{font-style:normal;}
.cell.stamp.part{background:#DCE6C4; color:#7B8C57;}
.cell.stamp.full{background:var(--grape); color:#D9C9E8; box-shadow:0 0 0 2px var(--tang) inset;}
.calFoot{font-size:12px; color:var(--muted); margin-top:12px; line-height:1.6;}

/* 表單／彈窗 */
.sheetBack{position:fixed; inset:0; background:rgba(20,12,30,.6); display:flex;
  align-items:flex-end; justify-content:center; z-index:50; padding:0;}
.sheet{background:var(--paper); width:100%; max-width:430px; border-radius:20px 20px 0 0; padding:16px;
  animation:up .18s ease-out;}
@keyframes up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.sheet{animation:none}}
.sheetHead{display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:15px;}
.row{display:flex; flex-wrap:wrap; gap:7px; margin-bottom:10px;}
.trainGrid{display:grid; grid-template-columns:repeat(3,1fr); gap:7px;}
.opt{background:#fff; border:1px solid #DDD2E5; border-radius:10px; padding:10px 12px;
  font-size:13px; font-family:inherit; cursor:pointer; color:#3B2B4F; font-weight:500;}
.opt.on{background:var(--grape); color:#F2ECF7; border-color:var(--grape);}
.opt small{color:var(--muted); font-size:10px;}
.opt.on small{color:#C3B2D6;}
.input{width:100%; box-sizing:border-box; background:#fff; border:1px solid #DDD2E5; border-radius:10px;
  padding:11px; font-size:14px; font-family:inherit; margin-bottom:9px;}
.primary{width:100%; background:var(--tang); color:#fff; border:none; border-radius:11px; padding:13px;
  font-size:15px; font-weight:700; font-family:inherit; cursor:pointer;}
.primary:disabled{opacity:.4;}
.lab{display:block; font-size:12px; color:var(--muted); margin-bottom:2px;}
.formHint{font-size:12px; color:var(--muted); margin:0 0 10px; line-height:1.6;}
.inlineForm{background:#fff; border-radius:11px; padding:11px; margin-bottom:10px;}
.importBox{resize:vertical; min-height:90px; line-height:1.6; font-size:13px;}
.importErr{font-size:12px; color:#C0341B; margin:0 0 6px; line-height:1.5;}
.importPreview{background:#F6F1FA; border-radius:9px; padding:8px 10px; margin-bottom:9px;}
.importRow{font-size:12px; padding:3px 0; border-bottom:1px dashed #E1D8E8; color:#3B2B4F;}
.importRow:last-child{border-bottom:none;}
.importRow.dup{color:#B0A0BE; text-decoration:line-through;}
.importRow.dup small{text-decoration:none; margin-left:4px;}
.empty{font-size:13px; color:var(--muted); text-align:center; padding:18px 10px; line-height:1.7;}

/* 頭像上傳 */
.avatarPrev{width:128px; margin:4px auto 10px; background:var(--lcd); border-radius:10px; padding:10px;
  box-shadow:inset 0 2px 8px rgba(44,58,27,.3);}
.dogPhoto{display:block; width:100%; aspect-ratio:1; object-fit:cover; border-radius:10px;}
.ghost{width:100%; background:none; border:1px solid #DDD2E5; color:var(--muted); border-radius:11px;
  padding:11px; font-size:13px; font-family:inherit; cursor:pointer; margin-top:8px;}

/* 設定 */
.setup{background:var(--paper); border-radius:18px; padding:22px; margin-top:40px;}
.setupTitle{font-size:19px; margin:0 0 6px;}
.setupHint{font-size:13px; color:var(--muted); line-height:1.7; margin:0 0 16px;}

.toast{position:fixed; bottom:22px; left:50%; transform:translateX(-50%);
  background:var(--grape); color:#F2ECF7; padding:10px 20px; border-radius:22px; font-size:13px; z-index:60;}
.footnote{color:#7D6C8E; font-size:11px; text-align:center; margin:14px 0 4px; line-height:1.7;}
`;
