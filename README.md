# GPT AI Assistant

[![Release](https://img.shields.io/github/v/release/SanHsien/gpt-ai-assistant?sort=semver)](https://github.com/SanHsien/gpt-ai-assistant/releases)
[![CI](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node-24-339933.svg)](package.json)
[![Platform: LINE](https://img.shields.io/badge/platform-LINE-00B900.svg)](https://developers.line.biz/)
[![Powered by OpenAI](https://img.shields.io/badge/AI-OpenAI-412991.svg)](https://platform.openai.com/)
[![Tests: Jest](https://img.shields.io/badge/tests-jest-blueviolet.svg)](tests)
[![Deploy: Vercel](https://img.shields.io/badge/deploy-Vercel-000000.svg)](https://vercel.com/)

[繁體中文](README.md) | [English](README.en.md)

`GPT AI Assistant` 是一個把 **OpenAI** 與 **LINE Messaging API** 串起來的聊天機器人。完成安裝後，你就能在 LINE 手機 app 裡跟自己專屬的 AI 助理對話——聊天、生圖、看圖、上網查資料，全都在 LINE 對話框裡完成。

本 repo 源自 [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant)（MIT），現由 SanHsien 獨立維護。

## 這是什麼

- **LINE 原生體驗**：不用另外裝 app，直接在 LINE 跟你的助理聊天。
- **使用者自架、自備金鑰**：用你自己的 OpenAI 與 LINE channel 金鑰部署，資料與帳單都在你手上。
- **serverless 部署**：以 Vercel 為主，一鍵部署、免顧主機（也可本機 node 或 Docker 自架）。
- **指令式功能**：除了聊天，還有生圖、看圖、搜尋、翻譯、行程與多種「總結／分析」指令。

## 功能一覽

| 類別 | 能做什麼 |
|------|----------|
| 💬 對話 | 與 AI 連續對話（`talk`）；`continue` 續寫、`retry` 重試、`forget` 清除脈絡 |
| 🎙️ 語音 | 傳 LINE 語音訊息，用 OpenAI 語音轉文字（預設 `gpt-4o-mini-transcribe`，可設定）轉成文字後當一般輸入處理 |
| 🎨 生圖 | 用文字描述請 AI 生圖（`draw`，預設 GPT Image 2） |
| 👁️ 看圖 | 傳圖片請 AI 理解與描述（vision，預設 `gpt-4o`） |
| 🔍 搜尋 | 透過 SerpAPI 上網查資料（`search`，需 `SERPAPI_API_KEY`） |
| 🗓️ 行程與提醒 | 用一句話記行程（`記行程 明天下午三點看診`、`行程 5分鐘後的測試通知`，或直接輸入 `7/20 下午三點牙醫回診`）；模糊時間會先追問，完整草稿確認後才寫入。支援星期解消、`修改行程`、衝突警告、到點提醒、完成與刪除，並可操作授權的 Google Calendar。提醒可設 `安靜時段 22-8`、`暫停提醒`／`恢復提醒` |
| ✅ 任務 | 獨立存於 Supabase `tasks` 表的助理待辦，不會建立 Google Calendar 行程；開啟 Google Tasks outbound／inbound 並重新授權後，可雙向同步標題、備註、完成、重開與刪除（精確期限仍以本地為準）。`新增任務 重要 明天交報告 #工作` 自動解析期限、優先度與 `#標籤`；用 `我的任務` 及 `今天／明天／本週／下週／逾期／已完成／#標籤` 篩選查看，一鍵完成、重開或刪除（`ENABLE_TASKS`，預設關，需 `DATABASE_URL`） |
| 🌤️ 天氣 | 查地點天氣與未來預報（`天氣 台北`）；台灣常用縣市簡稱會自動補足行政區與國家。資料來自 Open-Meteo（免費、免 API key），帶短期快取（`ENABLE_WEATHER`，預設關） |
| 🌐 翻譯 | 翻成英文 / 日文（`translate`） |
| 🧠 總結／分析 | `sum`（建議、安慰、鼓勵、吐槽…）與 `analyze`（文學、數學、哲學、心理、命理…等角度） |
| ⚙️ 系統 | `activate` / `deactivate` 啟停、`version` 版本、`report` 回報、`deploy` 自我重新部署、`doc` 說明 |

> 傳送 `指令` 會依目前啟用的功能，回覆分組完整清單、可直接輸入的指令與範例；文件站另提供完整功能說明。
>
> 各能力可用環境變數個別關閉以控成本（預設全開）：`ENABLE_IMAGE_GENERATION`、`ENABLE_TRANSCRIPTION`、`ENABLE_VISION`、`ENABLE_SEARCH`。

每次一般回覆下方的 LINE Quick Reply 會依功能旗標顯示最多 13 個常用入口：`記行程`、`我的行程`、`新增任務`、`我的任務`、`天氣`、`每日天氣`、`查詢`、`請畫`、`連結 Google 行事曆`、`暫停提醒`、`恢復提醒`、`忘記`、`指令`。LINE 會將 Quick Reply 排成單列橫向捲動，不能由 bot 強制換成兩列。需要手機版固定兩列導覽時，可選用 LINE 官方帳號的 3×2 圖文選單；建議版型、文字動作與避免重複回覆的設定見 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#line-quick-replies-and-optional-rich-menu)。

部署時可用 `APP_LANG=zh_TW|zh|zh_CN|en|ja` 選擇 bot 介面語系。`zh_TW` 是目前唯一完整驗收、正式支援的語系；`zh` 與 `zh_CN` 暫時共用繁體中文字串，並非簡體中文包；`en`、`ja` 雖可啟動，主要指令與 Google OAuth 頁面已有翻譯，但天氣格式與自然語言日期／意圖辨識仍偏繁中，定位為實驗性，不應對 fork 使用者宣稱完整英／日部署。

Google Calendar 同步會在背景自動嘗試最多 3 次。成功後才回「已同步到 Google 行事曆」；最終失敗會提供「重試同步」「暫不處理」「刪除行程」。選擇暫不處理會保留 Supabase 資料且不再詢問；之後可用 `同步失敗行程`列出，再用 `重試同步 <ID>` 或 `刪行程 <ID>` 處理。刪除只會在使用者明確選擇後執行。

行程快捷鍵使用 LINE postback：對話會顯示「確認行程」或「完成行程 2」這類自然文字，清單操作帶當次序號，但不會附帶 confirmation token、Supabase UUID 或 Google event id。帶 `<ID>` 的文字格式只保留給手動排錯與無法使用按鈕時的備援。

行程時間不完整時，bot 只追問一個缺少欄位，下一句自然語句會延續前一張結構化草稿；原始對話不會寫入 Supabase。像「7/20 牙醫回診」這類只有日期的陳述視為整天；「明天下午看診」才會追問幾點。`修改行程` 會列出可修改項目，套用前再確認；版本鎖會拒絕覆蓋已被其他操作更新的行程。時段重疊會警告，但仍由使用者確認。

## 快速開始（Vercel 優先）

1. **準備金鑰**
   - OpenAI API key（[platform.openai.com](https://platform.openai.com/)）。
   - LINE Messaging API channel 的 `LINE_CHANNEL_ACCESS_TOKEN` 與 `LINE_CHANNEL_SECRET`（[LINE Developers](https://developers.line.biz/)）。
   - SerpAPI key（預設開啟搜尋；若不使用搜尋，請設 `ENABLE_SEARCH=false`）。
   - Supabase Postgres 的 pooler `DATABASE_URL`、CA 與 `DATA_ENCRYPTION_KEY`。
2. **部署到 Vercel**
   - 在 Vercel 匯入本 repo。
   - 到專案設定填入環境變數；6.0 起 LINE、OpenAI、Supabase durable runtime 都是必要前置條件。
   - 要使用生圖功能，請在 Vercel Storage 建立並連結 Blob store。
3. **套用資料庫與檢查 runtime**
   - 先跑 `npm run db:migrate` 套用 `0001`–`0019`，再跑 `npm run db:preflight`。
4. **設定 LINE webhook**
   - 部署後取得網址，把 `{你的網址}/webhook` 設為 LINE channel 的 Webhook URL 並啟用。
5. **開始聊天**
   - 把 LINE 官方帳號加為好友，傳訊息即可。

Supabase Postgres 與 `0001`–`0019` migrations 是 6.0 的必要 runtime，不再有同步或 Vercel env storage fallback；DB 不可用、缺必要環境變數或 migration 落後時，健康檢查與 webhook 會 fail closed。提醒另以 Supabase Cron 每分鐘呼叫受 secret 保護的 worker endpoint。任務與天氣分別以 `ENABLE_TASKS`、`ENABLE_WEATHER` 開啟。Google Calendar／Tasks 需建立 Web OAuth client、把憑證設為 Vercel Production Sensitive env，並在**同一個 Google Cloud project** 分別啟用 **Google Calendar API** 與 **Google Tasks API**；只有 OAuth scope 不代表 Tasks API 已啟用。請依 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#完整上線順序) 的上線檢查表操作；**先啟用 API、套 migration 與 Cron，再開 flags 並 Redeploy**。長期使用 Calendar 時應把 OAuth app 發布為 **In Production**，避免 Testing 模式的授權與 refresh token 7 天到期。開啟 `ENABLE_GOOGLE_TASKS` 後須重新傳送 `連結 Google 行事曆`，授予 Tasks scope 並自動回填既有未同步任務；若曾因 API 未啟用而失敗，先啟用 API，再重新連結，`rc.5` 會安全重排同一個 dead sync job，不建立第二筆任務。

環境變數完整清單見 [`.env.example`](.env.example)；預設值見 `config/index.js`。

## 本機開發

需要 Node.js 24。

```bash
npm ci
cp .env.example .env    # 填入你的金鑰
npm run dev             # nodemon 起本機 Express
npx eslint .            # ESLint flat config
npm test                # jest
```

本機起服務後，LINE webhook 需要對外可達的 HTTPS 網址，可用 ngrok / cloudflared 等把本機 port 打通。細節、架構圖與部署說明見 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

## 專案結構

```text
.
├── api/index.js          # webhook 入口（Vercel serverless / 本機 Express）
├── app/                  # 事件 → context → handlers/commands（指令實作）
├── services/             # OpenAI / LINE / Google Calendar / queue 等服務
├── repositories/         # Supabase Postgres repositories
├── db/                   # migrations / rollbacks
├── config/index.js       # 環境變數單一讀取點
├── constants/ contracts/ locales/ middleware/ utils/
├── tests/                # jest 測試
├── docs/                 # ROADMAP / DEVELOPMENT / DECISIONS
├── REVIEW.md             # 最新一次專案覆核
├── README.md / README.en.md
├── AGENTS.md / CLAUDE.md / SKILL.md   # AI 接手指引
├── NOTICE.md / LICENSE / CHANGELOG.md
└── Dockerfile / docker-compose.yaml / vercel.json
```

## 專案方向與路線圖

本專案維持 **OpenAI + LINE、自架、自備 API key** 的核心，並已決定分階段發展為個人助理；不整套重寫，也不把其他供應商改成預設。完整依賴順序、資料模型、模型／API、參考架構與授權邊界見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

### 已完成

- **安全加固**：webhook 缺 `LINE_CHANNEL_SECRET` 時 fail closed、`.env.example` 預設 `APP_DEBUG=false`、加上 CodeQL 掃描與 Dependabot 自動更新、相依漏洞清零。
- **6 個 bug 修復**：群組 `forget` 沒清歷史、搜尋無結果會 crash、版本指令拖垮整批回覆、健康檢查路由掛住、`stop` sequences 從未送出、語音暫存檔洩漏。
- **Durable source 狀態**：使用者／群組的啟停狀態只保存 deployment-scoped HMAC 代碼並由 Postgres 原子限制數量；不保存 LINE 原始 ID 或名稱。
- **升級預設模型**：對話 `gpt-4o-mini`、生圖 `gpt-image-2`（`low` 品質）、語音 `gpt-4o-mini-transcribe`（皆走環境變數可設定）。
- **能力 feature flags**：`ENABLE_IMAGE_GENERATION` / `ENABLE_TRANSCRIPTION` / `ENABLE_VISION` / `ENABLE_SEARCH` 個別控成本。
- **對話 TTL**：`APP_MAX_PROMPT_AGE` 讓久未互動的對話 context 自動過期（預設停用，設秒數啟用）。
- **CI + 徽章**：GitHub Actions 每次 push 跑 eslint + jest；README 顯示 CI / CodeQL 即時狀態徽章。
- **群組回覆政策**：`GROUP_REPLY_REQUIRES_MENTION` 讓群組需點名才回，減少噪音（預設關）。
- **LINE 送達 checkpoint**：reply 失敗只重送已保存結果，不重跑付費 AI，也不自動改用計額度的 Push API。
- **網址摘要**：`ENABLE_URL_SUMMARY`（預設關）遇訊息含網址時，經 SSRF-safe 抓取網頁作為摘要上下文；殘留風險見 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
- **GPT Image 支援**：預設 `gpt-image-2`，base64 圖片上傳 private Vercel Blob，再以限時 signed URL 交給 LINE；可用環境變數調整模型與品質。設定見 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
- **Webhook 防重送**：LINE redelivery 與重複 `webhookEventId` 不會再次處理，避免長耗時功能重複計費與回覆。
- **Durable 基礎（Phase 0）**：Supabase Postgres、原子入列的 webhook 冪等、帶 lease fencing 的 job queue、AES-256-GCM 加密的 job payload、HMAC 化的使用者代碼。6.0 固定走 durable queue；事件缺 ID、DB 故障或 migration 落後時拒絕 ACK，交由 LINE redelivery。
- **行程與提醒（Phase 1 + Phase 3 + Google Calendar 雙向同步）**：一句話（文字或**語音**）建行程，日期／星期與明確鐘點由程式依使用者時區解消，模糊時間以 durable 結構化草稿追問。`每天 22:40 例行檢查`、`每週五下午三點整理週報` 可直接建立週期草稿，確認卡會明列重複規則。新增與修改都先確認，row lock 與 optimistic version 防重複或過時覆蓋；重疊時先警告。Google 模式可新增、修改回寫、列表、完成與刪除；**inbound 同步**（`ENABLE_GOOGLE_CALENDAR_INBOUND`）以 sync token 輪詢回收 Google 端的刪除與 timed 行程修改，並與 LINE 提醒去重。
- **語音建行程（Phase 4）**：LINE 語音訊息轉錄後走與文字相同的 event-draft→確認流程，確認卡回顯「🎤 我聽到：…」讓使用者分辨聽錯／解析錯。圖片建行程決定不做。
- **任務（Phase 2 + Google Tasks 雙向同步）**：獨立保存於 Supabase 助理待辦；`ENABLE_GOOGLE_TASKS` 開啟時新增／完成／重開／刪除會同步到 Google Tasks（與 Calendar 共用 OAuth），`ENABLE_GOOGLE_TASKS_INBOUND` 開啟時 Google 端的完成／重開、刪除、標題、備註也會回收到本地（`due` 不回收，精確期限以本地為權威）。自然語言期限依使用者時區解析，支援優先度、標籤、今天／明天／本週／下週／逾期／已完成篩選、分頁，以及 owner-scoped 完成、重開與刪除。未知篩選會回覆可用選項，不會退回全部任務造成假成功。
- **提醒偏好（Phase 3）**：到點提醒、安靜時段、暫停／恢復、陳舊提醒跳過與 retry key；`REMINDER_OFFSETS` 可設最多五個提前提醒，週期行程的每次 occurrence 也會套用。
- **天氣（Phase 6）**：Open-Meteo 現況與 1–7 日預報、同名地點座標追問，以及每日訂閱推播（`ENABLE_WEATHER_PUSH`，重用同一 scheduler）。
- **搜尋來源標註（Phase 7）**：`search` 在 AI 整理段下附「📎 來源」清單（標題／來源站／時間／連結）；來源只顯示、不進 prompt。
- **Run trace（Phase 0）**：每次 AI 執行記錄能力／模型／token／估算成本／耗時／狀態，不含對話內容或憑證。
- **Durable checkpoint**：把「AI 已完成」與「LINE 已送達」拆成兩個 checkpoint，語意是 **AI 至多執行一次、送達可重試多次**——失敗重試只會重送，不會重複付費，也不會產生重複訊息。

### 6.0 release candidate

- **`6.0.0-rc.8`**：Calendar inbound 改以非展開的 recurring series 建立 sync cursor，忽略 recurrence instances，並由 `0019` 讓既有 v1 cursor 安全重建；避免無截止日的每日行程展開後拖垮 Cron。正式 `6.0.0` 仍須完成剩餘集中 LINE／Google 驗收，見 [`REVIEW.md`](REVIEW.md) 與 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
- **Google contract 邊界**：Calendar outbound CRUD 與 mapped timed non-recurring inbound、Tasks mapped inbound/outbound 已納入契約；Calendar 全天 inbound、recurrence exception、Google-origin 建立，以及 Tasks due 回收仍明確不支援。
- **模型與 API 進一步升級**——首輪已完成；新模型等待實作前對官方文件重核，見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
- **吸收 fermi 架構經驗**——分階段重做可靠性、持久化、觀測性；不直接合併 fermi 原始碼。
- **Claude 版助理**——未來可能，可能開新專案或在此 repo 分支，方式待定。

### 已排除方向

- **OpenAI / ChatGPT 訂閱 OAuth 取代 API key**——官方目前將 ChatGPT 訂閱與 API 分開計費與管理；此 repo 不把第三方 LINE bot 設計成消耗 ChatGPT 訂閱額度的 OAuth app。細節見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
- **CalDAV / Apple / ICS 互通（原 Phase 5B）**——個人單一 Google 帳號情境下，Google Calendar 雙向同步已覆蓋需求；跨協定互通維護成本高於效益，決定不做。
- **行程分享與群組協作（原 Phase 8）**——維持個人單人助理定位，不做分享連結與群組權限模型。
- **多頻道 adapter（原 Phase 9）**——LINE 為唯一主頻道並已最佳化其 UX，不抽多頻道 delivery 抽象。
- **搜尋主題追蹤主動推播（原 Phase 7 一項）**——搜尋維持使用者主動即問即答，不做定時主題摘要推播。
- **多來源交叉比對／標註分歧（原 Phase 7 一項）**——需抓來源原文比對事實、CP 值偏低且提高注入與成本風險；搜尋維持單一答案＋來源連結呈現。
- **圖片（海報／票券／截圖）建行程（原 Phase 4 一項）**——vision 擷取信心／欄位缺漏／多活動確認複雜且受圖片品質影響大；手打或語音已足夠。圖片維持看圖聊天，不接行程擷取。（**語音建行程已實作**。）
- **批次建立多筆行程（原 Phase 1 一項）**——需多草稿與逐項／整批確認的新狀態機，個人單人情境價值低；逐筆新增或週期行程已覆蓋大部分需求。

以上七項於 2026-07-17 決定不實作，詳見 [`docs/ROADMAP.md`](docs/ROADMAP.md) 各 Phase 段落與「明確不做」。

決策脈絡見 [`docs/DECISIONS.md`](docs/DECISIONS.md)；Phase 狀態與現況見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 文件

- 文件站（中文）：<https://sanhsien.github.io/gpt-ai-assistant-docs/>
- 文件站（English）：<https://sanhsien.github.io/gpt-ai-assistant-docs/en/>
- 本 repo 維護文件：[產品路線圖與技術評估](docs/ROADMAP.md)、[開發與部署](docs/DEVELOPMENT.md)、[決策紀錄](docs/DECISIONS.md)

> 文件站源自上游 [`memochou1993/gpt-ai-assistant-docs`](https://github.com/memochou1993/gpt-ai-assistant-docs)（VuePress），現獨立維護並以 GitHub Pages 發佈。上游原站：<https://memochou1993.github.io/gpt-ai-assistant-docs/>。

## 其他可參考專案

本專案只就概念、規格或部署流程參考若干服務與開源專案（LINE／OpenAI 官方文件、其他繁中 LINE bot、fermi、Toki 等），**未包含它們的任何原始碼**；GPL／FSL／無授權專案不併入本 MIT repo。完整清單、授權與「各自啟發了什麼」見 [`NOTICE.md`](NOTICE.md) 的 Credits 表；技術評估見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 專案來源與致謝

本專案源自 [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant)（作者 Memo Chou，MIT）。感謝原作者與所有[貢獻者](https://github.com/memochou1993/gpt-ai-assistant/graphs/contributors)。來源、授權與第三方聲明見 [`NOTICE.md`](NOTICE.md)。

上游於 2026-06-08 以 [`d84c806`](https://github.com/memochou1993/gpt-ai-assistant/commit/d84c806b8368ded9d790067235827cdac32a23ab) 將過時的 News 區塊改為 fermi 接班指引；本專案的來源脈絡包含該版本，但公開 Git 歷史已於 2026-07-18 以目前獨立維護快照重新初始化。目前不安排回貢上游，活躍度與決策見 [`docs/ROADMAP.md`](docs/ROADMAP.md#上游活躍度與回貢決策)。

## 授權

[MIT](LICENSE) — 保留原始 MIT 授權與對上游的 attribution。目前不轉 FSL-1.1-MIT；授權策略與未來轉標條件見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
