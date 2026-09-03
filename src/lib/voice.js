/* 語音快速記錄：把一句中文轉成一筆日誌草稿。
 *
 * 純函式、不碰 UI 也不碰儲存，方便單獨測試。
 * 原則：辨識不出類別就回 null，交給畫面請使用者選，不要亂猜；
 * 不管分到哪一類，整句話都會留在 note 裡，分類錯了也不會遺失原話。
 */

/* ---------- 數字：阿拉伯數字與中文數字都要吃得下 ---------- */
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 中文數字轉阿拉伯數字，支援到「九十九」與「一百」。看不懂回 null。 */
export function cnToNum(s) {
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "半") return 0.5;
  if (s === "一百" || s === "百") return 100;
  const i = s.indexOf("十");
  if (i === -1) {
    const n = CN_DIGIT[s];
    return n === undefined ? null : n;
  }
  const tensChar = s.slice(0, i);
  const onesChar = s.slice(i + 1);
  const tens = tensChar === "" ? 1 : CN_DIGIT[tensChar];
  const ones = onesChar === "" ? 0 : CN_DIGIT[onesChar];
  if (tens === undefined || ones === undefined) return null;
  return tens * 10 + ones;
}

const NUM_PAT = "\\d+|[零一二兩三四五六七八九十百]+|半";

/** 從句子抓出分鐘數（支援「30分鐘」「三十分」「半小時」「一個半小時」）。抓不到回 null。 */
export function parseMinutes(text) {
  const half = new RegExp(`(${NUM_PAT})\\s*個?半\\s*(小時|鐘頭)`).exec(text);
  if (half) {
    const n = cnToNum(half[1]);
    if (n != null) return Math.round(n * 60 + 30);
  }
  const hr = new RegExp(`(${NUM_PAT})\\s*個?\\s*(小時|鐘頭)`).exec(text);
  if (hr) {
    const n = cnToNum(hr[1]);
    if (n != null) return Math.round(n * 60);
  }
  const min = new RegExp(`(${NUM_PAT})\\s*(分鐘|分)`).exec(text);
  if (min) {
    const n = cnToNum(min[1]);
    if (n != null) return Math.round(n);
  }
  return null;
}

/* ---------- 類別判斷：加權計分，最高分者勝 ---------- */
/* 專屬字眼給 3 分，模稜兩可的給 1 分。例如「吃藥」的「藥」是健康專屬，
   分數會壓過「吃」，不會被誤判成吃飯。 */
const RULES = {
  med: [[/餵藥|吃藥|服藥|藥丸|藥粉|止痛|抗生素|眼藥|藥膏/, 4], [/藥/, 4]],
  supp: [[/營養品|保健品|益生菌|魚油|鈣片|關節保養|保健食品/, 3], [/保養|補充/, 1]],
  cond: [[/嘔吐|吐了|咳嗽|搔癢|發燒|沒精神|精神不佳|食慾不振|不舒服|生病|跛腳|流鼻水|皮膚/, 3], [/癢|軟弱|懶洋洋/, 1]],
  potty: [[/便便|大便|排便|尿尿|噓噓|上廁所|拉肚子|腹瀉|軟便|便秘/, 3], [/尿|屎|便/, 1]],
  meal: [[/早餐|午餐|晚餐|點心|吃飯|餵飯|零食|飼料|鮮食|罐頭|凍乾/, 3],
    [/吃了|餵了/, 2], // 泛用動詞，分數要低於「藥」等專屬字眼，「吃了藥」才不會被判成吃飯
    [/雞肉|鹿肉|鴨肉|豬肉|牛肉|羊肉|魚肉|蛋|飯|肉|吃|餵/, 1]],
  walk: [[/散步|遛狗|遛|放風|公園|玩球|丟球|運動|游泳|出去玩|室內玩/, 3],
    [/走走|出門|外面|跑|玩|活動/, 1]],
  care: [[/洗澡|梳毛|剪指甲|修指甲|清耳朵|掏耳|刷牙|美容|吹乾|洗腳|擦腳/, 3], [/清潔|整理|梳/, 1]],
};

/** 只判斷類別（回傳 log 的 type，判不出來回 null）。 */
export function classifyType(text) {
  const t = String(text || "");
  let best = null, bestScore = 0;
  for (const [type, pats] of Object.entries(RULES)) {
    let score = 0;
    for (const [re, w] of pats) if (re.test(t)) score += w;
    if (score > bestScore) { best = type; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

const MEAL_SEG = [[/早餐|早上餵|早飯/, "早餐"], [/午餐|中餐|午飯/, "午餐"],
  [/晚餐|晚飯/, "晚餐"], [/點心|零食|宵夜/, "點心"]];
const POTTY_VAL = [[/拉肚子|腹瀉|拉稀/, "拉肚子"], [/軟便|偏軟|有點軟|很軟/, "偏軟"],
  [/偏硬|很硬|硬硬|便秘/, "偏硬"], [/尿尿|噓噓|小便|尿/, "尿尿"], [/有血|血絲|帶血/, "有血"]];
const WALK_KIND = [[/室內玩|在家玩|家裡玩/, "室內玩"], [/出去玩|外面玩|公園|放風|外出/, "出去玩"],
  [/游泳|玩水/, "游泳"], [/散步|遛狗|遛|走走/, "散步"]];
const CARE_ITEMS = [[/洗澡/, "洗澡"], [/梳毛|梳/, "梳毛"], [/剪指甲|修指甲|指甲/, "剪指甲"],
  [/清耳朵|掏耳|耳朵/, "清耳朵"], [/刷牙|牙齒/, "刷牙"]];
const COND_VAL = [[/嘔吐|吐了/, "嘔吐"], [/咳嗽/, "咳嗽"], [/搔癢|一直抓|很癢|癢/, "皮膚搔癢"],
  [/食慾不振|不吃|沒胃口/, "食慾不振"], [/沒精神|精神不佳|懶洋洋/, "精神不佳"],
  [/發燒/, "發燒"], [/跛腳|走路怪/, "走路跛腳"]];

const firstMatch = (list, text) => list.find(([re]) => re.test(text))?.[1] || null;

/** 依時刻推餐別（沒講早午晚餐時的預設）。 */
const mealByHour = (now) => {
  const h = new Date(now).getHours();
  return h < 10 ? "早餐" : h < 14 ? "午餐" : h < 17 ? "點心" : "晚餐";
};

/**
 * 把一句話轉成日誌草稿。
 * @returns {{type,val,chips,note}|null} 判不出類別時回 null（畫面應請使用者選類別）
 */
export function classifyVoice(text, now = Date.now()) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const type = classifyType(raw);
  if (!type) return null;
  return { ...draftFor(type, raw, now), note: raw };
}

/**
 * 指定類別時的欄位預設值（語音判錯後手動改分類也走這裡）。
 * @returns {{type,val,chips}}
 */
export function draftFor(type, text = "", now = Date.now()) {
  const t = String(text || "");
  switch (type) {
    case "meal":
      return { type, val: firstMatch(MEAL_SEG, t) || mealByHour(now), chips: [] };
    case "walk":
      return { type, val: parseMinutes(t) || 30, chips: [firstMatch(WALK_KIND, t) || "散步"] };
    case "potty":
      return { type, val: firstMatch(POTTY_VAL, t) || "正常", chips: [] };
    case "care": {
      const items = CARE_ITEMS.filter(([re]) => re.test(t)).map(([, name]) => name);
      return { type, val: "", chips: items };
    }
    case "cond":
      return { type, val: firstMatch(COND_VAL, t) || "", chips: [] };
    case "med": case "supp":
      return { type, val: "", chips: [] };
    default:
      return { type, val: "", chips: [] };
  }
}
