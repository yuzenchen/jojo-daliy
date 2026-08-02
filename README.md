# JOJO — 寵物養成日誌

家犬 JOJO 的日常照顧記錄 App，電子雞式養成介面。React + Vite，跑在 Docker。

---

## 最快上手（3 步）

前提：本機已安裝 **Docker Desktop**（含 Docker Compose）。不需要另外裝 Node.js，
容器裡已內建。

```bash
# 1. 進到專案資料夾
cd jojo

# 2. 建置並啟動（第一次會拉 image、裝依賴，約 1–2 分鐘）
docker compose up --build

# 3. 瀏覽器打開
#    http://localhost:5173
```

改任何 `src/` 下的檔案，瀏覽器會自動熱更新（已為容器環境開好 polling）。
按 `Ctrl+C` 停止；下次啟動不用再 `--build`，直接 `docker compose up` 即可。

---

## 常用指令

| 目的 | 指令 |
|------|------|
| 啟動（背景執行） | `docker compose up -d` |
| 看即時 log | `docker compose logs -f` |
| 停止 | `docker compose down` |
| 依賴改了要重建 | `docker compose up --build` |
| 進容器裡下指令 | `docker compose exec web sh` |

> 你改了 `package.json`（加了新套件）或 `server/index.js`（API 程式碼）時
> 才需要 `--build`；只改 `src/` 不用。

---

## 用 Claude Code 開發

你有 Max 訂閱，直接用即可。

```bash
# 在專案資料夾裡啟動（Claude Code 會自動讀根目錄的 CLAUDE.md）
cd jojo
claude
```

`CLAUDE.md` 裡已寫好設計原則、範圍、資料模型與注意事項，Claude Code 一開就有脈絡。
建議一次請它做一個功能、跑起來確認後再進下一個。

環境有問題時跑 `claude doctor` 檢查。

---

## 專案結構

```
jojo/
├── CLAUDE.md              # 給 Claude Code 的專案藍圖（設計原則 / 範圍 / 資料模型）
├── README.md             # 本檔
├── Dockerfile            # 開發用容器（Vite dev server）
├── Dockerfile.pi         # 正式版 web 容器（多階段 build → nginx + 靜態檔）
├── nginx.conf            # 正式版 nginx 設定（gzip / 快取 / 反代 /api）
├── docker-compose.yml    # 開發一鍵啟動（web 熱更新 + api）
├── docker-compose.pi.yml # 樹莓派正式版（web + api，資料在 ./data）
├── vite.config.js        # host / polling / /api 代理
├── package.json
├── index.html
├── server/
│   ├── index.js          # 共用資料 API（零依賴 Node + 內建 SQLite、樂觀鎖）
│   └── Dockerfile        # api 容器定義
└── src/
    ├── main.jsx          # 進入點
    ├── JojoLog.jsx       # 主元件（目前單檔，之後可拆）
    └── lib/
        └── storage.js    # 儲存抽象層 ★ 見下方
```

---

## 最重要的一件事：儲存層

**鐵則：UI 只透過 `src/lib/storage.js` 存取資料，不要在元件裡直接寫 IndexedDB 或 fetch 後端。**

全家共用已上線（方案 B，自架後端）：

- `shared=true`（狗的所有紀錄）→ 走同源 `/api/kv/...`，由 `server/index.js`
  （零依賴 Node + 內建 SQLite）保存在 `data/jojo.db`，**全家看到同一份**。
- `shared=false`（使用者名字）→ 留在各自裝置的 IndexedDB。
- **同時記錄不會互蓋**：每個 key 有版本號，寫入撞到別人的更新時伺服器回 409，
  storage.js 依規則合併（logs/medical 依 id 聯集、skills 取較大值）後自動重試。
- 前端每 20 秒與切回前景時輪詢，家人剛記的幾秒到幾十秒內就會出現。
- 升級前留在瀏覽器裡的舊資料，首次連上伺服器會自動搬上去（一次性）。

小提醒：發生衝突合併的當下，「刪除」可能被另一端的舊資料復活（很罕見，重刪一次即可）。

---

## 之後要做的（優先序）

第二版真正的價值在這三個，尤其推播：

1. **疫苗到期推播** — 純網頁做得勉強（iOS 需 PWA 加到主畫面 + iOS 16.4+）。
   若是硬需求，考慮改 `storage.js` 接後端 + Web Push，或包成原生 App。
2. **全家共用** — 改 `storage.js` 接 Supabase/Firebase，加簡單帳號。
3. **病歷 PDF 匯出** — 回診時給獸醫看。

功能細節你會自己依實際使用調整；技能樹的升級輪數（10/25/50）用幾週後大概要改。

---

## 匯出到 Google 試算表

「JOJO 設定」面板（點頭像）裡的「📤 匯出」會把**全部紀錄覆蓋寫入**你指定的
Google 試算表（分頁：紀錄／體重／體溫／疫苗驅蟲／就診）。一次性設定：

1. 開啟目標試算表 → 擴充功能 → Apps Script，貼上：

```js
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const write = (name, header, rows) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clearContents();
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  };
  write('紀錄', ['日期', '時間', '記錄者', '類型', '內容', '備註'], data.logs);
  write('體重', ['日期', '公斤'], data.weights);
  write('體溫', ['日期', '°C'], data.temps);
  write('疫苗驅蟲', ['項目', '上次日期', '週期天數'], data.vax);
  write('就診', ['日期', '醫院', '主訴', '用藥'], data.visits);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }));
}
```

2. 部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」、
   存取權「任何人」→ 部署，複製產生的網址（`https://script.google.com/macros/s/…/exec`）。
3. 在 Pi 的 `~/jojo-daliy/.env` 寫入一行：`EXPORT_SHEET_URL=<剛複製的網址>`，
   然後重跑 `docker compose -f docker-compose.pi.yml up -d` 即生效。

> 網址視同密碼（拿到就能寫你的試算表），只放在 Pi 的 .env，不進 git。

## 正式版部署（樹莓派）

開發模式（Vite dev server）吃幾百 MB 記憶體，**不要**放到 Pi 上跑。
正式版是兩個容器：`web`（nginx 托管靜態檔 + 反代 `/api`）與 `api`
（零依賴 Node + SQLite）。實測記憶體 web 約 13MB、api 約 18MB——Pi 5 2GB 綽綽有餘。
base image 都是多架構（amd64 / arm64），在 Pi 上直接 build。

把整個資料夾複製到 Pi 後，一行啟動：

```bash
docker compose -f docker-compose.pi.yml up -d --build
```

家人用瀏覽器開 `http://<Pi 的 IP>:8088` 即可（port 避開了綠葉專案的
80/443/3000/3001/3002/3100），**所有人看到同一份資料**。改版後重跑同一行即可更新。

- 資料落在 Pi 上的 `./data/jojo.db`（SQLite）。**備份＝複製 data 資料夾**，
  建議偶爾 `cp` 一份到別台機器或隨身碟。
- 「我是誰」存在各自裝置的瀏覽器裡，換裝置只需重設名字，紀錄不受影響。
- 只在家用網路開放即可；若要外出也能記錄，之後可再加 Cloudflare Tunnel（綠葉專案同款作法）。
