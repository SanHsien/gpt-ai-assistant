# Changelog

## [6.0.0-rc.10] - 2026-07-19

- 真實 LINE Windows 驗收發現，桌面附加 WAV／MP3 會被 LINE 轉成 `audio` webhook，而不是保留成 `file`；過去 `audio` 路徑一律命名為 `.m4a`，會讓 OpenAI 收到副檔名與位元組格式不符的檔案並產生錯誤轉錄。
- 下載音訊現在依 LINE Content API 回應的 `Content-Type` 選擇 `.mp3`／`.m4a`／`.wav`／`.webm`，泛用 content type 再以檔案 magic bytes 判斷；`file` webhook 仍保留原始白名單副檔名。

## [6.0.0-rc.9] - 2026-07-18

- LINE Windows／Mac 不提供原生語音訊息錄製；新增 `file` webhook 的音訊副檔名白名單，桌面版附加 mp3／mp4／mpeg／mpga／m4a／wav／webm 時會走既有轉錄、指令、行程確認與 Google 同步流程。
- 新增 `TRANSCRIPTION_MAX_BYTES`（預設 25 MiB），先檢查 LINE file metadata，下載後再以實際 buffer 大小防守；一般檔案仍忽略且音訊不落地。

## [6.0.0-rc.8] - 2026-07-18

- 追查 rc.7 正式環境後確認 Calendar inbound 的真正瓶頸是 `singleEvents=true`：無截止日的每日週期會被 Google 展開成大量 instances，造成連續 60 秒 Cron timeout。
- inbound 改用非展開的 recurring series、只比對 bot 管理的 `gpta*` 事件並明確忽略 recurrence instances；單頁上限提高至 2500，減少 serverless 內的累積 API round trips。
- 新增 `0019_calendar_sync_query_version.sql`；既有 v1 sync cursor 只重建一次，新帳號直接使用 v2 系列模式。

## [6.0.0-rc.7] - 2026-07-18

- 實機進階提醒雖成功送達，但 Vercel logs 揭露 Google Calendar inbound 偶發拖滿 60 秒；Google OAuth transport 現以 `GOOGLE_REQUEST_TIMEOUT_MS`（預設 10000）同時限制 token refresh 與 API 呼叫。
- `/cron/reminders` 傳入 `REMINDER_WORKER_TIME_BUDGET_MS`（預設 45000）作 drain 總預算；到期即停止再 claim，剩餘 durable jobs 留給下一分鐘，不讓慢 provider 阻塞提醒。
- 版本推進至 `6.0.0-rc.7`；正式 `6.0.0` 仍待最後語音與 RC.7 Cron 穩定性驗收。

## [6.0.0-rc.6] - 2026-07-18

- 修正週期行程的明確鐘點可能被模型重複套用 UTC offset；`每天 22:40` 與 `每天晚上十點四十分` 現由程式依使用者時區鎖定為相同 wall clock，若當日鐘點已過則從次日開始。
- `每天／每週／每月／每年` 開頭的非問句可直接進入行程流程，不必硬加 `記行程`；確認卡與行程摘要會明列週期、間隔、次數與截止日，避免建立前看不出重複規則。
- 版本推進至 `6.0.0-rc.6`；正式 `6.0.0` 仍待剩餘集中 LINE／Google 驗收完成。

## [6.0.0-rc.5] - 2026-07-18

- 真實 LINE／Google Tasks 驗收發現 OAuth 已授權 Tasks scope，但 Google Cloud 專案尚未啟用 Google Tasks API；README、部署文件與環境範例現在都把「在同一 OAuth project 另行啟用 Tasks API」列為開 flag 前的必要步驟。
- `enqueuePendingGoogleTasks` 遇到相同 idempotency key 的 dead job 時，會在永久設定錯誤排除並重新 OAuth backfill 後安全重排該 job；pending、processing、done job 不變，避免建立複本。
- 版本推進至 `6.0.0-rc.5`；正式 `6.0.0` 仍待集中 LINE／Google 驗收完成。

## [6.0.0-rc.4] - 2026-07-18

### Changed

- 升級 Express 5.2、Jest 30.4 與 ESLint 10 flat config；移除不相容且停止跟進新版 ESLint 的 legacy Airbnb config，改用官方 recommended 加本專案明確規則，完整 71 suites／497 tests 通過。
- `bot-sources` 移除 production 模組內的 `APP_ENV === 'test'` 記憶體分支，改由 `handleEvents`／`Context` 明確注入 repository；記憶體 adapter 僅保留在 tests。
- Docker image 與 Compose 都為缺少／空白 `APP_PORT` 提供 `3000` fail-safe，新增 `/health/live`、image healthcheck，以及 CI production image build/run smoke test。
- 修正 ESLint 10 揭露的遺失 error cause 與兩個無效初始賦值；不改變 LINE 指令或 durable 資料契約。

## [6.0.0-rc.3] - 2026-07-18

### Changed

- 公開 Git 歷史以目前獨立維護快照重新初始化為單一 root commit；舊 refs 已保存於維護者離線 bundle，repo 仍永久保留原始 MIT license、`NOTICE.md` 與上游 attribution。本檔保留的是產品版本歷程，不代表每一版仍有公開 commit ref。
- Google OAuth 完成／錯誤頁改由 `APP_LANG` locale 產生，英文與日文不再顯示繁中文字串；補齊兩語系殘留的翻譯、搜尋 prompt 與日文使用者／群組上限錯置訊息。
- Runtime／容器基線統一到 Node 24；Docker image 改以 production-only dependencies 與非 root `node` 使用者執行，縮小 build context，並修正 Compose 未把 `.env` 注入 container 的部署缺口。
- 更新仍在既有 major 範圍內的 dependencies；`npm audit --audit-level=high` 維持 0 vulnerabilities。Express 5、Jest 30、Babel 8 與 ESLint flat-config 遷移另列 6.x 後續，不在 RC 混入不相容更新。
- 補齊 npm package metadata、GitHub bug／設定問題範本，並啟用目前獨立 repo 的 Issues，讓 LINE `回報` 指令有可用目的地。

## [6.0.0-rc.2] - 2026-07-18

### Changed

- 全域 LINE Quick Reply 改為最多 13 個常用入口：記行程、我的行程、新增任務、我的任務、天氣、每日天氣、查詢、請畫、連結 Google 行事曆、暫停提醒、恢復提醒、忘記、指令；並依對應 feature flags 隱藏未啟用能力。
- `指令` 不再顯示只有四個維護按鈕的舊 template，改為依已啟用功能產生分組完整清單、可輸入指令與範例，並在訊息下方保留常用 Quick Reply。
- `回報` 指令改為導向目前獨立維護的 `SanHsien/gpt-ai-assistant` issues，不再送往上游專案。
- 移除 Quick Reply 重做後已無入口的 `bot-search-demo` 死碼與對應 locale 字串，消除 CodeQL unused import。
- 文件明確界定 `APP_LANG`：繁體中文為正式支援語系，英文／日文為實驗性，`zh_CN` 目前仍共用繁體字串；未知值會在啟動時回報可用語系，而非以不明確的 `undefined` 失敗。
- 中英文 README、部署手冊與文件站新增選用的 LINE 官方帳號 3×2 圖文選單方案，明確區分 Quick Reply 與 rich menu、手機／PC 支援、顯示優先序及避免關鍵字自動回應造成重複回覆的設定。

## [6.0.0-rc.1] - 2026-07-18

### Breaking

- Webhook 固定使用 Supabase durable queue；移除 `APP_WEBHOOK_QUEUE`、process-memory redelivery filter 與同步 fail-open。缺 `webhookEventId`、DB 故障、必要設定缺失或 migration 落後時回 `5xx` 交由 LINE 重送，不在未取得 durable idempotency 前執行付費 AI。
- 移除 Vercel Environment API storage 與 `APP_STORAGE*`、`VERCEL_ACCESS_TOKEN`、`VERCEL_PROJECT_NAME`、`VERCEL_TEAM_ID`、`VERCEL_TIMEOUT` runtime 契約。升級前必須先套用 `0018_durable_sources.sql`；回滾方式改為重新部署最後一個 5.x release。

### Added

- 新增啟用 RLS 且不提供 anon/authenticated policy 的 `bot_sources` durable authority；只保存 deployment-scoped HMAC key、source type 與啟停狀態，user/group 數量限制以 advisory lock + transaction 原子執行，不落地原始 LINE id 或顯示名稱。
- 新增 runtime config／migration preflight 與 `npm run db:preflight`。預設搜尋開啟時也強制要求 `SERPAPI_API_KEY`；本專案 Production 已將該值設為 Sensitive env。
- 本專案 Production 已套用 `0018_durable_sources.sql`、核對 migration checksum 並確認 `bot_sources` RLS 啟用；文件不保存任何 Supabase 連線或憑證值。
- 新增 Google Calendar／Tasks provider contract，集中 scopes、支援能力與 inbound 衝突政策；Calendar 全天 inbound、recurrence exception、Google-origin 建立與 Tasks due 回收保持明確不支援。

### Changed

- 同一使用者同批事件改為依序初始化 context 再處理，確保 activate/deactivate 等 durable source 狀態不會被預先建立的 stale snapshot 覆蓋。
- 更新中英文 README、上線順序、6.0 升級／備份／回滾手冊、路線圖、決策與 agent 指引。正式 `6.0.0` 以 Production 升級演練與集中 LINE／Google 驗收為 gate。
- Production RC health、`5.13.0` ↔ `6.0.0-rc.1` deployment 回滾往返，以及 Supabase 每分鐘 Cron／HTTP 200 均已實際驗證；正式版只剩集中 LINE／Google 驗收 gate。

## [5.13.0] - 2026-07-17

### Added

- Google Tasks inbound 新增成功水位與 claim lease（migration `0016`）：只有 Google API 全部分頁成功後才提交 `tasks_last_pulled_at`；失敗或 worker crash 會在 lease 到期後從原水位重抓，不會永久漏掉失敗時間窗。
- 嘉義／新竹市縣加入確定性行政中心 fallback。`天氣 嘉義` 會真的提供市／縣選擇，`天氣 嘉義縣` 可直接查；太保、民雄等鄉鎮仍可直接輸入。

### Fixed

- 修正 `rrule` CommonJS 套件在 Vercel Node ESM runtime 不提供 named export，造成 function 啟動即失敗；以 namespace/default fallback 同時相容原生 Node 與 Jest，並把原生 Node module-load smoke test 加入 CI。
- 提醒建立／取消集中到 `services/reminder-scheduling.js`。修改行程即使當下關閉 `ENABLE_REMINDERS` 也會取消舊 job；Google inbound 改時間會同時重排到點與所有 lead 提醒；完成行程會取消該事件全部 pending occurrence。
- 週期日期改由 BSD-3-Clause 的 `rrule` 依 RFC 5545 展開，月底與閏年不再受 JavaScript `Date` overflow 影響；後續每個 occurrence 都建立到點與 `REMINDER_OFFSETS` lead 提醒。
- `REMINDER_OFFSETS` 只接受最多一年內的 safe integer，避免極端設定產生無效日期。

### Changed

- 架構收斂移除未被需要的 `event_reminders` 第二份索引（migration `0017`）；durable `jobs.idempotency_key` 已能完整取消到點、lead 與週期提醒，避免兩份狀態漂移。
- 刪除沒有任何程式或文件引用的 `demo/labot.png` 與空 `demo/` 目錄。
- 路線圖補上 5.x／6.0 SemVer 門檻、durable-only 架構收斂計畫，以及轉為獨立 repository 後仍永久保留 MIT 上游 attribution 的決策。

## [5.12.0] - 2026-07-17

### Added

- **Phase 1 週期行程提醒**：週期行程（`每週一開會` 等，`recurrence` 早已可解析、儲存並以 RRULE 同步 Google）現在會**每個 occurrence 都提醒**。每次 occurrence 的提醒觸發後，`sendLineReminder` 自動排下一個未來 occurrence 的提醒；`5.13.0` 後改由 `rrule` 展開並為每次 occurrence 排到點與 lead 提醒。

## [5.11.0] - 2026-07-17

### Added

- **Phase 3 多重（lead）提醒（`REMINDER_OFFSETS`，預設空）**：除了到點提醒，可在「提前 N 分鐘」各排一個提醒。逗號分隔的正整數分鐘（如 `60,1440`＝提前 1 小時與 1 天，去重排序、上限 5 個）。`5.13.0` 後統一由 durable job key 追蹤，不再維護 `event_reminders` 第二份索引。

## [5.10.0] - 2026-07-17

### Added

- **Phase 7 從搜尋建立行程**：`search` 的 AI 答案若含日期／時間跡象且開了 `ENABLE_SCHEDULE`，答案下方會多一顆「📅 建立行程」quick-reply。點下去以 postback 把答案送進 Phase 1 行程流程（`記行程 <答案>`）——沿用確定性日期解析、durable 草稿與**使用者確認才建立**，不自動寫入、不繞過確認。答案截到 LINE postback 上限（300 字）。注入受限：來源不進 prompt、行程 parser 用 strict schema／temperature 0、寫入前必經確認。實作見 `app/handlers/search.js` 的 `scheduleActionFor`；postback 直接由既有 schedule handler 的 `記行程` create 流程處理。

## [5.9.0] - 2026-07-17

### Added

- **Phase 2 Google Tasks inbound sync（`ENABLE_GOOGLE_TASKS_INBOUND`，預設關閉）**：在 Google Tasks 端對 bot 建立的任務所做的**完成／重開、刪除、標題、備註**變更會回收到 Supabase。Google Tasks API 無 sync token，故以 `updatedMin` 增量輪詢（`services/google-tasks-inbound.js`＋`repositories/tasks.js` 的 `applyInboundTaskUpdate`＋migration `0014` 的 `tasks_last_pulled_at` 水位；claim 回傳前次水位當 `updatedMin`，失敗重試沿用同窗）。衝突政策對稱 Calendar inbound：本地 `sync_status='synced'` 才吃外部改，`pending`（剛用 bot 改、outbound 未推）跳過讓 outbound 先贏；notes 內同步標記剝除後欄位相同視為 echo 不動作；套用設 `synced` 不觸發 outbound（防迴圈）；不建立 Google-origin 新任務。重用既有 `/cron/reminders`、節流 `TASKS_INBOUND_INTERVAL`。**`due` 不回收**——Google Tasks 只有日期，對回本地會失去精確時間又有時區歧義，精確期限以本地 `task.due_at` 為權威。

## [5.8.1] - 2026-07-17

### Fixed

- Google Tasks 的 `due` 攸關日期改依任務 IANA 時區取當地年月日，修正凌晨期限因 UTC 跨日而提早一天。
- Google OAuth callback 取得 Tasks scope 後會自動回填既有未同步任務；Google 未回傳 `tokens.scope` 時改以本次請求 scope 安全回退。
- Google Tasks 同一任務的同步以 row lock 序列化，刪除與 outbox 原子提交；新增時在 notes 寫入穩定同步標記並於 POST 前查重，避免遠端成功但本機尚未存回 ID 時重試產生重複任務。Google Calendar 同步、完成、刪除也共用列鎖，避免 serverless 併發重複建立或留下遠端孤兒資料。
- Calendar 增量同步維持 `singleEvents=true`，並在 Google 回應省略 `start.timeZone` 時保留本機原時區。
- 每日天氣排程改以目標日期重新計算時區 offset，跨日光節約時間切換仍維持使用者指定的當地鐘點。
- 任務成功訊息依實際同步開關區分「只存助理待辦」與「已排入 Google Tasks 同步」；文件與 migration 範圍同步更新至 `0013`。

## [5.8.0] - 2026-07-17

### Added

- **Phase 5A：Google Calendar 外部通知去重（`ENABLE_REMINDERS`）**：開啟 LINE 提醒時，寫入 Google 的行程設 `reminders.useDefault=false`（清空 overrides），Google 不再送自身預設通知，LINE 提醒成為單一通知源；未開 LINE 提醒則保留 Google 預設通知，不動使用者原本的行事曆提醒。

## [5.7.0] - 2026-07-17

### Added

- **Phase 4：語音建立行程**（`ENABLE_TRANSCRIPTION`）：LINE 語音訊息經轉錄後走與文字**完全相同**的 event-draft→確認→CRUD→Google 同步→提醒流程（架構本已支援）；語音的確認卡多一行「🎤 我聽到：<轉錄原文>」，讓使用者在確認前分辨「聽錯」與「解析錯」。音訊 buffer 只在轉錄期間存在記憶體、不落地。

### 決定不實作

- **圖片（海報／票券／截圖）建立行程**與 vision 信心欄位、多活動批次草稿——2026-07-17 決定不做；圖片維持看圖聊天。連同 CalDAV／ICS（原 5B）、分享與群組（原 8）、多頻道（原 9）、搜尋主題追蹤與多來源交叉（原 7）一併收斂，維持「個人單人自架、LINE 單頻道、即問即答」定位。詳見 `docs/ROADMAP.md`、`docs/DECISIONS.md`。

## [5.6.0] - 2026-07-17

### Added

- **Phase 0：run trace 接線**：`services/run-trace.js` 的 `recordCompletionRun` 接進 `generateCompletion`（聊天／搜尋）與行程／任務解析，記錄能力／模型／prompt·completion token／`cost_usd`／耗時／狀態，並輸出單行 JSON 結構化 log，**不含對話內容或憑證**。成本依 `OPENAI_PRICE_PER_1K_PROMPT`／`OPENAI_PRICE_PER_1K_COMPLETION` 估算（未設則只記 token）。觀測絕不影響主流程：無 DB 跳過、寫入失敗只記 log 不拋。同時補齊備份／還原與 worker crash 恢復演練 runbook（`docs/DEVELOPMENT.md`），**Phase 0 全項完成**。

## [5.5.0] - 2026-07-17

### Added

- **Phase 5A：Google Calendar 外部修改回收（限非週期、有時刻行程）**：在 Google 端修改 bot 建立的行程（開始時間／標題／地點／備註）會回收到本地並依新時間重排提醒。`applyInboundEventUpdate`＋migration `0013`（`provider_updated_at` 水位）。衝突政策：本地 `sync_status='synced'` 才吃外部修改，`pending`（剛用 bot 改）則跳過讓 outbound 先贏（bot 編輯優先）；水位擋自身 echo；套用時設 `synced` 不觸發 outbound（防同步迴圈）；不建立 Google-origin 新行程。

## [5.4.0] - 2026-07-17

### Added

- **Phase 5A：Google Calendar 外部刪除回收（`ENABLE_GOOGLE_CALENDAR_INBOUND`，預設關閉）**：以 sync token 增量輪詢接收 Google 端變更；在 Google 刪除／取消 bot 建立的行程會回收到本地（一併停掉提醒）。`services/google-calendar-inbound.js`＋migration `0012`（`sync_token`／`last_pulled_at`）。首拉建立基線、`410 GONE` 自動清 token 重建、節流 `CALENDAR_INBOUND_INTERVAL`；重用既有 `/cron/reminders`，不另建 cron。

## [5.3.0] - 2026-07-17

### Added

- **Phase 2 Google Tasks 單向同步（`ENABLE_GOOGLE_TASKS`，預設關閉）**：新增／完成／重開／刪除任務時同步到 Google Tasks。與 Calendar 共用同一 OAuth（`authorizationScopes` 依旗標累加 `tasks` scope，既有僅授權 Calendar 者重新 `連結 Google 行事曆` 即可）。`services/google-tasks.js` 複用 Calendar 的 `authorizedRequest`（已 export；改用 `isGoogleOAuthConfigured`，Tasks 可獨立於 Calendar 啟用）。migration `0011`（`provider_task_id`／`sync_status`／`synced_at`）。同步走 durable `google-tasks-sync` job（`idempotencyKey` 帶 `taskId:version:action`、有限重試）；4xx／未連結不重試，失敗只記 `sync_status='error'`、**本機任務一律保留**。`due` 只保留日期（時間丟棄，精確時間存本機）。授權回填與 Google 端 inbound sync 留下一切片。

## [5.2.0] - 2026-07-17

### Added

- **Phase 7 搜尋來源標註**：`search` 回覆在 AI 整理段下方附「📎 來源」清單（標題（來源站・時間）＋連結）。`utils/fetch-answer.js` 改回傳結構化 `sources`（前 3 筆 organic result 的 title/link/source/date/snippet，過濾無標題或連結者）。來源**只顯示、不進 prompt**——把來源事實與模型推論分開，也避免把來源內容塞進 prompt 放大注入風險。`search` 走 SerpAPI 固定端點無 SSRF。

## [5.1.0] - 2026-07-17

### Added

- **Phase 6 每日天氣推播訂閱（`ENABLE_WEATHER_PUSH`，預設關閉）**：`每日天氣 台北 8` 訂閱每天指定時刻的天氣、`取消每日天氣` 全取消、`我的天氣訂閱` 列出。`subscriptions` 表（migration `0010`）；`services/weather-subscription.js` 的 `nextWeatherRun`（使用者時區下一個推送時刻）、`enqueueDueWeatherReminders`（cron 每分鐘原子 claim 到期訂閱＋入列 `weather-daily` job，claim 與 enqueue 同一交易）、`sendDailyWeather`（查天氣 Push、沿用 `X-Line-Retry-Key` 冪等，訂閱已停用則跳過）。**重用 Phase 3 scheduler／delivery，不另建第二套 cron**：接進既有 `/cron/reminders`。訂閱走 `resolveLocation`，同名不明確時請使用者用更精確地名（不做多層追問）。新增 `bot-weather-subscribe`／`-unsubscribe`／`-subscriptions` 指令（zh/en/ja）。

## [5.0.2] - 2026-07-17

### Added

- **Phase 6 同名地點追問**：`天氣 嘉義` 等同名但分屬不同行政區時，不再靜默選第一筆。`services/weather/` 新增 `geocodeCandidates`（多候選）、`resolveLocation`（同名不同區→ambiguous）、`getWeatherByPlace`（座標直查、座標快取）；weather handler 回傳以座標綁定的 postback 選項（`天氣座標 <lat> <lon> <label>`），選定後跳過 geocode 直接查。第二層（選縣後再選鄉鎮）尚未做，縣層暫用最相關中心點。

## [5.0.1] - 2026-07-17

### Fixed

- **Phase 6 天氣意圖路由**：`今天天氣 嘉義`、`台北天氣如何` 這類自然語句原本未命中 `天氣 <地點>` 指令、被日期開頭的行程規則接手。weather handler 現在於 schedule 之前辨識隱式天氣意圖（天氣詞在句首或句尾），並統一從各種問法抽出地點；只攔截句首／句尾的天氣查詢，不誤搶含「天氣」的一般聊天長句；隱式攔截 gated on `ENABLE_WEATHER`（關閉時讓給行程／聊天）。

## [5.0.0] - 2026-07-17

### Added

- 完成 M1 個人助理閉環：單筆行程建立／追問／修改／完成／刪除、Supabase 任務 CRUD／篩選／重開，以及單次到點提醒、安靜時段與暫停／恢復，均已有真實 LINE 驗收證據。
- 任務新增與重開成功訊息明示：資料目前只存在助理待辦，尚未同步 Google Tasks，也不會建立 Google Calendar 行程。

### Changed

- 正式切換至 `5.0.0`；Google Tasks 同步保留為下一個獨立 5.x 版本，不屬於本次 M1 範圍。
- 文件、最新 review、版本政策與文件站同步標記 Phase 1–3 M1 驗收完成。

## [4.20.5] - 2026-07-17

### Fixed

- `行程 <內容>` 現在會進入既有結構化行程與提醒流程，不再落入一般對話；例如 `行程 5分鐘後的測試通知` 會先顯示確認草稿。`N 分鐘／小時／天後` 的開始時間由程式確定性計算，不接受模型算錯的時間。

### Documentation

- 記錄上游 `d84c806` 已納入本專案的來源基線；依上游近期 commit／merged PR 活躍度，決定目前不安排回貢。

## [4.20.4] - 2026-07-17

### Fixed

- `我的任務 明天／明日` 現在套用使用者時區的完整明日範圍，不再因未識別參數而退回全部未完成任務；今天／今日維持當日範圍。
- 新增任務時不再把 LINE 自動補上的句尾標點收進 `#標籤`；標籤查詢同時相容既有帶句號資料。
- 只有「本週／這週／下週」而沒有星期幾的任務期限改由程式固定為對應週日 09:00，不再接受模型任選週六等日期。
- 任務清單新增本星期／這個星期／下週／下周／下個星期等篩選；未知篩選會顯示用法，不再靜默列出全部任務。

### Changed

- M1 驗收狀態更新：Google Calendar 解除連結後可重新連結並完成授權，5A outbound 基線通過。
- 參考資料更新為 Toki（前身 Dola）現行官網、官方更新與品牌演進，並保留 Dola note／LINE VOOM 歷史研究入口及商業服務使用邊界。

## [4.20.3] - 2026-07-17

### Changed

- 從行程或任務清單點選第 N 筆時，LINE 對話會顯示操作名稱與序號，讓使用者知道選了哪一筆；真正的資料 ID 仍只放在不可見的 postback data。

### Fixed

- 任務的「今天／明天／後天」期限改用使用者時區做確定性日期校正，避免 UTC 跨日時被模型排到前一天。
- 天氣地點支援台灣常用縣市簡稱的確定性補全，例如 `台北` 會以 `台北市`、台灣重新查詢；同時正規化供應商回傳的台灣地名。

## [4.20.2] - 2026-07-17

### Fixed

- `記行程 明天下午看診` 不再讓模型擅自把模糊的「下午」補成 15:00；程式會保留已確定日期並追問確切時間。
- 「今天／明天／後天」先依使用者 IANA 時區解成日期，避免 UTC 跨日時把「明天」排成當天；即使模型回傳錯日期，也會由程式校正並保留當地時間與長度。

## [4.20.1] - 2026-07-16

### Fixed

- `我的任務 今天／本週` 改用使用者時區的完整半開起訖範圍，不再把更早的逾期任務混入；DST 邊界以實際 offset 解算。
- `TASK_LIST_LIMIT` 現在真正控制每頁筆數，並限制在 LINE quick reply 安全範圍 `1`–`6`。
- 天氣回覆補上 Open-Meteo 資料來源標示；同步修正版本歷史、M1 驗收狀態與文件站。

## [4.20.0] - 2026-07-16

- 新增 `天氣 <地點>`：Open-Meteo 當前天氣與 1–7 日預報、短期快取及明確 provider 失敗訊息；每日推播訂閱仍待後續切片。

## [4.19.0] - 2026-07-16

- 新增 `解除連結 Google 行事曆`：先嘗試撤銷 Google token，再刪除本地加密憑證；撤銷端已失效時仍允許本地解除。

## [4.18.0] - 2026-07-16

- 新增提醒安靜時段、暫停／恢復與過期跳過策略（migration `0009`）。多重提醒與自訂 offset 仍未完成，不宣稱完整 Phase 3。

## [4.17.0] - 2026-07-16

- 任務新增優先度、`#標籤`、已完成重開與每頁最多 6 筆的 LINE 分頁（migration `0008`）。

## [4.16.0] - 2026-07-16

- 任務新增自然語言期限解析，以及今天／本週／逾期／已完成篩選。

## [4.15.0] - 2026-07-16

- 新增 Phase 2 任務基礎：新增、列出、完成與刪除，資料獨立保存於 owner-scoped `tasks` 表（migration `0007`）。

## [4.14.0] - 2026-07-15

### Added

- Phase 1 補齊 durable 模糊時間追問、`修改行程`、重疊警告與 optimistic version；已有 Google 映射的行程修改以 PATCH 回寫。
- 新增 `0006_schedule_workflows.sql` 與對應 rollback，擴充 confirmation operation、target event、expected version 與 missing fields。

### Changed

- 同一 LINE 使用者在同一 webhook batch 的訊息依事件順序串行，不同使用者仍並行，避免 follow-up 競速。

> 以下 `4.10.0` 起為 SanHsien 版的變更；`4.9.1` 以下為上游 `memochou1993/gpt-ai-assistant` 的產品歷史紀錄。本專案沿用語意化版本；2026-07-18 起公開 Git 僅保留目前快照的單一 root commit。

## [4.13.2] - 2026-07-15

### Bug Fixes

- 修正提醒的「標記完成」把 Google provider event id 當 PostgreSQL UUID 查詢，造成 `invalid input syntax for type uuid`、無法同步完成狀態的問題；完成與刪除現在可安全解析本機 UUID 或 Google provider id。
- 行程確認、取消、完成、刪除與同步處理快捷鍵改用 LINE postback。聊天畫面只顯示自然指令，內部 confirmation token／event id 留在不可見的 postback data，且不寫入對話 history。
- 提醒快捷鍵固定使用本機 event UUID，降低外部 provider id 進入內部資料路徑的機會；純文字帶 ID 指令仍保留作手動排錯備援。

## [4.13.1] - 2026-07-15

### Bug Fixes

- Google Calendar 確認後不再回覆「已建立、正在同步」過渡訊息；只在 Google 實際同步成功後通知，或在最後一次失敗後提供可操作的失敗訊息。
- 每分鐘 Supabase Cron 現在同時處理到點提醒、Google Calendar 同步與最終狀態通知，不再需要等下一則 webhook 才繼續 durable retry。
- 最終失敗新增「重試同步／暫不處理／刪除行程」；暫不處理只保留 Supabase 資料並停止詢問，可從「同步失敗行程」稍後重試或明確刪除。
- 修正 Google 模式將本機 event UUID 誤當 Google event id 刪除的路徑；未同步行程現在只刪 owner-scoped 本機資料。

## [4.13.0] - 2026-07-15

### Features

- **行程（Phase 1，`ENABLE_SCHEDULE`，預設關閉）**：`記行程 明天下午三點跟王醫師看診` → OpenAI 解析成結構化草稿 → 回傳帶「確認 / 取消」按鈕的訊息 → 確認後才寫入 `events`。新增 `app/handlers/schedule.js`、`services/schedule.js`、三個指令（`記行程` / `確認行程` / `取消行程`，含 en/ja 語系）與 `getLatestPendingConfirmation()`。
- 行程安全邊界：模型輸出使用 OpenAI JSON Schema 並再經 `schemas/event-draft.js` 白名單驗證；確認／取消按鈕綁定該草稿 token，`SELECT ... FOR UPDATE` 保證重複或併發確認只建立一筆，不會讓舊卡片誤確認最新草稿。
- 行程解析使用獨立參數：`temperature=0`、penalty=0、空 stop sequences、`SCHEDULE_MAX_TOKENS=400`；選填欄位的 `null` 正規化為未提供。真實 OpenAI smoke test 已驗證「明天下午三點」的台北時區結果。
- **行程查詢、刪除與個人時區**：新增 `我的行程`（列出近期行程，每筆帶綁定 event id 的一鍵刪除快捷鍵）、`刪行程 <id>`（由列表按鈕觸發）與 `設定時區 <IANA>`（以 `Intl` 驗證後 upsert 到 `users.timezone`，無效時區拒絕寫入）。三指令含 zh/en/ja 語系，全部 owner-scoped。
- **Google Calendar 單向接線（`ENABLE_GOOGLE_CALENDAR`，預設關閉）**：新增 `連結 Google 行事曆`、受 IP rate limit 保護的 web-server OAuth callback、`calendar.events.owned` 最小 scope、一次性 SHA-256 state、S256 PKCE、AES-256-GCM 加密 token／verifier，以及 migration `0004_google_calendar.sql`。確認後以 deterministic Google event id + durable job 冪等新增；`我的行程`／刪除直接操作 Google Calendar，授權後回補既有未同步未來行程。完整雙向同步尚未完成。
- 日期開頭且不是問句的文字（例如 `7/20 借保貸交信用卡`）會直接進行程確認流程，不再落入一般問答；日期問句與算式仍交給聊天 handler。
- **星期解消、完成與到點提醒**：裸 `星期五`／`週五` 取下一個尚未跨過的同名日，`本週`／`這週`／`這個星期`／`下週`／`下個星期` 依字面固定後再交給模型；`我的行程` 新增完成按鈕，Google 事件會以 `[完成]` 與 private metadata 標記。migration `0005` 加入 completed state、加密 LINE target 與 reminder job mapping；Supabase Cron 每分鐘呼叫 fail-closed endpoint，LINE Push 以 job UUID 作 `X-Line-Retry-Key`，409 視為前次已送達。
- Production OAuth app 已由 Testing 發布為 In Production，避免 Calendar refresh token 7 天到期。個人用途暫未送 Google 驗證，首次授權仍有未驗證警告與 100 位新使用者上限。

### Infrastructure

- **Durable checkpoint（`db/migrations/0003_job_checkpoints.sql`）**：把「AI 已完成」（`jobs.result`，加密）與「LINE 已送達」（`jobs.delivered_at`）拆成兩個 checkpoint，語意變成 **AI 至多執行一次、送達可重試多次**。送達之所以能安全重試，是因為 LINE 的 reply token 只能用一次——重送同一個 token 不會產生重複訊息，因此仍不使用計額度的 push。
- 這修掉了前一版 at-most-once 的真正損失情境：LINE 暫時 5xx 或 worker 在送達階段被砍時，訊息不再永久消失。`WORKER_MAX_ATTEMPTS` 因此從 1 恢復為 3——**「不重複付費」改由 checkpoint 保證，不再靠 `max_attempts=1`**。
- AI 階段的失敗（含函式被砍後重新領取而 `result` 仍為空）一律不重試，避免重複計費；reply token 失效（4xx）同樣直接 dead-letter，只有 429 與 5xx 才重試。
- `saveJobResult()` / `markJobDelivered()` 遇到欄位不存在（`42703`）時退回無 checkpoint 行為，讓「先部署、後套 migration」的空窗期不會整批失敗。
- `app/app.js` 拆出 `prepareEvents()`（只跑處理流程、不送出訊息），供 worker 在送出前先 checkpoint AI 結果；同步路徑行為不變。
- `0003_job_checkpoints.sql` 已套用至 Production Supabase，並補上 latest-only rollback 檔。

- Phase 0 資料庫基礎（inert，尚未接入 webhook）：新增 `services/database.js`（`pg`、`DATABASE_URL` 驅動、fail closed）、`db/migrations/0001_init.sql`（users / processed_events / jobs / runs）、`repositories/processed-events.js`（`ON CONFLICT` 原子冪等）與對應 mock 測試。未設定 `DATABASE_URL` 時完全不使用，bot 行為不變。
- Phase 0 durable queue（inert）：新增 `repositories/jobs.js`（enqueue／`FOR UPDATE SKIP LOCKED` 原子領取／complete／retry-or-dead-letter）與 `services/jobs.js`（指數退避 + `runJob`），含 mock 測試。
- Phase 0 run-trace 與使用者 repository（inert）：新增 `repositories/runs.js` + `services/run-trace.js`（記錄能力／模型／耗時／成本／狀態，不存對話內容）與 `repositories/users.js`（upsert / 查詢），含 mock 測試。
- Phase 1 行程草稿驗證器（純函式，尚未接入）：新增 `schemas/event-draft.js`（`validateEventDraft`）——拒絕未定義欄位、title/start 必填、end 需晚於 start、IANA timezone 檢查、recurrence 規格與正規化輸出，含完整測試。
- Phase 1 確認 state machine（純函式，尚未接入）：新增 `services/confirmation.js`（draft → confirmed/cancelled）——一次性寫入（commit）只在首次確認觸發，重送確認為 no-op，落實「重送確認不得重複寫入」，含測試。
- Phase 1 行程資料層與解析器（inert，尚未接入）：新增 `db/migrations/0002_events.sql`（events 表，owner 外鍵）、`repositories/events.js`（create/get/list/update/delete，全 owner-scoped、update 遞增 version）與 `services/schedule-parser.js`（自然語言→draft，LLM completion 可注入、輸出一律經 event-draft 驗證），含 mock 測試。
- Supabase Production 已上線：Tokyo transaction pooler、CA verified TLS、SSL enforcement、migration checksum runner 與 latest-only rollback runner。
- 修正 Phase 0 併發缺口：processed-event + job 原子入列、lease fencing token、DB-backed durable confirmation，並以真實 Supabase 併發驗證。
- durable 私密資料改為 AES-256-GCM job payload；LINE user id 只儲存 deployment-scoped HMAC 代碼，不以原始值落庫。
- **webhook 接上佇列（`APP_WEBHOOK_QUEUE`，預設關閉）**：驗簽後以單一 transaction 完成去重登記與入列，durable event 立刻回 `200`，再用 Vercel `waitUntil()` 於同一次調用內 `drainQueue()`。queue 模式把 redelivery 交給 Postgres 去重，修掉 per-instance in-memory Set 無法跨 instance 防重的問題；旗標關閉時仍走原本同步路徑。
- 佇列模式的成本護欄：worker 明確禁止 reply 失敗時改用 push；checkpoint 上線後 delivery retry 只重送加密結果，不重跑付費 AI／生圖。DB 故障或事件缺 `webhookEventId` 時 fail open 退回同步處理，但必須處理成功後才 ACK。
- webhook 入列錯誤 log 不再包含未信任的 event id／錯誤文字，修正 CodeQL `js/log-injection`。
- `services/database.js` 的 Supabase 判斷補上 direct connection 主機名（`db.<ref>.supabase.co`），避免改用直連字串時跳過 CA 強制驗證。

### Bug Fixes

- Google Calendar 連結指令接受「連結Google行事曆」等無空格寫法，以及常見的「連接／綁定／授權」變體，避免誤落入一般 OpenAI 對話。

### Documentation

- 盤點 Dola 官方功能文章、功能頁與 LINE VOOM 27 篇公開貼文，建立個人助理功能路線圖。
- 明定先完成 Supabase Postgres、durable queue、worker、scheduler 與 DB 冪等，再分階段加入行程、任務、提醒、多模態建行程、日曆同步、天氣、搜尋與分享。
- 同步 README、開發架構、決策紀錄、fermi／參考專案評估與 agent 指引；Dola 僅作產品行為參考，不複製程式碼、品牌、文案或素材。
- 將個人助理、模型／API、fermi、參考專案與授權評估合併為單一 `docs/ROADMAP.md`；上游 PR 評估併入 `REVIEW.md`，維護文件收斂為 roadmap、development、decisions 三個入口。
- 重整 `gpt-ai-assistant-docs` 文件站，改為開始使用、功能、設定、疑難排解與更新摘要，並同步 v4.12.3 模型、private Blob、webhook 去重及環境變數。

## 4.12.3 (2026-07-12)

### Bug Fixes

- GPT Image 改成以 `private` access 上傳到實際的 private Vercel Blob store，再產生只允許單一圖片 GET、約 7 天有效的 signed URL 給 LINE。
- LINE webhook 依 `deliveryContext.isRedelivery` 與 `webhookEventId` 去重；同一事件只處理一次，避免 webhook timeout redelivery 重複呼叫付費 API 與重複回覆。

### Tests

- 新增 redelivery、重複事件 ID、同批重複事件與舊格式事件測試；Blob 測試覆蓋 private upload、OIDC／靜態 token 與 signed GET URL。

## 4.12.2 (2026-07-12)

### Bug Fixes

- 生圖預設由已 deprecated、且部分 OpenAI project 無法使用的 `dall-e-3` 改為現行 `gpt-image-2`，修正 `The model 'dall-e-3' does not exist`。
- GPT Image 預設品質設為 `low` 控制成本；明確選用 DALL-E fallback 時仍自動使用相容的 `standard`。
- 生圖改用獨立 55 秒 API timeout，Vercel function 上限由 10 秒提高至 Hobby 相容的 60 秒，避免換模型後立刻逾時。
- 新增預設模型與 fallback 品質的設定回歸測試，並同步更新部署文件。

### Security

- URL 摘要的 HTML 轉文字改用 `html-to-text` parser，不再用 regex 過濾 tag 或逐次取代 entity，修正 CodeQL `bad-tag-filter` 與 `double-escaping` alerts。

## 4.12.1 (2026-07-12)

### Bug Fixes

- Blob 圖片上傳改為支援 Vercel **OIDC** 認證：`BLOB_READ_WRITE_TOKEN` 改為選用。在 Vercel 連結 Blob store（注入 `BLOB_STORE_ID`）後，`@vercel/blob` 會走 OIDC 自動認證，不再需要靜態 token；原本硬性要求 token 的檢查已移除。

## 4.12.0 (2026-07-12)

### New Features

- 支援 GPT Image（`gpt-image-1`，回傳 base64）：偵測到 base64 回應時自動上傳 **Vercel Blob** 取得公開 URL 給 LINE。需在 Vercel 連結 Blob store（`BLOB_READ_WRITE_TOKEN`）並設 `OPENAI_IMAGE_GENERATION_MODEL=gpt-image-1`。預設 `dall-e-3`（URL）不變、不需 Blob。

### Changes

- 新增相依 `@vercel/blob`。生圖流程改為同時支援 URL（DALL·E）與 base64（GPT Image）回應。

## 4.11.0 (2026-07-12)

### New Features

- 網址摘要：`ENABLE_URL_SUMMARY`（預設 `false`）。開啟後對話訊息含網址時，會經 SSRF-safe 抓取網頁純文字作為上下文交給模型摘要/回應。相關設定 `URL_FETCH_TIMEOUT` / `URL_FETCH_MAX_BYTES` / `URL_FETCH_MAX_CHARS`。

### Security

- 內建 SSRF 防護（僅 http/https、拒絕私有/迴環/保留 IP、禁 redirect、限大小/逾時、僅 text 內容）。殘留風險（DNS rebinding、prompt injection）見 `docs/DEVELOPMENT.md`；功能預設關閉。

## 4.10.0 (2026-07-12)

### New Features

- 能力 feature flags：`ENABLE_IMAGE_GENERATION` / `ENABLE_TRANSCRIPTION` / `ENABLE_VISION` / `ENABLE_SEARCH`（預設全開，可 `=false` 關閉控成本）。
- 對話脈絡存活時間上限：`APP_MAX_PROMPT_AGE`（秒，預設 `0`＝停用；設正整數時久未互動的對話 context 自動過期）。
- 群組回覆政策：`GROUP_REPLY_REQUIRES_MENTION`（預設 `false`；`true` 時群組需點名才回，減少噪音）。
- 語音轉錄模型可設定：`OPENAI_TRANSCRIPTION_MODEL`。

### Changes

- 升級預設模型（皆可用環境變數覆寫）：對話 `gpt-3.5-turbo` → `gpt-4o-mini`、生圖 `dall-e-2` → `dall-e-3`（尺寸預設 `1024x1024`）、語音 `whisper-1` → `gpt-4o-mini-transcribe`。
- storage 改為 per-record 寫入（`APP_STORAGE_RECORD_*`），避免不同 user/group 併發覆蓋整包狀態。
- `version` 指令與更新檢查改比對本 fork（`SanHsien/gpt-ai-assistant`），不再指向上游。

### Reliability

- LINE reply 失敗時自動改用 Push API 送出（`utils/reply-message.js` + `services/line.js` 新增 `push`），避免訊息靜默遺失。

### Bug Fixes

- 群組 `forget` 依 context id 清除歷史（原用 userId，群組清不掉）。
- `search` 在 SerpAPI 無 `organic_results` 時不再 crash。
- `version` 指令與健康檢查路由在外部呼叫失敗時不再拖垮整批回覆 / 掛住請求（加 timeout + try/catch）。
- 實際送出 `OPENAI_COMPLETION_STOP_SEQUENCES` 到 API。
- 移除語音轉錄無用的 `/tmp` 暫存檔寫入。

### Security

- webhook 在缺少 `LINE_CHANNEL_SECRET` 時 fail closed（回 500），不再用空 key 驗簽。
- `.env.example` 預設 `APP_DEBUG=false`，避免對話內容進入 production log。
- 新增 CodeQL 掃描與 Dependabot 自動更新；相依漏洞清零。

### Tooling

- 新增 GitHub Actions CI（`.github/workflows/ci.yml`）：每次 push / PR 跑 eslint + jest。
- README 加上 CI 與 CodeQL 即時狀態徽章。

## 4.9.1 (2024-07-10)

### Bug Fixes

- Update `talk` command

## 4.9.0 (2024-07-10)

### New Features

- Support `gpt-4o` model

## 4.8.4 (2024-07-06)

### Bug Fixes

- Update status page

## 4.8.3 (2024-02-03)

### Bug Fixes

- Fix `maxDuration` for `vercel.json`

## 4.8.2 (2024-02-03)

### Bug Fixes

- Use `gl` param for SerpApi
- Remove `SERPAPI_LANG` environment variable

## 4.8.1 (2024-02-03)

### Bug Fixes

- Add `maxDuration` for `vercel.json`

## 4.8.0 (2023-12-07)

### New Features

- Support fine-tuned models

## 4.7.6 (2023-11-18)

### Bug Fixes

- Change default max groups to 1000
- Change default max users to 1000
- Change default max prompt messages to 4
- Change default max prompt tokens to 160
- Change default completion temperature to 1
- Change default completion max tokens to 64

## 4.7.5 (2023-10-01)

### Bug Fixes

- Update status page

## 4.7.4 (2023-08-26)

### Bug Fixes

- Update status page

## 4.7.3 (2023-08-25)

### Bug Fixes

- Fix commands

## 4.7.2 (2023-08-05)

### Bug Fixes

- Fix `translate` command

## 4.7.1 (2023-08-01)

### Bug Fixes

- Optimize `search` command
- Add aliases for commands

## 4.7.0 (2023-06-08)

### New Features

- Add `OPENAI_COMPLETION_STOP_SEQUENCES` environment variable

## 4.6.0 (2023-05-03)

### New Features

- Support `gpt-4` model

## 4.5.0 (2023-04-27)

### New Features

- Support `zh_CN` locale

## 4.4.4 (2023-03-21)

### Bug Fixes

- Fix default value of `APP_MAX_GROUPS` environment variable
- Fix default value of `APP_MAX_USERS` environment variable

## 4.4.3 (2023-03-11)

### Bug Fixes

- Fix wording of `doc` and `report` commands

## 4.4.2 (2023-03-11)

### Bug Fixes

- Add `ERROR_MESSAGE_DISABLED` environment variable
- Deprecate `ERROR_TIMEOUT_DISABLED` environment variable

## 4.4.1 (2023-03-10)

### Bug Fixes

- Add default max prompt tokens for chat completion api

## 4.4.0 (2023-03-08)

### New Features

- Support snapshots of `gpt-3.5-turbo` model

## 4.3.0 (2023-03-08)

### New Features

- Add `VERCEL_TEAM_ID` environment variable

## 4.2.2 (2023-03-08)

### Bug Fixes

- Optimize error handling

## 4.2.1 (2023-03-07)

### Bug Fixes

- Fix `add-mark` util

## 4.2.0 (2023-03-05)

### New Features

- Add `APP_INIT_PROMPT` environment variable

## 4.1.3 (2023-03-05)

### Bug Fixes

- Fix `add-mark` util

## 4.1.2 (2023-03-05)

### Bug Fixes

- Update `add-mark` util

## 4.1.1 (2023-03-05)

### Bug Fixes

- End text with dot

## 4.1.0 (2023-03-05)

- Support `whisper-1` model
- Add `opencc` text converter
- Store display name and group name to storage

## 4.0.4 (2023-03-03)

### Bug Fixes

- Optimize `search` command

## 4.0.3 (2023-03-03)

### Bug Fixes

- Optimize `search` and `draw` commands

## 4.0.2 (2023-03-02)

### Bug Fixes

- Fix prompt messages

## 4.0.1 (2023-03-02)

### Bug Fixes

- Fix `enquire` command

## 4.0.0 (2023-03-02)

### New Features

- Support `gpt-3.5-turbo` model

### Bug Fixes

- Rename `APP_MAX_PROMPT_SENTENCES` environment variable to `APP_MAX_PROMPT_MESSAGES`

## 3.7.0 (2023-02-26)

### New Features

- Add demo for `search` command
- Add `SERPAPI_LOCATION` environment variable
- Add `SERPAPI_LANG` environment variable

## 3.6.0 (2023-02-26)

### New Features

- Add `APP_API_TIMEOUT` environment variable
- Add `APP_MAX_PROMPT_SENTENCES` environment variable
- Add `APP_MAX_PROMPT_TOKENS` environment variable

## 3.5.0 (2023-02-26)

### New Features

- Rename `HUMAN_BACKGROUND` environment variable to `HUMAN_INIT_PROMPT`
- Rename `BOT_BACKGROUND` environment variable to `BOT_INIT_PROMPT`

## 3.4.1 (2023-02-25)

### Bug Fixes

- Fix default bot name

## 3.4.0 (2023-02-24)

### New Features

- Add `info` endpoint

## 3.3.5 (2023-02-24)

### Bug Fixes

- Fix prompt wording

## 3.3.4 (2023-02-24)

### Bug Fixes

- Fix prompt wording

## 3.3.3 (2023-02-24)

### Bug Fixes

- Fix tests

## 3.3.2 (2023-02-23)

### Bug Fixes

- Fix prompt wording

## 3.3.1 (2023-02-23)

### Bug Fixes

- Fix prompt wording

## 3.3.0 (2023-02-23)

### New Features

- Add `BOT_TONE` environment variable

## 3.2.1 (2023-02-22)

### Bug Fixes

- Fix timeout wording

## 3.2.0 (2023-02-22)

### New Features

- Add `HUMAN_NAME` environment variable
- Add `HUMAN_BACKGROUND` environment variable
- Add `BOT_BACKGROUND` environment variable

## 3.1.0 (2023-02-21)

### New Features

- Implement `forget` command

## 3.0.0 (2023-02-18)

### New Features

- Implement `search` command

## 2.5.1 (2023-02-18)

### New Features

- Rename `BOT_TIMEOUT_DISABLED` environment variable to `ERROR_TIMEOUT_DISABLED`

## 2.5.0 (2023-02-18)

### New Features

- Add `BOT_TIMEOUT_DISABLED` environment variable

## 2.4.0 (2023-02-17)

### New Features

- Add `BOT_DEACTIVATED` environment variable

## 2.3.0 (2023-02-11)

### New Features

- Add `VERCEL_TIMEOUT` environment variable
- Add `OPENAI_TIMEOUT` environment variable
- Add `LINE_TIMEOUT` environment variable

## 2.2.0 (2023-02-04)

### New Features

- Implement `retry` command

## 2.1.4 (2023-01-15)

### Bug Fixes

- Ignore non-text message events

## 2.1.3 (2023-01-15)

### Bug Fixes

- Add command aliases

## 2.1.2 (2023-01-15)

### Bug Fixes

- Add command aliases

## 2.1.1 (2023-01-14)

### Bug Fixes

- Fix `enquire` command

## 2.1.0 (2023-01-11)

### New Features

- Add `VERCEL_PROJECT_NAME` environment variable

## 2.0.1 (2023-01-11)

### Bug Fixes

- Add logs for webhook endpoint

## 2.0.0 (2023-01-10)

### New Features

- Implement `sum` command
- Implement `analyze` command
- Implement `translate` command
- Add `BOT_NAME` environment variable
- Add `APP_MAX_GROUPS` environment variable
- Add `APP_MAX_USERS` environment variable

### Bug Fixes

- Remove `SETTING_AI_NAME` environment variable
- Remove `SETTING_AI_ACTIVATED` environment variable
- Refactor `storage` module
- Refactor `prompt` module
- Refactor `history` module

## 1.12.4 (2022-12-31)

### Bug Fixes

- Rename `chat` command to `talk`

## 1.12.3 (2022-12-31)

### Bug Fixes

- Update command template

## 1.12.2 (2022-12-30)

### Bug Fixes

- Fix summarize request wording

## 1.12.1 (2022-12-30)

### Bug Fixes

- Handle non-text messages

## 1.12.0 (2022-12-30)

### New Features

- Implement `summarize` command

## 1.11.3 (2022-12-29)

### Bug Fixes

- Add command aliases

## 1.11.2 (2022-12-26)

### Bug Fixes

- Handle error messages in every commands

## 1.11.1 (2022-12-26)

### Bug Fixes

- Trim AI Name when sending prompt

## 1.11.0 (2022-12-26)

### New Features

- Implement `call` command
- Add `SETTING_AI_NAME` environment variable
- Add `SETTING_AI_ACTIVATED` environment variable

### Bug Fixes

- Remove `APP_STORAGE` environment variable

## 1.10.2 (2022-12-25)

### Bug Fixes

- Rename methods

## 1.10.1 (2022-12-25)

### Bug Fixes

- Fix wording of commands

## 1.10.0 (2022-12-25)

### New Features

- Add `OPENAI_IMAGE_GENERATION_SIZE` environment variable

### Bug Fixes

- Remove `SETTING_IMAGE_GENERATION_SIZE` setting

## 1.9.1 (2022-12-24)

### Bug Fixes

- Rename functions and variables

## 1.9.0 (2022-12-24)

### New Features

- Implement dynamic configuration
- Implement `configure` command
- Add `SETTING_IMAGE_GENERATION_SIZE` setting

## 1.8.0 (2022-12-24)

### New Features

- Implement `doc` command

### Bug Fixes

- Rename `settings` command to `command`

## 1.7.1 (2022-12-23)

### Bug Fixes

- Fix wording of commands

## 1.7.0 (2022-12-23)

### New Features

- Implement localization
- Implement command aliases

### Bug Fixes

- Rename `OPENAI_COMPLETION_INIT_LANG` environment variable to `APP_LANG`

## 1.6.0 (2022-12-23)

### New Features

- Implement `settings` command

### Bug Fixes

- Rename `chat --auto-reply off` command to `deactivate`
- Rename `chat --auto-reply on` command to `activate`
- Rename `CHAT_AUTO_REPLY` setting to `AI_ACTIVATED`

## 1.5.0 (2022-12-22)

### New Features

- Implement `continue` command with quick reply feature

### Bug Fixes

- Change default max completion tokens to 160
- Change default max prompt messages to 16

## 1.4.6 (2022-12-20)

### Bug Fixes

- Add comments

## 1.4.5 (2022-12-19)

### Bug Fixes

- Add `ja` initial language
- Add `ai` alias for `chat` command

## 1.4.4 (2022-12-18)

### Bug Fixes

- Rename `AI_AUTO_REPLY` setting to `CHAT_AUTO_REPLY`
- Fix case sensitivity of command issues

## 1.4.3 (2022-12-18)

### Bug Fixes

- Rename `ai` command to `chat`
- Rename `ai --auto-reply off` command to `chat --auto-reply off`
- Rename `ai --auto-reply on` command to `chat --auto-reply on`
- Rename `image` command to `draw`

## 1.4.2 (2022-12-18)

### Bug Fixes

- Refactor commands

## 1.4.1 (2022-12-18)

### Bug Fixes

- Refactor tests

## 1.4.0 (2022-12-18)

### New Features

- Implement `image` command

## 1.3.1 (2022-12-18)

### Bug Fixes

- Rename `VERCEL_WEBHOOK_URL` environment variable to `VERCEL_DEPLOY_HOOK_URL`

## 1.3.0 (2022-12-18)

### New Features

- Implement custom webhook path
- Add `APP_WEBHOOK_PATH` environment variable

## 1.2.1 (2022-12-18)

### Bug Fixes

- Refactor main functions

## 1.2.0 (2022-12-17)

### New Features

- Implement `deploy` command
- Add `VERCEL_WEBHOOK_URL` environment variable

## 1.1.3 (2022-12-17)

### Bug Fixes

- Fix storage module
- Fix `ai --auto-reply off` command
- Fix `ai --auto-reply on` command

## 1.1.2 (2022-12-16)

### Bug Fixes

- Refactor utility functions

## 1.1.1 (2022-12-16)

### Bug Fixes

- Rename `VERCEL_API_KEY` environment variable to `VERCEL_ACCESS_TOKEN`
- Rename `LINE_API_KEY` environment variable to `LINE_CHANNEL_ACCESS_TOKEN`
- Rename `LINE_API_SECRET` environment variable to `LINE_CHANNEL_SECRET`

## 1.1.0 (2022-12-16)

### New Features

- Implement `version` command
- Implement `ai` command
- Implement `ai --auto-reply off` command
- Implement `ai --auto-reply on` command
- Add Vercel API module
- Add `VERCEL_API_KEY` environment variable
- Add `LINE_API_SECRET` environment variable

### Bug Fixes

- Fix timeout issues

## 1.0.0 (2022-12-11)

### New Features

- Implement chat feature
- Add OpenAI API module
- Add LINE API module
