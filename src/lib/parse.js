/**
 * 「打字快速記」的規則解析器（第一階段，零成本、離線可用）。
 *
 * parseText("散步40 晚餐雞胸肉 便便偏軟", SKILLS)
 *   → { records: [{type:'walk',val:40}, {type:'meal',val:'晚餐',note:'雞胸肉'}, {type:'potty',val:'偏軟'}],
 *       unknown: [] }
 *
 * record.type ∈ meal/walk/potty/care/med/train（日誌）、weight/temp（寫進健康資料）。
 * 解析不出來的片段：能當前一筆的備註就併入，否則進 unknown 由 UI 提示。
 * 字典依家人實際用語微調即可；之後接 LLM 兜底時，unknown 再丟給模型。
 */

const POTTY_MAP = {
  正常: "正常", 偏軟: "偏軟", 軟: "偏軟", 軟便: "偏軟",
  偏硬: "偏硬", 硬: "偏硬",
  腹瀉: "腹瀉", 拉肚子: "腹瀉",
  有血: "有血", 血便: "有血", 帶血: "有血",
};
const CARE_WORDS = ["洗澡", "剪指甲", "剪趾甲", "刷牙", "清耳朵", "清耳", "梳毛"];
const CARE_MAP = { 剪趾甲: "剪指甲", 清耳: "清耳朵" };

const mealByHour = (h) => (h < 10 ? "早餐" : h < 14 ? "午餐" : h < 17 ? "點心" : "晚餐");

export function parseText(input, skills, now = new Date()) {
  const text = String(input || "")
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
  const tokens = text.split(/[\s,，、。;；]+/).filter(Boolean);
  const records = [];
  const unknown = [];

  for (const tok of tokens) {
    let m;
    const prev = records[records.length - 1];

    // 散步（可帶時長；「散步」單獨出現預設 30 分）
    if ((m = tok.match(/^(散步|遛狗|遛|走路)(\d+)?(?:分鐘|分|min)?$/i))) {
      records.push({ raw: tok, type: "walk", val: m[2] ? Number(m[2]) : 30 });
      continue;
    }
    // 純時長 → 併入前一筆散步（「散步 40分」拆成兩個 token 的情況）
    if ((m = tok.match(/^(\d+)(?:分鐘|分|min)$/i)) && prev?.type === "walk") {
      prev.val = Number(m[1]);
      continue;
    }
    // 體重
    if ((m = tok.match(/^體重(\d+(?:\.\d+)?)(?:kg|公斤)?$/i)) || (m = tok.match(/^(\d+(?:\.\d+)?)(?:kg|公斤)$/i))) {
      records.push({ raw: tok, type: "weight", val: Number(m[1]) });
      continue;
    }
    // 體溫
    if ((m = tok.match(/^體溫(\d+(?:\.\d+)?)(?:度|°?c)?$/i)) || (m = tok.match(/^(\d+(?:\.\d+)?)(?:度|°c)$/i))) {
      records.push({ raw: tok, type: "temp", val: Number(m[1]) });
      continue;
    }
    // 吃飯（指明哪一餐，或依現在時間推餐別；其餘文字進備註）
    if ((m = tok.match(/^(早餐|午餐|晚餐|點心|宵夜)(.*)$/))) {
      records.push({ raw: tok, type: "meal", val: m[1] === "宵夜" ? "點心" : m[1], note: m[2] || "" });
      continue;
    }
    if ((m = tok.match(/^(吃飯|吃了|吃)(.*)$/))) {
      records.push({ raw: tok, type: "meal", val: mealByHour(now.getHours()), note: m[2] || "" });
      continue;
    }
    // 便便／尿尿
    if ((m = tok.match(/^(便便|大便|大號)(.*)$/))) {
      const st = POTTY_MAP[m[2]];
      records.push({ raw: tok, type: "potty", val: st || "正常", note: st ? "" : m[2] || "" });
      continue;
    }
    if (/^(尿尿|小便|尿)$/.test(tok)) {
      records.push({ raw: tok, type: "potty", val: "尿尿" });
      continue;
    }
    // 便便狀態單獨出現（「便便 偏軟」拆兩個 token）→ 修正前一筆
    if (POTTY_MAP[tok] && prev?.type === "potty") {
      prev.val = POTTY_MAP[tok];
      continue;
    }
    // 照顧
    const care = CARE_WORDS.find((c) => tok.startsWith(c));
    if (care) {
      records.push({ raw: tok, type: "care", val: CARE_MAP[care] || care, note: tok.slice(care.length) || "" });
      continue;
    }
    // 餵藥
    if ((m = tok.match(/^(餵藥|吃藥)(.*)$/))) {
      records.push({ raw: tok, type: "med", val: m[2] || "" });
      continue;
    }
    // 訓練（「練坐下」「訓練握手」，或直接打技能名）
    if ((m = tok.match(/^(練習|練|訓練)(.+)$/))) {
      const sk = skills.find((s) => s.name === m[2]);
      if (sk) { records.push({ raw: tok, type: "train", val: sk.id }); continue; }
    }
    const skExact = skills.find((s) => s.name === tok);
    if (skExact) {
      records.push({ raw: tok, type: "train", val: skExact.id });
      continue;
    }
    // 看不懂：能當備註就併入前一筆，否則列入 unknown
    if (prev && ["meal", "potty", "care", "med"].includes(prev.type)) {
      prev.note = prev.note ? `${prev.note} ${tok}` : tok;
      prev.raw += ` ${tok}`;
      continue;
    }
    unknown.push(tok);
  }
  return { records, unknown };
}
