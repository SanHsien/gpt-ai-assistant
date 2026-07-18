# Development

維護者與 AI 接手用的單一開發文件：架構、本機指令、環境變數、部署。使用者導向說明在根目錄 [`README.md`](../README.md)；決策紀錄在 [`DECISIONS.md`](DECISIONS.md)；Phase 狀態與範疇在 [`ROADMAP.md`](ROADMAP.md)。

## 架構

```text
LINE 使用者
   │  傳訊息
   ▼
LINE Messaging API ──webhook──▶ api/index.js（Vercel serverless / 本機 Express）
                                     │
                                app/app.js  收 events、過濾（text/audio/audio-file/image）
                                     │
                                app/context.js  建 Context（帶 bot / event / 使用者狀態）
                                     │
              app/handlers/*  +  app/commands/*  依序嘗試處理指令
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
 services/openai.js           services/serpapi.js          services/line.js
 （completion / image /       （網路搜尋，可選）           （reply / vision 取圖）
   vision）
                                     │
                                回覆 LINE（reply message）
```

所有外部串接集中在 `services/`，設定集中在 `config/index.js`（凍結物件，唯一讀環境變數的地方）。

### 個人助理架構（部分已上線）

下列基礎中的 webhook DB 冪等、durable queue、worker、durable 行程追問／確認，bot 管理 event 的 Google Calendar 新增／修改回寫，以及每分鐘 Supabase Cron 已上線：

```text
webhook 驗簽／DB 冪等／enqueue／快速 ACK
                         │
                         ▼
               durable queue + worker
                         │
       capability router + 結構化草稿確認
                         │
                         ▼
            Supabase Postgres repositories
                         ▲
                         │
             scheduler（提醒／天氣／追蹤）
```

新功能不得把行程、任務、提醒、OAuth token 或 jobs 寫入 Vercel env。Google Calendar OAuth 是日曆資料授權，與禁止使用 ChatGPT 訂閱 OAuth 取代 OpenAI API key 是兩件不同的事。

### 目錄職責

| 目錄 / 檔案 | 職責 |
|------|------|
| `api/index.js` | 入口：掛 webhook，Vercel 把所有路由 rewrite 到 `/api`（見 `vercel.json`） |
| `app/app.js` | 收 LINE events、過濾訊息型別、逐一交給 handler pipeline |
| `app/context.js` | 建立單則訊息的處理 context |
| `app/handlers/` | 各指令的高階處理流程（activate / talk / draw / search / continue / retry / forget / report / version / deploy / doc…） |
| `app/commands/` | 指令定義與對應 prompt（bot-* / sum-* / analyze-* / translate-* / sys-*） |
| `app/models/` | `bot` / `event` / `context` 等資料模型 |
| `app/messages/` | 回覆訊息型別（text / image / template） |
| `app/history/` | 對話歷史（記憶體內，受 `APP_MAX_PROMPT_MESSAGES` 限制） |
| `services/openai.js` | OpenAI completion / image generation / vision client |
| `services/line.js` | LINE Messaging API client（reply、取圖） |
| `services/serpapi.js` | SerpAPI 搜尋 client（`search` 指令用） |
| `services/vercel.js` | 觸發 Vercel deploy hook（`deploy` 指令自我重新部署用） |
| `services/google-calendar.js` | Google Web OAuth、token refresh、Calendar CRUD 與同步 job |
| `repositories/` | Supabase Postgres data access；所有 owner boundary 與 transaction 集中在此 |
| `db/migrations/` / `db/rollbacks/` | `0001`–`0019` schema migration 與 latest-only rollback |
| `config/index.js` | 所有環境變數的單一讀取點與預設值 |
| `constants/` | 常數 | `locales/` | 多語系字串（zh / en / ja） |
| `middleware/` | Express middleware | `contracts/` | 外部 provider 能力與衝突契約 |
| `utils/` | 共用工具 | `tests/` | jest 測試 |

## 本機開發

需要 Node.js 24（與 CI、Vercel 及 Docker image 一致）。

```bash
npm ci
npx eslint .          # ESLint flat config（見 eslint.config.js；無 npm script）
npm test              # jest（見 tests/）
npm run dev           # nodemon api/index.js，本機起 Express
```

本機起服務後，LINE webhook 需要對外可達的 HTTPS URL。開發時可用 ngrok / cloudflared 之類把本機 port（`APP_PORT`，預設環境變數）打通，再把該 URL 設為 LINE channel 的 webhook。

## 環境變數

完整清單見 [`.env.example`](../.env.example)；程式端預設值見 `config/index.js`。關鍵項目：

| 變數 | 說明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI 金鑰（必填） |
| `OPENAI_COMPLETION_MODEL` | 對話模型，預設 `gpt-4o-mini`（原 `gpt-3.5-turbo`）；新模型評估見 [`ROADMAP.md`](ROADMAP.md) |
| `OPENAI_IMAGE_GENERATION_MODEL` | 生圖模型，預設 `gpt-image-2`。GPT Image 回傳 base64，程式會自動上傳 private Vercel Blob，取得 LINE 可讀的限時 signed URL。可明確設回 deprecated 的 `dall-e-3` 作短期 fallback。 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 讀寫 token；**選用**。在 Vercel 連結 Blob store 後，會注入 `BLOB_STORE_ID` 並由 `@vercel/blob` 走 OIDC 自動認證，**通常不需要**此 token。只有本機/非 Vercel 環境，或想用靜態 token 時才設定。 |
| `OPENAI_IMAGE_GENERATION_SIZE` | 生圖尺寸，預設 `1024x1024`。 |
| `OPENAI_IMAGE_GENERATION_QUALITY` | 生圖品質。GPT Image 預設 `low` 以控制成本；若明確改用 DALL-E 且未設定此值，程式會用相容的 `standard`。GPT Image 可設 `low` / `medium` / `high` / `auto`。 |
| `OPENAI_IMAGE_GENERATION_TIMEOUT` | 生圖 API timeout，預設 `55000` 毫秒；獨立於其他 OpenAI 呼叫，配合 Vercel Hobby 非 Fluid Compute 的 60 秒上限。 |
| `OPENAI_VISION_MODEL` | 影像理解模型，預設 `gpt-4o`；低成本候選見 [`ROADMAP.md`](ROADMAP.md) |
| `OPENAI_TRANSCRIPTION_MODEL` | 語音轉錄模型，預設 `gpt-4o-mini-transcribe`（原硬編 `whisper-1`，可設回 `whisper-1` 或升 `gpt-4o-transcribe`） |
| `TRANSCRIPTION_MAX_BYTES` | LINE 語音／桌面音訊檔下載與轉錄上限，預設 25 MiB；檔案訊息先檢查 metadata，下載後再檢查實際 buffer。 |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` | LINE channel 憑證（必填） |
| `DATABASE_URL` | Supabase Postgres transaction pooler URI。Production queue 與行程功能必填。 |
| `DATABASE_SSL_CA` | Supabase Dashboard 下載的 CA PEM；Supabase URL 缺少此值時 DB 連線 fail closed。Vercel 可保存 multiline PEM，`.env` 也可用 `\n`。 |
| `DATA_ENCRYPTION_KEY` | 32-byte base64 key；AES-256-GCM 加密 durable job payload、OAuth 憑證與提醒用 LINE target，並以 HMAC 代碼取代原始 LINE user id。不可任意輪換或遺失，否則既有密文無法解密。 |
| `APP_WEBHOOK_PATH` | webhook 路徑，預設 `/webhook` |
| `APP_DEBUG` | 本機 debug 才開啟；production 請維持 `false`，避免 prompt / history 類對話內容進入平台 log |
| `APP_LANG` | 介面語言：`zh_TW`（預設、正式支援）、`zh`、`zh_CN`、`en`、`ja`；後四者限制見下方 |
| `APP_MAX_PROMPT_AGE` | 對話脈絡最大存活秒數，預設 `0`（停用）。設為正整數（例如 `3600`）時，距上次互動超過此秒數的對話 context 會在下次讀取時自動過期換新，避免很久以前的內容影響新對話並控制 token 成本。實作見 `app/prompt/index.js`、`app/prompt/prompt.js`。 |
| `SERPAPI_API_KEY` | 啟用 `search` 指令才需要 |
| `ENABLE_WEATHER` | 天氣查詢（`天氣 <地點>`），預設 `false`。資料來自 **Open-Meteo**（免費、無需 API key、CC-BY），`services/weather/` 為 facade + adapter，固定官方網域無 SSRF 疑慮。台灣常用縣市簡稱會確定性補足行政區與國家後重試。`WEATHER_FORECAST_DAYS`（1–7，預設 5）、`WEATHER_CACHE_TTL`（秒，預設 600，同地點＋天數共用快取）。provider 失敗時明確回報、不送過期資料冒充即時。同名不同行政區（如 `嘉義`）以座標綁定 postback 追問。 |
| `ENABLE_WEATHER_PUSH` | 每日天氣推播，預設 `false`。需同時開 `ENABLE_WEATHER`、套用 `0010_weather_subscriptions.sql`，並沿用提醒的每分鐘 Supabase Cron（`REMINDER_CRON_SECRET`）。`每日天氣 <地點> <幾點>` 訂閱、`取消每日天氣`、`我的天氣訂閱`。cron `/cron/reminders` 每分鐘 `enqueueDueWeatherReminders`（原子 claim 到期訂閱＋入列 `weather-daily` job，同一交易），worker 走既有 queue／drain，Push 沿用 `X-Line-Retry-Key` 冪等；**不另建第二套 cron**。`WEATHER_DAILY_DEFAULT_HOUR`（0–23，預設 7）、`WEATHER_DAILY_MAX_PER_RUN`（預設 50）。實作見 `services/weather-subscription.js`、`repositories/subscriptions.js`。 |
| `ENABLE_IMAGE_GENERATION` / `ENABLE_TRANSCRIPTION` / `ENABLE_VISION` / `ENABLE_SEARCH` | 能力開關，預設全開（`true`）。設為 `false` 可關閉對應能力控成本——生圖（`draw`）與搜尋（`search`）會回覆「功能已停用」；語音、看圖事件在 context 初始化時就短路回覆。實作見 `config/index.js`、`app/handlers/draw.js`、`app/handlers/search.js`、`app/context.js`。 |
| `GROUP_REPLY_REQUIRES_MENTION` | 群組回覆政策，預設 `false`（維持原行為：群組啟用自動回覆後回應所有訊息）。設為 `true` 時，群組中必須以指令或 bot 名稱點名才回應一般訊息，減少群組噪音。實作見 `app/handlers/talk.js`。 |
| `ENABLE_URL_SUMMARY` | 網址摘要，預設 `false`（關閉）。設為 `true` 時，若對話訊息含 http(s) 網址，會經 SSRF-safe 抓取（`utils/fetch-url.js` → `utils/assert-safe-url.js` → `utils/is-private-ip.js`）取得網頁純文字，作為對話上下文交給模型摘要/回應。相關限制：`URL_FETCH_TIMEOUT`（毫秒，預設同 `APP_API_TIMEOUT`）、`URL_FETCH_MAX_BYTES`（預設 1000000）、`URL_FETCH_MAX_CHARS`（預設 5000）。⚠️ 見下方安全說明後再決定是否開啟。 |
| `ENABLE_SCHEDULE` | 行程功能，預設 `false`，須先套用 `0001`–`0006`。明確指令或日期開頭敘述會進草稿；模糊日期／時間會以結構化 workflow 追問。另提供 `我的行程`、`修改行程`、完成、刪除、同步失敗處理與 `設定時區 <IANA>`。相關：`SCHEDULE_DEFAULT_TIMEZONE`、`SCHEDULE_MAX_TOKENS`、`SCHEDULE_CONFIRM_TTL`。 |
| `ENABLE_TASKS` | 任務／待辦，預設 `false`，須先套用 `0007`＋`0008` 並設好 `DATABASE_URL`。任務獨立存於 Supabase `tasks` 表，不是 Google Calendar event；是否另同步 Google Tasks 由 `ENABLE_GOOGLE_TASKS` 控制，成功訊息會明示目前資料邊界。`新增任務 <文字>` 以 OpenAI structured output 解析期限與優先度，再由程式依使用者時區校正相對日期，正則提取並正規化 `#標籤`；`我的任務` 支援今天／今日、明天／明日、本週／本周、下週／下周、逾期／已完成／標籤篩選。各日期範圍使用個人時區的半開起訖，不混入其他日期；一週固定週一開始、週日結束。新增語句只有「本週／這週」而沒有星期幾時固定為本週日 09:00，「下週」固定為下週日 09:00。未知列表參數 fail closed，回覆可用篩選而不查詢全部。`TASK_LIST_LIMIT` 控制每頁 `1`–`6` 筆；完成、刪除、重開皆冪等且 owner-scoped。title／期限修改走刪除重建。 |
| `ENABLE_REMINDERS` | 到點 LINE 提醒，預設 `false`。開啟前須套用 `0005_reminders_and_completion.sql`（偏好指令另需 `0009_reminder_prefs.sql`），設定 `REMINDER_CRON_SECRET`，並以 `npm run db:configure-reminders` 建立每分鐘 Supabase Cron。`REMINDER_WORKER_MAX_JOBS` 預設 `20`；`REMINDER_WORKER_TIME_BUDGET_MS` 預設 `45000`，到期即把剩餘 durable jobs 留到下一分鐘。**Delivery 策略**：暫停期間跳過不補發；超過 `REMINDER_STALE_MINUTES` 跳過；安靜時段延後。**多重／週期提醒**：`REMINDER_OFFSETS`（逗號分隔提前分鐘，去重、上限 5、每個最多一年）會套到每個 occurrence。所有提醒以 durable job key 統一追蹤；修改、Google inbound 改時間與完成都取消整個事件 prefix 後重排，不另維護索引表。 |
| `ENABLE_GOOGLE_CALENDAR` | Google Calendar 行程操作，預設 `false`。開啟前須套用 `0004_google_calendar.sql`；修改 workflow 另需 `0006_schedule_workflows.sql`。設好 OAuth env 與每分鐘 Cron 後，新增、`修改行程`、`我的行程`、完成與刪除以 Google Calendar 為操作面。`連結 Google 行事曆` 走 PKCE OAuth；`解除連結 Google 行事曆` 向 Google 撤銷 token（`OAuth2Client.revokeCredentials`）並刪除本地 `calendar_accounts` envelope——撤銷失敗（token 已過期／已撤銷）不阻擋本地刪除。 |
| `ENABLE_GOOGLE_TASKS` | 任務 outbound 同步到 Google Tasks，預設 `false`。需先在 OAuth client 所屬的**同一 Google Cloud project 啟用 Google Tasks API**（授予 `tasks` scope 不會自動啟用 API），並套用 `0011_task_sync.sql`；**既有僅授權 Calendar 的使用者需重新 `連結 Google 行事曆`**。OAuth callback 會自動回填既有未同步任務。新增／完成／重開／刪除會入列 `google-tasks-sync` job；同步 worker 以 task row lock 序列化，刪除與 outbox 同 transaction。Google Tasks insert 不接受自訂 ID，因此 notes 會附加 `[gpt-ai-assistant:<本機任務 ID>]` 同步標記，建立前以此找回結果不明確的先前 POST，避免重試產生重複任務。4xx／未連結不重試，失敗只記 `sync_status='error'`、本機任務不刪；`rc.5` 起，修正永久設定錯誤後重新 OAuth backfill 會只將相同 idempotency key 的 dead job 重排，不碰 pending／processing／done，也不建立第二筆任務。`due` 依任務時區取當地日期，精確時間仍存本機。`GOOGLE_TASKS_LIST_ID` 預設 `@default`。實作見 `services/google-tasks.js`、`services/google-tasks-queue.js`。 |
| `ENABLE_GOOGLE_TASKS_INBOUND` | Google Tasks → 本地反向同步，預設 `false`。需套用 `0014_tasks_inbound.sql` 與開 `ENABLE_GOOGLE_TASKS`。Google Tasks 無 sync token，以 `updatedMin` 增量輪詢回收 Google 端的**完成／重開、刪除、標題、備註**（**不回收 `due`**，精確期限以本地為權威）。衝突政策對稱 Calendar inbound：本地 `sync_status='synced'` 才吃外部改、`pending` 讓 outbound 先贏、notes 同步標記剝除後相同視為 echo 不動作、套用設 `synced` 防迴圈、不建立 Google-origin 新任務。重用 `/cron/reminders`、節流 `TASKS_INBOUND_INTERVAL`（每帳號秒數）與 `TASKS_INBOUND_MAX_PER_RUN`。實作見 `services/google-tasks-inbound.js`、`repositories/tasks.js` 的 `applyInboundTaskUpdate`。 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud 的 Web application OAuth client 憑證；只放部署平台 Sensitive env，不可提交。 |
| `GOOGLE_OAUTH_REDIRECT_URI` | OAuth callback 完整 HTTPS URL，例如 `https://example.vercel.app/oauth/google/callback`；必須與 Google Cloud Authorized redirect URI 完全一致。 |
| `GOOGLE_CALENDAR_ID` | 目標 calendar id，預設 `primary`。目前 scope 是 `calendar.events.owned`，指定日曆必須由使用者擁有。 |
| `GOOGLE_OAUTH_STATE_TTL` | 一次性 state／PKCE verifier 有效秒數，預設 `600`。 |
| `GOOGLE_REQUEST_TIMEOUT_MS` | Google token refresh 與 Calendar／Tasks API 單次 HTTP timeout，預設 `10000` 毫秒；應低於 cron function 時限。 |
| `VERCEL_*` | `deploy` 指令自我重新部署用（access token / project / deploy hook） |

⚠️ 金鑰一律走環境變數或部署平台設定，**不要寫死進程式碼、不要提交 `.env`**。正式環境也不要開啟 `APP_DEBUG`。

### 網址摘要（`ENABLE_URL_SUMMARY`）的安全考量

此功能會讓 bot 抓取使用者訊息中的外部網址，屬於安全敏感路徑，因此**預設關閉**。已內建的防護：僅允許 http/https、拒絕解析到私有/迴環/link-local/保留 IP 的主機（SSRF 防護）、禁止 redirect（`maxRedirects: 0`）、限制大小與逾時、僅接受 `text/html`／`text/plain`，並以 `html-to-text` parser 取出文字（不以 regex 過濾 HTML tag）。

仍有的**殘留風險**，開啟前請評估：

- **DNS rebinding（TOCTOU）**：`assert-safe-url` 解析並檢查 IP 後，實際連線時 axios 會再解析一次，兩次之間位址可能被改成內網位址。目前未做 IP pinning，故不完全防 rebinding。
- **不支援 redirect**：為避免 redirect-based SSRF，會直接失敗（不追 3xx）；會 redirect 的網址請改貼最終網址。
- **Prompt injection**：抓回的網頁內容會進入模型 prompt，惡意頁面可能夾帶指令。摘要情境下已用固定模板包裝，但非完全免疫。

建議：僅在信任使用者的自架情境開啟；若要用於開放場域，應再加 IP pinning、允許網域白名單與更嚴格的內容過濾。

### 使用 GPT Image（Vercel Blob 圖片儲存）

預設生圖使用 **GPT Image 2（`gpt-image-2`）**。Image API 回傳 base64，LINE image message 則需要不帶 store credential 即可讀取的 HTTPS URL，因此本專案由 `utils/upload-image.js` 上傳到 **private Vercel Blob**，再簽出只允許該 pathname GET、約 7 天有效的 URL 給 LINE。預設品質是 `low`，適合聊天機器人的成本與速度取向；需要較精細結果時可調成 `medium` 或 `high`。

啟用步驟：

1. 在 Vercel 專案的 **Storage** 建立一個 **Blob** store 並連結到此專案。新版 Vercel 會注入 `BLOB_STORE_ID`（＋ webhook 相關），`@vercel/blob` 在 Vercel 上會用 **OIDC 自動認證**，**通常不需要** `BLOB_READ_WRITE_TOKEN`。
2. 確認 OpenAI organization 已具備 GPT Image 使用權限；部分帳號可能需要先完成 organization verification。
3. 重新部署。未設定 `OPENAI_IMAGE_GENERATION_MODEL` 時會直接使用 `gpt-image-2`。

限制與注意：

- **不會自動清除**：上傳的圖片會留在 Blob，長期會累積，受 Vercel 免費額度限制。要控管可另外加定期清除或改用有 TTL 的儲存。
- Signed URL 在有效期內，任何持有網址的人都能讀取該張圖片；不要用生圖功能處理敏感內容。
- 若部署 log 出現 `No blob credentials found`（表示 OIDC 未生效），再到 Blob store 產生 Read-Write Token，設為 `BLOB_READ_WRITE_TOKEN` fallback。
- `dall-e-3` 已被 OpenAI 標為 deprecated，只保留短期相容性，不再作預設。

## 部署（Vercel 優先）

原架構以 Vercel serverless 為主（`vercel.json` 把所有路由 rewrite 到 `/api`，function `maxDuration` 60s，讓 GPT Image 有足夠完成時間）。

1. 在 Vercel 匯入本 repo。
2. 在 Vercel 專案設定環境變數（至少 `OPENAI_API_KEY`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`）。
3. 部署後取得 URL，把 `{URL}{APP_WEBHOOK_PATH}`（預設 `/webhook`）設為 LINE channel 的 webhook URL。
4. `deploy` 指令可透過 `VERCEL_DEPLOY_HOOK_URL` 觸發重新部署（選用）。

### 完整上線順序

以下順序是新部署者從空白帳號上線完整功能的權威檢查表。不要先開依賴資料表或 Cron 的功能旗標；Vercel 修改環境變數後也不會自動重建既有 deployment，必須手動 **Redeploy** 或推送新 commit。

1. **先準備 durable runtime**：fork 或 clone repo、匯入 Vercel，將 `APP_DEBUG=false`。建立 Supabase Postgres，取得 transaction pooler URL 與 Dashboard 提供的 CA PEM；產生 32-byte base64 `DATA_ENCRYPTION_KEY`。把這三者、`OPENAI_API_KEY`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`，以及預設搜尋所需的 `SERPAPI_API_KEY` 設為 Production Sensitive env。不使用搜尋時明確設 `ENABLE_SEARCH=false`。
2. **先套用 schema，再部署 6.0**：連線資訊只放未追蹤的本機 `.env` 與 Vercel Production Sensitive env，接著在 repo 根目錄執行：

   ```bash
   npm ci
   npm run db:migrate
   npm run db:preflight
   ```

   指令會依序套用目前所有 migration，並在 `schema_migrations` 保存 SHA-256；重跑時 checksum 相符會安全略過。到 Supabase SQL Editor 執行 `select name, applied_at from schema_migrations order by name;`，確認最後一筆是 repo 當前最新 migration（6.0 RC 為 `0019_calendar_sync_query_version.sql`）。不要只在 SQL Editor 貼 DDL 而漏掉 `schema_migrations` 紀錄。`db:preflight` 也會檢查所有已啟用能力需要的憑證。
3. **設定每分鐘 worker**：在 Vercel Production Sensitive env 建立至少 32 字元的 `REMINDER_CRON_SECRET`；本機暫時設相同值與 `REMINDER_CRON_URL=https://你的穩定網域/cron/reminders`，執行 `npm run db:configure-reminders`。到 Supabase Cron Jobs／History 確認 `gpt-ai-assistant-reminders` 為 active、每分鐘有成功紀錄。
4. **設定 Google**：在 Web OAuth client 所屬的同一 Google Cloud project 啟用 **Google Calendar API**；要同步任務時必須另外啟用 **Google Tasks API**。OAuth 同意畫面出現 Tasks scope 只代表使用者授權，**不代表 API 已啟用**。設定 External OAuth consent screen，建立 Web application client，Authorized redirect URI 必須逐字等於 `https://你的穩定網域/oauth/google/callback`。將 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_OAUTH_REDIRECT_URI` 設為 Vercel Production Sensitive env。
5. **最後才開功能旗標**：依需要在 Vercel Production 設 `ENABLE_SCHEDULE=true`、`ENABLE_REMINDERS=true`、`ENABLE_TASKS=true`、`ENABLE_WEATHER=true`、`ENABLE_GOOGLE_CALENDAR=true`、`ENABLE_GOOGLE_TASKS=true`、`ENABLE_GOOGLE_CALENDAR_INBOUND=true`、`ENABLE_GOOGLE_TASKS_INBOUND=true`。每日天氣推播另開 `ENABLE_WEATHER_PUSH=true`。6.0 沒有 `APP_WEBHOOK_QUEUE`；durable queue 永遠啟用。
6. **Redeploy 與重新授權**：Redeploy Production，確認根路由回 `200`、Vercel Function Logs 沒有 `RUNTIME_CONFIG_MISSING`／`DATABASE_MIGRATION_REQUIRED`，Cron 對新 deployment 的 `/cron/reminders` 回 `200`。最後在 LINE 傳 `連結 Google 行事曆`；每次新增 Google scope（例如首次開 Tasks）都要重新授權，callback 才會取得新 scope 並回填未同步資料。

部署或排錯時只記錄環境變數名稱、migration 名稱與 HTTP 狀態；不要把 Database URL、CA、encryption key、LINE／OpenAI／Google token 或 OAuth code 貼到文件、issue、聊天或 log。

### 介面語系支援範圍

`locales/zh.js`、`en.js`、`ja.js` 目前維持相同 key 集合，`APP_LANG` 只接受 `zh_TW`、`zh`、`zh_CN`、`en`、`ja`，其他值會在載入時直接指出允許值。支援等級不是相同的：

- `zh_TW`：正式支援並作為 Production 與 LINE 驗收基準。
- `zh`、`zh_CN`：目前都指向同一份繁體中文字串；`zh_CN` 只是舊相容值，不代表已有簡體中文翻譯。
- `en`、`ja`：實驗性。主要 command label、行程、任務、提醒、完整 `指令` 清單與 Google OAuth HTML 已翻譯；天氣格式仍為繁中，日期／意圖 parser 也以繁中規則最完整。

因此 fork 可以用 `APP_LANG=en` 或 `ja` 做開發與補譯，但在完成各語系的 LINE + OpenAI + Calendar/Tasks + 天氣 E2E、補齊天氣格式與 parser fixture 前，不可宣稱完整非中文部署。README 的英文版是部署文件翻譯，不等同於英文 bot 已正式驗收。

<a id="line-quick-replies-and-optional-rich-menu"></a>

### LINE Quick Reply 與圖文選單（選用）

一般回覆由 `GENERAL_COMMANDS` 附加 LINE Quick Reply。6.0 的完整順序為：`記行程`、`我的行程`、`新增任務`、`我的任務`、`天氣`、`每日天氣`、`查詢`、`請畫`、`連結 Google 行事曆`、`暫停提醒`、`恢復提醒`、`忘記`、`指令`。程式會依 `ENABLE_SCHEDULE`、`ENABLE_TASKS`、`ENABLE_WEATHER`、`ENABLE_WEATHER_PUSH`、`ENABLE_SEARCH`、`ENABLE_IMAGE_GENERATION`、`ENABLE_GOOGLE_CALENDAR`、`ENABLE_REMINDERS` 隱藏未啟用的能力；`忘記`與`指令`永遠保留。Quick Reply 最多 13 項，但 LINE client 只提供單列橫向捲動，程式不能指定換成兩列，而且新訊息出現後按鈕會消失。官方規格見 [Use quick replies](https://developers.line.biz/en/docs/messaging-api/using-quick-reply/)。

傳送 `指令` 會收到一般文字訊息，不再是只有「檢查更新／查看文件／啟停自動回覆／回報問題」的舊四按鈕 template。內容由 `buildCommandHelp()` 依相同 feature flags 產生，分成對話、搜尋、生圖、看圖、語音、行程、任務、提醒、天氣、每日天氣、Google、文字處理、系統與維護等群組，並附可直接輸入的格式與範例；未啟用的群組不會顯示。新增或更名使用者指令時，必須同步更新 `locales/{zh,en,ja}.js` 的 `__TEXT_COMMAND_HELP_*`、相關測試與使用者文件。

需要手機版固定兩列入口的 fork，可在 [LINE Official Account Manager](https://manager.line.biz/) 手動建立大型 3×2 圖文選單；這是選用的 channel 設定，不是環境變數或部署前置條件：

| 區域 | 顯示文字 | 動作類型 | 傳送文字 |
| --- | --- | --- | --- |
| 上左 | 新增行程 | 文字 | `記行程` |
| 上中 | 我的行程 | 文字 | `我的行程` |
| 上右 | 天氣 | 文字 | `天氣` |
| 下左 | 新增任務 | 文字 | `新增任務` |
| 下中 | 我的任務 | 文字 | `我的任務` |
| 下右 | 更多功能 | 文字 | `指令` |

建立流程：主頁 → 圖文選單 → 建立 → 選大型 3×2 版型 → 選單列文字填「常用功能」→ 上傳圖片 → 六區填上表文字動作 → 儲存。聊天優先的 bot 建議預設收合；重視新手探索時可預設展開。不要另外建立同名「關鍵字自動回應」，否則文字動作可能同時觸發官方帳號自動回應與 webhook bot，形成重複訊息。台灣後台步驟見 [LINE Biz-Solutions 圖文選單手冊](https://tw.linebiz.com/manual/line-official-account/oa-manager-richmenu/)。

Rich menu 不顯示在 Windows／macOS LINE，必須用 iOS／Android 驗收。若後台建立的選單未顯示，先確認是否有 Messaging API 設定的 per-user/default rich menu 蓋過它；官方優先序是 per-user API、default API、Official Account Manager default。每個 rich menu 只能由建立它的工具維護。規格與優先序見 [Rich menus overview](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)。

目前不在 runtime 自動建立 rich menu。未來只有確定需要「助理／AI 功能」雙分頁或 per-user menu 時，才新增 create → upload image → set default、alias 切換與清理舊 managed menu 的冪等腳本；API 圖片須符合 JPEG／PNG、寬 800–2500 px、高至少 250 px、寬高比至少 1.45、最大 1 MB，最多 20 個 tappable areas。參考 [Messaging API rich menu reference](https://developers.line.biz/en/reference/messaging-api/#rich-menu)。

### Webhook durable-only、防重送與成本

LINE 可能在 webhook 回應逾時或傳輸失敗時 redeliver 同一事件。6.0 不再使用 per-instance Set 或同步 fail-open，所有事件固定走以下流程：

1. 驗簽後把原始 delivery 與 redelivery 都交給 `enqueueWebhookEventOnce()`，在**單一 transaction** 內完成「登記 `processed_events` + 入列 `jobs`」。若首次入列已成功，同一 `webhookEventId` 的重送會由 DB 唯一約束丟棄；若首次根本未入列，重送仍有機會補入，避免入口先過濾而吞訊息。
2. durable event 入列後立刻回 `200`（快速 ACK）。DB 故障、缺少 `webhookEventId`、必要 env 缺失或 migration 落後時回 `5xx`，讓 LINE 可再次投遞；沒有 process-memory fallback。
3. 用 Vercel 的 `waitUntil()` 在**同一次調用內** `drainQueue()`：領取 job（`FOR UPDATE SKIP LOCKED` + lease token）→ 跑 `prepareEvents()`（AI）→ checkpoint → 送出 → 完成或重試／進 dead-letter。

設計上的硬約束：

- **queue 回覆只走 LINE reply，不允許 push fallback。** reply 免費且不限量，push 則計入月額度。
- **DB 與 migration fail closed。** 入口不可能在未取得 durable idempotency 前執行付費 AI。
- **lease 預設 120 秒。** 必須長於 Vercel function 的 60 秒上限，避免仍在執行的 LINE job 被另一個 worker 視為過期。

Supabase Cron 每分鐘呼叫 `/cron/reminders`，同時領取 `line-reminder`、`google-calendar-sync` 與 `google-calendar-status`。即使沒有新訊息，Google 同步失敗也會繼續重試；資料庫 lease 與 fencing token 可承受 cron 重疊執行。未配置 Cron 時，到期的非 webhook job 只能等下一次 webhook 或 OAuth callback 順帶 drain，因此 Google Calendar 正式啟用條件包含 Cron。

回滾方式不是關閉 queue，而是重新部署最後一個 5.x release；`0018` 只新增 `bot_sources`，可留在 DB，不要在事故期間刪表。詳細步驟見下方「6.0 升級與回滾」。

### Durable checkpoint：AI 至多執行一次、送達可重試多次

`jobs` 有兩個 checkpoint 欄位（migration `0003_job_checkpoints.sql`）：

| 欄位 | 意義 |
|------|------|
| `result` | checkpoint A：AI 已產出的回覆訊息（與 payload 同樣 AES-256-GCM 加密）。有值＝付費工作已完成。 |
| `delivered_at` | checkpoint B：已送達 LINE。有值＝不必再送。 |

worker 因此可以把付費工作與送達分開處理（`services/worker.js`）：

- **送達可安全重試**：LINE 的 reply token **只能用一次**，用同一個 token 重送不會產生重複訊息（LINE 會直接拒絕）。所以送達失敗可以重試，也**不需要**改用計額度的 push。這修掉了真正會掉訊息的情境——LINE 暫時 5xx 時不再永久遺失。
- **AI 不可重跑**：函式在 AI 階段被砍時**不會拋錯**，job 會在租約過期後被重新領取。此時 `attempts > 1` 而 `result` 仍是空的，即代表上一次死在 AI 階段——重跑會再付一次錢，因此直接 dead-letter。AI 階段主動拋錯也同樣標記為不可重試。
- reply token 失效會回 4xx，重送不會成功 → 直接 dead-letter；只有 429 與 5xx 才重試。

**因此 `max_attempts` 已從 1 恢復為 `WORKER_MAX_ATTEMPTS`（預設 3）——「不重複付費」由 checkpoint 保證，不再靠 `max_attempts=1`。**

⚠️ **部署順序**：Vercel 一 push 就部署，migration 不會同時套用。因此 `saveJobResult()` / `markJobDelivered()` 遇到 `42703`（欄位不存在）時會回傳 `null` 並退回無 checkpoint 的行為，**空窗期內訊息照常送達**。套用 migration（`npm run db:migrate`）後才會真正取得可重試的送達。

殘留：送出成功但在 `markJobDelivered()` 之前崩潰時，重試會用同一個 token 重送 → LINE 回 4xx → 進 dead-letter。訊息其實已送達且**不會重複**，只是 job 狀態偏悲觀。

### 行程（`ENABLE_SCHEDULE`，預設關閉）

建立行程可用明確指令 `記行程`／`新增行程`／`安排行程`，也支援以日期開頭、帶有事項且不是問句的自然輸入，例如 `7/20 借保貸交信用卡`、`明天下午三點看診`、`下星期五下午三點看診`。為避免誤攔一般問答，日期問句與算式不會進行程 handler。

**語音建行程**（`ENABLE_TRANSCRIPTION`）：LINE 語音訊息由 `app/context.js` 的 `transcribeAudio` 經 Whisper／`gpt-4o-mini-transcribe` 轉文字後即成 `trimmedText`，schedule handler 沒有 `isText` 閘門，因此語音講「記行程 …」或日期開頭語句會走與文字**完全相同**的 parse→確認→CRUD→同步→提醒流程。LINE Windows／Mac 子裝置沒有原生語音錄製，rc.9 起可改附加 mp3／mp4／mpeg／mpga／m4a／wav／webm。真實 Windows 驗收顯示 LINE 可能把這類附件轉成 `audio` webhook；rc.10 起 `audio` 依 [LINE Content API](https://developers.line.biz/en/reference/messaging-api/#get-content) 的 `Content-Type`（不足時用 magic bytes）選正確副檔名，`file` 則沿用白名單原始檔名。兩者都經大小檢查並走同一流程。確認卡會多一行「🎤 我聽到：…」回顯轉錄原文。音訊 buffer 只在轉錄期間存在記憶體、不落地。**圖片建行程（票券／海報擷取）決定不做**（見 [`ROADMAP.md`](ROADMAP.md) Phase 4）；圖片維持看圖聊天。

星期規則由程式先算成日期再交給 OpenAI：裸 `星期五`／`週五` 取下一個尚未跨過的星期五；`本週`／`這週`／`這個星期` 固定本週，`下週`／`下個星期` 固定下一週。若明確寫 `這週二` 而該日已過，仍依字面得到本週二，不會擅自改成下週。

需同時設好 `DATABASE_URL` 並套用 `db/migrations/`。流程：

1. 使用者輸入 `記行程 明天下午三點跟王醫師看診`（別名：`新增行程`、`安排行程`、`/schedule`）。
2. `services/schedule.js` 呼叫 OpenAI，把自然語言依 strict JSON Schema 轉成草稿。使用獨立參數：`temperature=0`、penalty=0、空 stop sequences、`maxTokens=SCHEDULE_MAX_TOKENS`；這能提高穩定性，但模型輸出仍不保證每次位元級相同。
3. 模型輸出再經 `schemas/event-draft.js` 驗證：只接受白名單欄位（title/start/end/allDay/timezone/location/notes/recurrence）；合法選填 `null` 轉成未提供，未知欄位與錯誤型別仍拒絕。
4. 原文若有明確鐘點，`schedule-parser` 會再依使用者 IANA 時區校正當地 wall clock，避免模型重複套用 UTC offset。`每天／每週／每月／每年` 開頭可直接進流程；週期草稿在確認訊息明列頻率、間隔、次數或截止日。
5. 草稿存進 `confirmations`（帶 TTL），「確認 / 取消」按鈕以 LINE postback data 綁定該草稿的隨機 token；聊天畫面只顯示自然文字。即使同一使用者有多個 pending，舊卡片也只會操作自己的草稿。
6. 使用者按下確認 → `settleConfirmation()` 以 `owner_id + token` 查詢並用 `SELECT ... FOR UPDATE` 串行化：**重複或併發確認只會建立一筆行程**。手動輸入不帶 token 的「確認行程」才取最新 pending，保留文字操作相容性。

`我的行程` 最多列六筆，每筆有完成與刪除快捷鍵（共十二個 quick replies，不超過 LINE 的 13 項上限）。token／event id 只存在不可見的 postback data，且 postback 不寫入對話 history；帶 `<id>` 的純文字指令只作手動備援。`完成行程` 會把本地 event 改成 `completed`、取消尚未領取的 reminder job；Google 模式另會把事件標題加上 `[完成]` 並寫入 private `assistantStatus=completed`，因此後續列表不再顯示。

Google 同步失敗不會刪除本機 event。使用 `同步失敗行程` 最多列六筆 `sync_status='error'` 資料，每筆可「重試同步」或「刪除」。`重試同步 <id>` 會建立新的 durable job 與新的最多 3 次嘗試週期；`暫不處理 <id>` 不改資料、不刪除、不再自動詢問。只有明確點選或輸入 `刪行程 <id>` 才會刪除 owner-scoped 資料；若已有 `provider_event_id`，會先刪 Google 事件再刪本機映射。

#### 到點提醒（`ENABLE_REMINDERS`，預設關閉）

確認未來行程時會在同一 transaction 建立 `line-reminder` durable job：有時間的行程在開始時間提醒，整天行程在使用者日期的 09:00 提醒。提醒的「標記完成」使用本機 event UUID 作不可見的 postback data，不在對話顯示 UUID。LINE destination 不以明文落 DB，而是先存入 `users.channel_target` 的 AES-256-GCM envelope，再包進加密 job payload。

啟用順序：

1. 執行 `npm run db:migrate` 套用 `0005_reminders_and_completion.sql`。
2. 產生至少 32 字元的隨機 secret，分別設為 Vercel Production Sensitive `REMINDER_CRON_SECRET` 與本機暫時環境變數；不要提交或貼入文件。
3. 設 `REMINDER_CRON_URL=https://你的部署網域/cron/reminders`，執行 `npm run db:configure-reminders`。腳本會啟用 `pg_cron`、`pg_net`、Vault，把 URL／secret 加密放進 Supabase Vault，並建立 `* * * * *` job。
4. 在 Vercel 設 `ENABLE_REMINDERS=true` 後重新部署。可在 Supabase Cron History 與 `jobs` 表確認執行結果。

`/cron/reminders` 在功能、DB 或 secret 缺少時回 `503`，Bearer 不符回 `401`；比對使用 constant-time。推播使用 job UUID 作 `X-Line-Retry-Key`，429／5xx 重試，409 視為同 retry key 的前次要求已被接受，其他 4xx 直接 dead-letter。LINE Push 會計入 Messaging API 月額度；與 webhook reply 的免費路徑不同。

行程一律以 `owner_id` 界定範圍（`users` 表的 HMAC 代碼），不以原始 LINE user id 儲存。

#### Google Calendar（程式預設關閉；本維護者 Production 已啟用）

截圖中舊版 bot 回覆「已建立行程」時，資料只在 Supabase `events` 表；當時沒有 Google OAuth 或 Calendar API，因此不會出現在 Google Calendar。新路徑保留 Supabase 作為確認、冪等、加密憑證、事件映射與 retry 狀態，使用者真正查看與操作的日曆則改為 Google Calendar。

啟用步驟：

1. 在 Google Cloud 建立或選擇 project，啟用 **Google Calendar API**；要開 `ENABLE_GOOGLE_TASKS` 時，在同一 project 另外啟用 **Google Tasks API**。兩者都應先在「API 和服務 → 已啟用的 API 和服務」確認，再開 Vercel flags；只有 OAuth scope 不足以通過這一步。
2. 設定 External OAuth consent screen。短期開發可用 Testing 並把授權帳號加入 test users，但 Calendar 授權與 refresh token 會在 7 天後到期；持續運作的 bot 應發布為 **In Production**。少於 100 位使用者的個人用途可暫不送驗證，但首次授權會顯示未驗證警告，且整個專案有 100 位新使用者上限。
3. 建立 **Web application** OAuth client，Authorized redirect URI 填正式站完整 callback，例如 `https://your-project.vercel.app/oauth/google/callback`。
4. 在 Vercel Production 設 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_OAUTH_REDIRECT_URI`，先維持 `ENABLE_GOOGLE_CALENDAR=false`。
5. 執行 `npm run db:migrate` 到最新 migration；Google Tasks inbound 的安全水位需 `0014`＋`0016`，統一提醒索引清理需 `0017`。不要只開旗標卻停在舊 schema。
6. 設 `ENABLE_GOOGLE_CALENDAR=true`；需要時再設 `ENABLE_GOOGLE_TASKS=true`、`ENABLE_GOOGLE_CALENDAR_INBOUND=true`，並 Redeploy。inbound 依賴每分鐘 worker，不能只開 flag。
7. 在 LINE 輸入 `連結 Google 行事曆` 或 `連結Google行事曆`，按 URI 按鈕完成 Google 授權；也接受「連接／綁定／授權」常見變體。這些文字必須直接進 OAuth handler，不可送入一般 OpenAI 對話。成功頁會去除 callback URL 中的 code，並把既有尚未同步的未來行程與 Tasks 排入 backfill。已授權過 Calendar 的使用者在開 Tasks 後仍須重新連結，Google 才會授予新增 scope。

目前本維護者 Production 已完成 Google Calendar API、External OAuth app 並發布為 In Production、Web client、Vercel Sensitive env、`0004` migration 與 `ENABLE_GOOGLE_CALENDAR=true`。目前屬少於 100 位使用者的未驗證個人用途，因此首次授權仍會顯示 Google 警告；若開放給一般使用者，需準備首頁、隱私權政策、網域所有權、scope justification 與 demo video 後送 Google 驗證。這是部署狀態，不是可提交的預設值；其他自架者仍須依上述順序自行設定。Client ID、Client Secret、refresh/access token、Supabase URI 與 CA 都不得寫入文件、issue、log 或 Git。

安全與一致性：

- Calendar 只要求 Google 官方列出的 `https://www.googleapis.com/auth/calendar.events.owned`，不要求讀寫所有可存取日曆的完整 `calendar` scope；只有開啟 `ENABLE_GOOGLE_TASKS` 時才另外要求 `https://www.googleapis.com/auth/tasks`。
- OAuth state 只以 SHA-256 保存且只能 `DELETE ... RETURNING` 消費一次；S256 PKCE verifier 與 access/refresh token 使用 `DATA_ENCRYPTION_KEY` 加密。
- OAuth callback／完成頁另以 `express-rate-limit` 依 Vercel `x-real-ip` 限制 15 分鐘 20 次；正式安全邊界仍以不可猜、一次性 state 為主，因 serverless instance-local limiter 不是全域配額系統。
- LINE URI action 預設在 in-app browser 開啟，但 Google OAuth 禁止 embedded user-agent；授權 URL 會依 LINE 規格自動加 `openExternalBrowser=1`，改用 Safari／Chrome。
- 新增行程以本地 UUID 產生 deterministic Google event id；worker 重試收到 `409` 代表前次已寫入，不再建立第二筆。
- 同步上限預設 3 次，內部 backoff 為 5 秒、10 秒；由於 Supabase Cron 每分鐘唤醒，沒有新 webhook 時通常會在約 2 分鐘內完成三次嘗試。前兩次失敗不通知；成功或最終失敗才用 LINE Push 發一則狀態。
- 最終失敗訊息有「重試同步／暫不處理／刪除行程」。狀態 Push 使用 job UUID 作 `X-Line-Retry-Key` 且寫 `delivered_at` checkpoint，避免 worker crash 造成重複通知。
- `我的行程` 直接呼叫 Google `events.list`；完成以 `events.get` + `events.patch` 寫入 `[完成]` 與 private metadata；刪除直接呼叫 `events.delete`，再清理本地映射。
- `ENABLE_GOOGLE_CALENDAR_INBOUND` 以 sync token 輪詢回收 **bot 建立、非週期且有時刻**之行程在 Google 端的修改與刪除；`0019` 起使用 `singleEvents=false` 同步 series 本體，不展開無截止日週期，也忽略 recurring instance。這只控制 inbound cursor，LINE 建立週期行程與本地逐次提醒不受影響。不匯入 Google 端新建行程，也尚未處理週期 round-trip、watch channel 與完整衝突合併。

官方依據：[Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)、[`events.insert`](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)、[Calendar incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync)、[`events.list` 的 `singleEvents`](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)、[LINE 外部瀏覽器參數](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/#opening-url-in-external-browser)。

### 其他跑法（非主力）

- **本機 node**：`npm start`（`node api/index.js`）＋ 對外 tunnel。
- **Docker**：repo 內含 Node 24 `Dockerfile` 與 `docker-compose.yaml`。先從 `.env.example` 建立不納入 Git 的 `.env` 並補齊必要值，再執行 `docker compose up --build --detach`；Compose 會透過 `env_file` 注入設定，Dockerfile 與 Compose 都會在 `APP_PORT` 缺少／空白時使用 `3000`。image 只安裝 production dependencies、以非 root `node` 執行，並以 `GET /health/live` 回報 liveness。用 `docker compose ps` 確認 `healthy`，再以 `curl http://127.0.0.1:3000/health/live`（Windows 可用 `Invoke-WebRequest`）驗證 HTTP。`restart: unless-stopped` 只在主程序退出時重啟，不會因 `unhealthy` 自動重啟；需要自動回收時應由平台／orchestrator 監看 health。CI 會實際 build／run production image 並檢查預設 port 與 healthcheck；本機沒有 Docker CLI 時可改用 Node 流程。

### 找回與檢查現有部署設定

隔一段時間忘記當初怎麼設定時，設定分散在三個地方，可依序自查（此處只列「去哪看」，實際的專案名、網址、金鑰屬個別部署，不寫入版控）：

**1. Vercel（跑著的 app 與環境變數）**

- **哪個專案**：Vercel dashboard → 你的 team/帳號 → Projects，找到連結本 repo 的專案。
- **正式網址**：專案 → **Overview** 頁最上方，或 **Settings → Domains** 的穩定網域（不是帶 hash 的 per-deployment 網址）。這個網址 + `/webhook` 就是 LINE 該指的位置。
- **環境變數**：**Settings → Environment Variables**，確認至少有 `OPENAI_API_KEY`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`（值加密顯示，點 Edit 可查/重設）。若某變數標示 **Needs Attention**，點進去確認它在對應環境仍有值。
- **連結的 repo / 自動部署**：Settings → Git，確認連到本 repo 的 `main`（push 會自動部署）。

**2. LINE Developers Console（bot 本體與 webhook）** — <https://developers.line.biz/console/>

- 進入對應的 **Provider → Messaging API channel**。
- **Messaging API 分頁 → Webhook URL**：這就是當初接的網址（應等於 Vercel 正式網址 + `/webhook`）；用它反查是哪個部署。同分頁確認 **Use webhook** 開啟、**Auto-reply / Greeting messages** 關閉（否則官方罐頭訊息會蓋掉 bot 回覆）。
- **Bot information（QR code / Bot basic ID）**：加 bot 為好友、實機測試用。
- **金鑰**：`Channel access token`（Messaging API 分頁）與 `Channel secret`（Basic settings 分頁）即對應 Vercel 的兩個 LINE 環境變數。

**3. OpenAI Platform（API 金鑰）** — <https://platform.openai.com/>

- **API keys** 頁確認金鑰存在（舊金鑰值無法再顯示，必要時重建並更新 Vercel 環境變數）。
- 若要用 `gpt-image-1`，另需確認帳號有 GPT Image 權限（可能需組織驗證）。

**一致性檢查**：LINE 的 Webhook URL == Vercel 正式網址 + `APP_WEBHOOK_PATH`（預設 `/webhook`），且 Vercel 三個必填金鑰皆有值 → 設定完整。改動環境變數後記得 **Redeploy** 才生效。

部署平台不限定，但文件與預設以 Vercel 為主。

### 狀態儲存

6.0 以 Supabase Postgres 作為唯一 durable source of truth。使用者、事件、任務、確認、job、run 與 bot 啟停狀態都不再寫入 Vercel Environment API；`APP_STORAGE`、`APP_STORAGE_RECORD_*`、`VERCEL_ACCESS_TOKEN`、`VERCEL_PROJECT_NAME`、`VERCEL_TEAM_ID` 與 `APP_WEBHOOK_QUEUE` 均已移除。`bot_sources.source_key` 只存 deployment-scoped HMAC，不保存原始 LINE user/group id 或顯示名稱。

對話 prompt/history 仍只放 process memory，這是刻意的隱私界線，不是 durable authority；serverless instance 更換後可遺失短期聊天上下文，但不影響已確認的行程、任務、OAuth、提醒或去重狀態。

### Phase 0 資料庫基礎（Supabase Postgres，已上線並接線）

依 [`ROADMAP.md`](ROADMAP.md) Phase 0，schema 最新為 `0019`。Production 使用 transaction pooler、CA 與資料加密 key；queue、行程、提醒、Google Calendar、任務、Google Tasks（outbound＋inbound）、Calendar inbound 與天氣功能旗標均已接線。`0019` 將既有 Calendar inbound cursor 標成 v1，rc.8 第一次輪詢會清掉該 cursor，下一輪以 `singleEvents=false` 的系列模式重建；這不刪除行程。提醒 URL 與 Bearer secret 存於 Supabase Vault，`gpt-ai-assistant-reminders` Cron 每分鐘執行；每次新增 migration 或改旗標後仍須以 `npm run db:migrate`、`npm run db:preflight`、Redeploy 與真實 worker trace 重驗。

- `services/database.js`：`pg` Pool、`withTransaction`、Supabase CA hostname verification。Supabase URL 有 `DATABASE_URL` 但缺 `DATABASE_SSL_CA` 時 fail closed。
- `db/migrations/*.sql`：涵蓋 durable queue、行程／確認、Calendar、提醒偏好、任務、天氣、inbound sync 與 bot source；每個 migration 自帶 transaction，`db/rollbacks/` 有 `0001`–`0019` 對應回滾。
- `npm run db:migrate`：依檔名順序套用 migration，`schema_migrations` 記錄 SHA-256 checksum；已套用檔案被修改時拒絕繼續。
- `npm run db:preflight`：檢查已啟用功能所需 env 與最新 migration；6.0 health/webhook 使用相同檢查。
- `npm run db:rollback -- 0019_calendar_sync_query_version.sql --confirm`：只允許回滾最新 migration；只能在已回到不要求 `0019` 的 deployment 且停止流量時使用。
- `repositories/webhook-events.js`：同一 DB transaction 完成 processed-event 登記與 job 入列；任一步失敗皆 rollback，不會永久吞事件。
- `repositories/jobs.js`：`FOR UPDATE SKIP LOCKED` 領取、lease / retry / dead-letter；每次領取用新 `lease_token` 作 fencing，舊 worker 不能覆寫新 worker 狀態。
- `services/jobs.js`：`computeBackoffSeconds`（指數退避含上限）與 `runJob(job, handler)`（成功則完成、失敗則重試／dead-letter，handler 丟錯不外拋）。
- `repositories/runs.js` + `services/run-trace.js`：run trace 記錄每次 AI 執行的能力／模型／prompt·completion token／`cost_usd`／耗時／狀態，只存 metadata、不存對話內容或憑證。`recordCompletionRun` 已接進 `generateCompletion`（聊天／搜尋）與 `services/schedule.js`、`services/task-parser.js`（行程／任務解析）；同時輸出單行 JSON 結構化 log（無對話內容）。成本依 `OPENAI_PRICE_PER_1K_PROMPT`／`OPENAI_PRICE_PER_1K_COMPLETION` 估算，兩者皆設才計、否則留空。**觀測絕不影響主流程**：無 DB（`isDatabaseConfigured` 為否）跳過、寫入失敗只記 error log 不拋出。`traceRun(meta, fn)`／`startRun`／`finishRun` 保留給需要 started→done 兩段狀態的用途。
- `services/data-protection.js`：job payload 以 AES-256-GCM 驗證式加密；LINE user id 以 deployment-scoped HMAC 代碼後才寫入 `users`。
- `repositories/confirmations.js`：以 row lock + transaction 串行化併發確認，event 寫入與 confirmation 轉移同成同敗。

#### 備份／還原與可靠性演練（Phase 0）

**Migration／rollback**：`db/migrations/0001`–`0019` 皆有對應 `db/rollbacks/`。`npm run db:migrate` 依檔名順序套用並記錄 SHA-256 checksum；已套用檔案被改動會拒絕繼續。`npm run db:rollback -- <檔名> --confirm` 只允許回滾最新一筆（見上）。破壞性 migration 一律先寫 rollback 再合併。

**備份／還原**：
- 託管 Supabase：Pro 方案有每日自動備份與 PITR（Point-in-Time Recovery），於 Dashboard → Database → Backups 操作；還原前先確認要回復的時間點並停用 `gpt-ai-assistant-reminders` Cron，避免還原期間有 job 寫入。
- 通用（含自架 Postgres）：手動備份 `pg_dump "$DATABASE_URL" -Fc -f backup.dump`；還原 `pg_restore --clean --if-exists -d "$DATABASE_URL" backup.dump`。還原後跑 `npm run db:migrate` 確認 schema 版本一致（checksum 相符即 no-op）。
- 備份檔含使用者資料與加密 envelope，**不得進 Git、issue 或 log**；金鑰（`DATA_PROTECTION_KEY` 等）與備份分開保管，否則加密形同虛設。

**本機 Supabase／Postgres 測試流程**：
- 單元／整合測試（`npm test`）全用 mock，不需真實 DB，CI 直接可跑。
- 要對真實 schema 演練：`supabase start`（本機 CLI stack）或啟一個本機 Postgres，設 `DATABASE_URL`（自架另設 `DATABASE_SSL_CA` 或關 SSL），跑 `npm run db:migrate` 套到最新，再手動打 webhook（`npm run dev`）驗證行程／提醒／同步。

**Worker crash 恢復演練**：durable queue 用 lease + fencing token 保證 worker 崩潰後工作可恢復、且不重複扣費送達：
- `claimNextJob` 領取時設 `lease_until` 與新 `lease_token`；崩潰的 worker 租約到期後，下次領取會重新挑中該 `processing` job（`lease_until <= now() AND attempts < max_attempts`），嘗試次數用盡則轉 `dead`（dead-letter）。
- fencing：`completeJob`／`saveJobResult`／`markJobDelivered` 都以 `lease_token` 為條件，舊 worker 醒來也無法覆寫新 worker 的狀態（見 `tests/repositories/jobs.test.js`）。
- Durable checkpoint：AI 結果先 `saveJobResult`（AES 加密）＋ `delivered_at`，達成「AI 至多執行一次、送達可重試多次」。
- 手動演練：入列一筆 job → 在處理中強制中止 worker（或直接把該列 `lease_until` 設為過去）→ 再次 drain（`/cron/reminders` 或 `drainQueue`）→ 確認 job 被重新領取並完成、且未重複送出。

Phase 1 baseline 已接上新增、durable 追問／確認、查詢、修改、衝突警告、完成與刪除；Google 模式會新增與 PATCH 回寫。批次／週期 UX、修改履歷與首次使用主動 timezone 引導屬後續增強。

**下一步**：`6.0.0-rc.10` 已完成 Calendar inbound v2／Cron 實機觀察，並修正 LINE 桌面音訊被轉為 `audio` 後的格式判斷。跑完 [`REVIEW.md`](../REVIEW.md) 的音訊檔→轉錄→確認→Google→清理驗收後，才將同一候選升為正式 `6.0.0`。

#### 6.0 升級與回滾

1. 先備份 Postgres，記錄目前 5.x Vercel deployment URL 與 env **名稱**；不要匯出或貼出 secret 值。
2. 在 5.x 仍服務時先跑 `npm run db:migrate` 到 `0018_durable_sources.sql`。此 migration 只新增 `bot_sources`，5.x 可繼續運作。
3. 確認 Production 沒有需要搬移的 `APP_STORAGE`／`APP_STORAGE_RECORD_*`。若有，先停在 5.x 並人工盤點啟停狀態；不得把 raw LINE id 寫進新表。本專案現行 Production 無這些變數。
4. 移除已棄用的 `APP_WEBHOOK_QUEUE`、`VERCEL_ACCESS_TOKEN`、`VERCEL_PROJECT_NAME`、`VERCEL_TEAM_ID`、`VERCEL_TIMEOUT`；確認 `DATABASE_URL`、`DATABASE_SSL_CA`、`DATA_ENCRYPTION_KEY` 及已啟用能力的 key 齊全。
5. 部署目前最新 RC，根路由必須回 `200`。`503` 代表 runtime preflight 未通過，先修 env／migration，不要把 webhook 改回同步處理。
6. 回滾時重新部署最後一個 5.x deployment。`0018` 對 5.x 無害，事故期間保留該表；確認 5.x 健康後再決定是否於維護時段執行 latest-only rollback。修正後重新部署 RC 並重跑 health、Cron 與集中驗收。

## AI 操作 LINE PC 的正式驗收流程

這是維護者允許 AI 直接操作 LINE Windows 客戶端時的權威流程。目的不是取代自動測試，而是用真實 LINE webhook、Production Vercel、Supabase 與 Google provider 做最後 round-trip。

1. **先取得本輪明確授權**：傳送 LINE 訊息、上傳音訊、建立／修改／完成資料都是對外動作；AI 必須在操作當下有維護者明確同意。刪除測試資料也須另有當下確認，不因先前曾同意而推定。
2. **唯一視窗與身分確認**：每批操作前重新列出 Windows apps，LINE app id 應為實際回傳值且只能選到一個視窗；activate 後重新擷取畫面，確認聊天標題是預期的「綠脈 AI 助理」。不可沿用舊 screenshot id、座標或 accessibility index，也不可操作其他聊天室。
3. **一次只做一個狀態轉移**：觀察輸入框焦點後傳一則驗收訊息，立即重新擷取畫面並等待 bot 回覆；確認回覆與預期一致後才按確認／修改／完成／刪除。若輸入結果不確定，先重抓畫面，不可盲目重送，以免產生複本或額外 token 成本。
4. **分批驗收**：依 [`REVIEW.md`](../REVIEW.md) Release Gate 逐批測功能入口、Calendar、Tasks、提醒／週期、搜尋與語音。測試名稱使用唯一且可搜尋的前綴，例如 `RC 音訊驗收`；不得使用真實醫療、財務或其他敏感內容。
5. **音訊的桌面限制**：LINE 官方 Windows／Mac 子裝置不提供原生語音訊息錄製。手機語音會產生 `audio` webhook；桌面可附加 mp3／mp4／mpeg／mpga／m4a／wav／webm。不可先假設 webhook 型別：真實 Windows 驗收中，LINE 把 WAV／MP3 附件都轉成 `audio`。rc.10 會依 Content API header／magic bytes 判斷實際格式，並同時支援未轉換的 `file`；兩者都走相同 content download、OpenAI transcription、指令與行程流程。一般檔案不處理。測試音訊不得含個資，且須小於 `TRANSCRIPTION_MAX_BYTES`。
6. **每一層都要有證據**：LINE 確認轉錄回顯與最終訊息；Google Calendar／Tasks 確認只有一筆且狀態一致；Supabase 只查必要欄位，確認 job `done`、attempts、cursor／mapping，不把 encrypted payload、token 或 owner id 複製到文件；Vercel logs 確認對應 deployment 沒有 5xx／timeout。
7. **正式版後集中清理**：先列出本次唯一前綴命中的 Calendar events、Google Tasks、Supabase events／tasks／confirmations／jobs，再取得刪除確認後執行。只刪驗收資料，不刪真實資料、migration、必要 cursor 或 release evidence。LINE 聊天、Vercel／GitHub 系統 logs 等平台不提供完整可控刪除時，必須如實註記，不能宣稱「毫無痕跡」。
8. **收尾**：更新 `REVIEW.md` 勾選實際通過項、記錄無法由桌面驗證的邊界；跑本機 gate、確認 CI／CodeQL／文件站／Production health，再發正式 release。驗收或清理途中發現錯誤時，留在 RC，修正後重跑受影響批次。

LINE 桌面語音限制依據：[LINE Help Center](https://help.line.me/line/desktop/pc?contentId=20007005&lang=en)。

## 測試涵蓋

`npm test`（jest，見 `tests/`）。目前覆蓋各指令、簽章驗證、feature flags、webhook 去重、queue/checkpoint、行程、任務、提醒、Calendar、天氣、Blob/圖片、SSRF 與 DB repositories。改行為時必須補對應測試。

CI：`.github/workflows/ci.yml` 在每次 push / PR 對 `main` 跑 `npm ci` → `npx eslint .` → `npm test`（Node 24）。README 的 CI 徽章反映此 workflow 狀態；CodeQL 徽章反映 `.github/workflows/codeql.yml`。

## Legacy 與上游邊界

- 本 repo 源自 [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant)（MIT），來源脈絡包含上游 [`d84c806`](https://github.com/memochou1993/gpt-ai-assistant/commit/d84c806b8368ded9d790067235827cdac32a23ab)，公開 Git 歷史於 2026-07-18 以目前快照初始化，現為獨立維護 repository。fermi 不直接合併原始碼；上游活躍度、回貢、架構與授權評估見 [`ROADMAP.md`](ROADMAP.md)。
- 本專案維持 OpenAI + LINE、自架、自備 API key，並已核准依 [`ROADMAP.md`](ROADMAP.md) 演進為個人助理。OpenAI / ChatGPT 訂閱 OAuth 仍不適合取代 API key。未來 Claude 版仍屬候選方向；硬性禁令見 [`../CLAUDE.md`](../CLAUDE.md) 與 [`../AGENTS.md`](../AGENTS.md)。
