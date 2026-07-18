# 產品路線圖與技術評估

> **Goal:** 在保留「LINE + OpenAI、自架、自備 API key」的前提下，把目前的生成式 AI bot 演進成可可靠管理行程、任務、提醒、日曆、天氣、搜尋與分享的個人助理。
>
> **Architecture:** LINE webhook 只負責驗簽、冪等登記、入列與快速回應；背景 worker 執行 AI 與外部 API；Postgres 保存結構化狀態；scheduler 產生提醒與天氣推播工作。所有寫入先由模型產生結構化草稿，通過程式驗證並由使用者確認後才提交。
>
> **Tech Stack:** Node.js / Express、LINE Messaging API、OpenAI API、Supabase Postgres（含 migration；queue 優先採 pgmq 或等價 durable queue）、Vercel、Jest、ESLint。

日期：2026-07-17

本文件是本 repo 唯一的「未來做什麼」入口，合併原本分散的個人助理、API／模型、fermi、其他參考專案與授權策略評估。開發操作見 [`DEVELOPMENT.md`](DEVELOPMENT.md)，已作成的決策見 [`DECISIONS.md`](DECISIONS.md)。

## 決策摘要

- 這是已核准的產品方向，不再只是候選研究；但採漸進實作，不整套重寫。
- fermi 的 Supabase、queue worker、run trace 經驗作為可靠性基礎；不複製 fermi 原始碼，也不把 OpenRouter 改成預設供應商。
- Toki（前身 Dola）是商業產品與行為規格參考，不是原始碼來源。本 repo 不使用其品牌、文案、圖片、介面素材或未公開實作。
- Google Calendar OAuth 是使用者授權日曆資料所必需，與已排除的「用 ChatGPT 訂閱 OAuth 取代 OpenAI API key」無關。
- LINE 優先。Telegram、WhatsApp 等頻道只在核心能力穩定後以 adapter 評估；不承諾無官方 server-side API 的 iMessage 整合。

## 研究範圍

本規劃檢視了：

- [Toki 繁體中文官網](https://toki.com/zh-hant)
- [Toki 官方更新](https://toki.com/zh-hant/updates)
- [Toki 官方品牌演進（含 Dola 時期）](https://toki.com/brand)
- [Dola 學生使用與功能總覽](https://note.com/dola_ai/n/nc457877a6b09)
- [Dola 搜尋與來源連結](https://note.com/dola_ai/n/n16ddb7870ef1)
- [Dola 每日天氣推播](https://note.com/dola_ai/n/nd97abc97566e)
- [Dola 行程分享](https://note.com/dola_ai/n/n453ade17c542)
- [Dola 舊版功能頁](https://heydola.com/features)
- [Dola / Toki LINE VOOM](https://linevoom.line.me/user/_deGOEUAnNSgP1QW6kUVOtnQRZ3lnRXY7A0ukxwQ?=) 的 27 篇公開貼文（2023-11-21 至 2024-06-25）

VOOM 貼文除了功能發布，也包含節慶、電影、直播、遊戲活動、寵物照護等提醒案例。這些案例沒有形成額外獨立功能，但確認下列需求：批次建立行程、群組情境、海報／票券／截圖擷取、六曜與國定假日查詢、跨時區分享。

## 能力差距

| 能力 | 本 repo 現況 | 目標 | 前置依賴 |
| --- | --- | --- | --- |
| 一般對話、翻譯、摘要、分析 | 已有 | 保留並納入 capability router | 無 |
| 語音轉文字、圖片理解、生圖 | 已有；**語音已接行程草稿**（轉錄→同一 event-draft 流程＋回顯聽到原文） | 語音建行程完成；圖片建行程（票券／海報擷取）決定不做 | 結構化輸出、確認流程 |
| 網路搜尋 | 部分：SerpAPI 搜尋 | 多來源摘要、原文連結、查到活動後可建立行程 | 來源資料模型、引用格式 |
| 行程 CRUD / 查詢 | 已完成：新增、查詢、修改、刪除、時區、追問與確認、**週期行程（建立＋同步＋週期提醒）** | —（批次建立決定不做） | 週期 round-trip、外部衝突政策 |
| 任務 / ToDo | 基線完成：新增、列表、完成／重開、刪除、期限／標籤／狀態篩選 | 批次操作與行程關聯 | Postgres、時區 |
| 提醒 | 到點提醒、多重（lead）提醒（`REMINDER_OFFSETS`）、Cron、retry key、安靜時段、暫停／恢復 | 每使用者配額觀測 | scheduler、queue、冪等 |
| 日曆同步 | 部分完成：Google OAuth、bot 管理 event 的新增／修改／查詢／刪除、最終狀態與失敗重試、外部刪除回收與 timed 修改 round-trip | Google Calendar 雙向同步（CalDAV／ICS 決定不做） | sync token、週期 round-trip、衝突政策 |
| 天氣 | 查詢基線完成：Open-Meteo 現況與 1–7 日預報 | 地點歧義追問、指定地點每日推播 | scheduler、subscriptions |
| 行程分享 | 決定不做（2026-07-17，個人單人定位） | — | — |
| 群組協作 | 決定不做（2026-07-17，個人單人定位） | — | — |
| 多訊息平台 | LINE only；多頻道 adapter 決定不做（2026-07-17） | — | — |

## 目標架構

```text
LINE webhook
  -> signature + payload limits
  -> webhookEventId idempotency record
  -> durable queue
  -> immediate 2xx ACK

worker
  -> normalize channel event
  -> intent / capability router
  -> structured draft + deterministic validation
  -> confirmation state machine
  -> Postgres transaction
  -> LINE reply or Push API

scheduler
  -> claim due jobs atomically
  -> reminder / weather subscription worker
  -> delivery idempotency + retry + dead letter

adapters
  -> OpenAI / SerpAPI or search provider
  -> Google Calendar / CalDAV
  -> weather provider
  -> LINE delivery
```

6.0 已移除 Vercel env storage；Postgres 是唯一 durable source of truth。短期對話 context 保持記憶體內且可遺失，避免把原始使用者對話落庫。

## 核心資料模型

| 實體 | 重要欄位與規則 |
| --- | --- |
| `users` | channel user key（雜湊／內部 ID）、IANA timezone、locale、quiet hours、consent；不保存不必要的 LINE 個資 |
| `events` | owner、title、start/end、timezone、all-day、location、notes、recurrence、status、version |
| `reminders` | event/task、offset 或 absolute time、delivery channel、next run、status；唯一 delivery key |
| `tasks` | title、description、priority、due time、status、completed time；可選關聯 event |
| `calendar_accounts` | provider、加密 token、scopes、expiry、sync cursor；token 不進 log |
| `calendar_event_links` | internal event、external calendar/event ID、etag/version、last synced hash |
| `subscriptions` | weather、location、timezone、schedule、enabled、last delivery（topic 追蹤決定不做） |
| `jobs` | kind、payload reference、run at、lease、attempts、status、idempotency key、last error |
| `runs` / `run_steps` | event、capability、耗時、model、token/cost metadata、結果狀態；不預設保存完整對話內容 |
| `share_links` | event、不可逆 token hash、scope、expiry、revoked time、view count limit |

所有 schema 由 migration 建立；寫入需有 owner boundary、唯一鍵、外鍵與必要索引。時間儲存為 UTC，並保留原始 IANA timezone 供週期行程與顯示使用。

## Phase 0：可靠性與持久化基礎

這一階段是所有新功能的阻擋條件。

- [x] 建立 `db/migrations/` 與 Supabase Postgres schema，先涵蓋 users、jobs、runs、processed events。
- [x] 新增 `services/database.js` 與 repository 層；業務 handler 不直接組 SQL。
- [x] 將 `webhookEventId` 冪等升級為 DB 唯一約束；原始 delivery／redelivery 都交由原子 transaction 判斷。
- [x] 新增 durable queue 與 worker；webhook 驗簽、入列、ACK，再以 Vercel `waitUntil()` drain。
- [x] 新增 job lease、fencing token、有限次數 retry、指數退避與 dead-letter 狀態。
- [x] 建立 run trace、結構化 log 與能力／模型／token 成本欄位；對話內容與憑證必須遮罩。（`services/run-trace.js` 的 `recordCompletionRun` 接進 `generateCompletion`＋schedule／task 解析；記能力／模型／prompt·completion token／`cost_usd`（依 `OPENAI_PRICE_PER_1K_*` 估算）／耗時／狀態，單行 JSON log 且不含對話內容；無 DB 或寫入失敗都不影響主流程。）
- [x] 建立 migration rollback、備份／還原與本機 Supabase 測試流程：`0001`–`0018` migration／rollback 齊備；備份／還原（Supabase PITR 與 `pg_dump`／`pg_restore`）、本機 Supabase／Postgres 測試流程與 worker crash 恢復演練（lease 過期回收＋fencing token，`tests/repositories/jobs.test.js` 覆蓋）已寫入 [`DEVELOPMENT.md`](DEVELOPMENT.md)「備份／還原與可靠性演練」。Production 套用版本仍須每次發布前實測。
- [x] 更新 Vercel / Supabase 部署文件與環境變數；正式環境 fail closed。

**預計檔案：** `db/migrations/*.sql`、`services/database.js`、`repositories/*.js`、`workers/event-worker.js`、`services/jobs.js`、`tests/integration/database.test.js`、`tests/workers/event-worker.test.js`。

**驗收：** webhook 在外部 AI 延遲或失敗時仍快速回 `2xx`；同一 event 在多 instance 併發只執行一次；worker crash 後工作可恢復；重試不重複傳送；migration 可在空 DB 往返。

## Phase 1：文字行程管理

> **M1 基線：** 單筆文字行程的追問、確認、CRUD、衝突提示與 Google 回寫已實作。批次／週期 UX、修改履歷與首次 timezone 引導是 5.x 增強，不阻擋 M1 上線。

- [x] 定義 `event-draft` JSON schema 與 recurrence 規格，拒絕模型未定義欄位。
- [x] 支援個人 IANA timezone 設定（`設定時區`），未設定時以 `SCHEDULE_DEFAULT_TIMEZONE` 解析相對日期。（尚未做「首次使用主動要求設定」的引導）
- [x] 支援新增、查詢（`我的行程`）、修改（`修改行程`）、刪除（列表一鍵）行程。
- [x] **週期行程**：自然語言（如「每週一開會」）由 structured output 解析出 `recurrence`（freq/interval/count/until），存入 `events.recurrence` 並以 RRULE 同步 Google。**週期提醒自我傳播**：每次 occurrence 的提醒觸發後自動排下一個未來 occurrence（`nextOccurrence`＋idempotencyKey 去重，放在 pause／過期／安靜時段之前故不中斷序列；worker 短暫中斷會向前追上排第一個未來的），受 `count`／`until` 收斂；提醒訊息顯示該次 occurrence 的時間。UTC 日期算術（無 DST 時區恆正確；有 DST 者本地鐘點可能漂移一小時，Google 端 RRULE 仍正確）。
- [—] ~~**批次建立**（一則訊息建多筆不同行程）。~~ **決定不實作（2026-07-17）**：需 parser 回多草稿與逐項／整批確認的新狀態機（大 UX），個人單人情境價值低——逐筆新增或「週期行程」已覆蓋大部分需求（同一活動重複＝週期；不同活動一次建＝少見）。
- [x] 支援日期開頭自然輸入與確定性星期解消；裸星期取下一個同名日，本／這週與下週依字面固定。
- [x] 支援行程完成狀態；Google 模式同步寫入完成標題與 private metadata。
- [x] 模糊日期、時間或跨日結束時以 durable 結構化草稿追問；行程重疊時警告，修改同樣先顯示草稿再確認。
- [x] 實作 durable 確認 state machine（DB row lock + transaction），重送與併發確認不得重複寫入。
- [x] 接上文字新增行程主路徑，確認／取消按鈕綁定 confirmation token，避免舊卡片操作新草稿。
- [x] 新增修改與衝突提示，以白名單草稿、row lock 與 optimistic version 禁止 LLM 直接執行資料庫操作。（回復與修改履歷尚未實作）

**預計檔案：** `app/handlers/schedule.js`、`app/commands/schedule-*`、`services/schedule-parser.js`、`repositories/events.js`、`schemas/event-draft.js`、`tests/handlers/schedule.test.js`。

**驗收：** 「下週二下午三點在台北開會，兩小時」可產生正確草稿；DST、月底、跨年、全天、週期與批次案例有測試；未確認不落 DB；CRUD 均受 owner boundary 保護。

**M1 實機狀態（2026-07-17）：已通過。** 使用者已在真實 LINE 驗過新增、模糊時間追問、修改、完成與刪除，Google Calendar 結果一致。週期／批次不列入 M1 基線。

## Phase 2：任務 / ToDo

> **M1 基線：已通過。** 程式、`0007`／`0008` migration、Production schema 與自動測試已完成；新增、日期／標籤篩選、完成、重開與刪除皆有真實 LINE 證據。

- [x] 支援新增、列出、完成、重新開啟與刪除任務（`重開任務` 由「已完成」列表 postback 觸發）。title／期限修改走刪除重建（任務設計理念）；`setTaskPriority` repo 已備，優先度目前於新增時由 AI 判斷。
- [x] 支援期限、優先度與「今天／今日、明天／明日、逾期、本週／本周、下週／下周、已完成、#標籤」篩選（`services/task-parser.js` 解析期限與優先度、正則提取 `#標籤`；`我的任務 <篩選>` 依使用者時區篩選、逾期與優先度標記）。一週固定週一開始、週日結束；新增語句只有「本週／這週」而沒有星期幾時固定為本週日 09:00，「下週」固定為下週日 09:00；未知篩選不退回全清單。
- [x] 任務與行程分開建模（`tasks` 表獨立於 `events`），用 `我的任務` 查看，不會顯示於 Google Calendar；必要時可建立關聯，不用假的零時長行程替代。
- [x] 對大量任務提供分頁與簡潔 LINE 呈現（每頁 6 筆、「下一頁」postback 帶 offset，配合 quick reply 13 項上限）。

**預計檔案：** `app/handlers/tasks.js`、`repositories/tasks.js`、`schemas/task-draft.js`、`tests/handlers/tasks.test.js`。

**驗收：** 完成／刪除具冪等性；逾期判斷使用使用者時區；不同使用者與群組不可互讀。

### Google Tasks 同步（`5.3.0` 起）

> Supabase `tasks` 維持權威資料來源；Google Tasks 是可選的單向鏡像，不會把任務假裝成 Google Calendar Event。新增與重開成功訊息會依同步開關明示目前資料邊界。

- [x] Google Tasks scope 累加（`authorizationScopes` 依 `ENABLE_GOOGLE_TASKS` 加 `tasks` scope）；既有僅授權 Calendar 者重新 `連結 Google 行事曆` 即安全累加。與 Calendar 共用同一 OAuth 帳號（`calendar_accounts`）。
- [x] Supabase↔Google Task ID 映射與 migration（`0011`：`provider_task_id`／`sync_status`／`synced_at`）；`services/google-tasks.js` 複用 `authorizedRequest`（token 不進 log）。（task list 選擇目前用 `GOOGLE_TASKS_LIST_ID`，預設 `@default`；etag 樂觀鎖尚未做）
- [x] 新增／完成／重開／刪除走 durable outbox（`google-tasks-sync` job、`idempotencyKey` 帶 `taskId:version:action`、有限重試）；4xx／未連結不重試，同步失敗只記 `sync_status='error'`、**本機任務一律保留不刪**。
- [x] 授權後回填：OAuth callback 在取得 tasks scope 後呼叫 `enqueuePendingGoogleTasks`，自動入列既有未同步任務；回填與一般變更共用相同 idempotency key。
- [x] 部署與永久錯誤恢復：同一 Google Cloud project 必須先啟用 Google Tasks API；`rc.5` 起，API／scope 等永久設定錯誤排除後再次 OAuth backfill，會安全重排相同 idempotency key 的 dead job，不重啟在途／已完成 job，也不建立任務複本。
- [x] Google Tasks 的 `due` 只保留日期，且由 `task.timezone` 取當地日期，不會因 UTC 跨日偏移；精確時間仍存本機 `task.due_at`。
- [x] 同一任務的多版本同步以 `SELECT ... FOR UPDATE` 序列化；刪除與 delete outbox 同 transaction。新增任務在 notes 附加穩定同步標記並於 POST 前查重，連「Google 已建立、Supabase 尚未存回 provider ID」的結果不明確重試也不會重複建立。
- [x] Google Tasks inbound sync（`ENABLE_GOOGLE_TASKS_INBOUND`，預設關）：以 `updatedMin` 增量輪詢（Google Tasks 無 sync token）回收 Google 端的**完成／重開、刪除、標題、備註**到 Supabase。`services/google-tasks-inbound.js`＋`applyInboundTaskUpdate`＋`0014`／`0016` migration；成功水位只在完整拉取後提交，claim lease 防併發並讓 worker crash 後從原水位重抓。衝突政策對稱 Calendar inbound：本地 `sync_status='synced'` 才吃外部改、`pending` 讓 outbound 先贏、相同資料視為 echo、套用設 `synced` 防迴圈；不建立 Google-origin 新任務。重用 `/cron/reminders`。**`due` 不回收**，精確期限以本地為權威。

**驗收：** 真實 LINE + Supabase + Google Tasks 完成新增、列表、完成、重開、刪除、失敗重試與既有資料回填閉環；跨日與使用者時區不偏移，重送不重複建立。

## Phase 3：提醒與主動推播

> **M1 基線：** 每筆行程一個到點提醒、安靜時段、暫停／恢復、過期與 retry key 政策已實作。多重提醒與自訂 offset 是 5.x 增強，不阻擋 M1 上線。

- [x] 支援每筆行程一個到點提醒（有時間：開始時間；整天：當日 09:00），並可加**多重（lead）提醒**：`REMINDER_OFFSETS` 在到點外各排一個提醒（去重、上限 5 個、每個最多一年）。到點／lead／週期 occurrence 統一以 `jobs.idempotency_key` 追蹤與取消；`0017` 移除會漂移的 `event_reminders` 第二份索引。修改、Google inbound 改時刻與完成都會取消舊 job 並依新狀態重排。
- [x] Supabase Cron 每分鐘觸發既有 durable queue；scheduler 以 `FOR UPDATE SKIP LOCKED`、lease 與 fencing token 原子 claim，多 worker 不重複領取。
- [x] 使用 LINE Push API，不依賴已過期 reply token；此路徑會計入 LINE 月額度。
- [x] 支援安靜時段（延後到時段結束再送）、暫停（暫停期間到點提醒跳過、不補發）、過期策略（晚於 `REMINDER_STALE_MINUTES` 跳過陳舊提醒）；取消＝完成或刪除行程時自動關閉其提醒 job（含 lead 提醒，靠 `sendLineReminder` 的非 confirmed／不存在守衛 no-op）。
- [x] 對 LINE 429 / 5xx 重試；永久 4xx 進 dead letter，409 視為同 retry key 已受理。
- [x] 每次 delivery 使用 job UUID 作 `X-Line-Retry-Key`；at-least-once queue 下不重複推播。

**預計檔案：** `workers/scheduler.js`、`services/reminders.js`、`repositories/reminders.js`、`tests/workers/scheduler.test.js`。

**驗收：** 併發 scheduler、worker crash、重試、時鐘偏移、DST 與取消競態測試通過；同一提醒不重複送。

**M1 實機狀態（2026-07-17）：已通過。** Supabase `gpt-ai-assistant-reminders` Cron 已查驗為 active 且每分鐘執行，`0009` 已套用。真實 LINE 驗證正常提醒只送一次；暫停後到點的提醒不送、恢復後也不補發；恢復後新建提醒正常送達一次。`安靜時段 22-8` 設定／關閉也已通過，安靜時段 reschedule 另有自動測試覆蓋。

## Phase 4：語音建立行程（圖片建行程決定不做）

> **範疇（2026-07-17）：** 語音建行程實作；**圖片（海報／票券／截圖）建行程決定不實作**——vision 擷取的信心／欄位缺漏／多活動批次確認複雜度高、可靠性受圖片品質影響大，個人使用手打或語音已足夠。圖片能力維持既有「看圖聊天」，不接行程擷取。

- [x] 語音沿用現有 transcription，送入與文字**完全相同**的 event-draft 流程：LINE 音訊訊息經 `transcribeAudio`（Whisper／`gpt-4o-mini-transcribe`）轉文字後即成 `trimmedText`，`app/app.js` 已收 `isAudio`、schedule handler 無 `isText` 閘門，指令（`記行程 …`）與隱式日期語句皆可觸發，走同一 parse→durable 追問→確認→CRUD→Google 同步→提醒。語音確認卡額外回顯「🎤 我聽到：…」原文，讓使用者分辨聽錯與解析錯（`__TEXT_SCHEDULE_HEARD`）。
- [x] 音訊生命週期：音訊 buffer 只在 `transcribeAudio` 記憶體內存在、轉錄後即釋放，不落地 DB／磁碟／log；轉錄文字比照一般對話受 `APP_MAX_PROMPT_AGE` 管控。
- [—] ~~圖片沿用 vision，擷取海報／票券／截圖的名稱／日期／時間／地點／時區。~~ **決定不實作（2026-07-17）**。
- [—] ~~OCR／vision 結果標記信心與來源欄位，不確定欄位追問。~~ **決定不實作**。
- [—] ~~多活動圖片產生批次草稿，逐項或整批確認後寫入。~~ **決定不實作**。

**檔案：** 語音複用既有 `app/context.js`（`transcribeAudio`）、`app/handlers/schedule.js`（回顯）、`utils/generate-transcription.js`；不新增 media extractor。

**已驗收：** 語音與文字共用同一 validation／confirmation；schedule handler 測試涵蓋語音走 draft／confirm 並回顯轉錄、文字不加回顯；不因模型幻覺自行補日期（沿用 Phase 1 確定性日期解析）。

## Phase 5：日曆同步

### 5A Google Calendar

**部署現況（2026-07-17）：** 本維護者 Production 已啟用 Calendar API，External OAuth app 已發布為 In Production，並完成 Web client、Vercel Sensitive env、`0004` migration 與功能旗標。真實 LINE 已驗過授權、新增、修改、完成、刪除、解除連結與重新授權，Google Calendar 結果一致。這是少於 100 位使用者的未驗證個人用途，首次授權仍有 Google 警告；公開擴大使用前需完成敏感 scope 驗證。

- [x] 建立 `calendar.events.owned` 最小權限 OAuth flow、一次性 state、S256 PKCE 與 callback。
- [x] 提供帳號解除連結與 Google token revocation 指令（`解除連結 Google 行事曆`：向 Google 撤銷 token 並刪除本地 envelope；撤銷失敗不阻擋本地刪除，確保使用者一定能移除本地憑證）。
- [x] 以 envelope encryption 保存 refresh/access token 與 PKCE verifier；state 只存 SHA-256，token、authorization code 不進 log。
- [x] 內部 event 以 deterministic Google event id + durable job 完成冪等新增；授權後回補既有未同步未來行程。
- [x] 每分鐘 Cron 領取 Calendar sync retry；只在成功或最終失敗通知，失敗 event 可稍後列出、重試或明確刪除。
- [x] `我的行程` 與刪除在 Google 模式直接操作 Google Calendar。
- [x] bot 內修改已以 provider event id PATCH 回寫 Google Calendar，並沿用 durable retry。
- [x] Google 外部刪除回收已完成既定範圍：sync token 輪詢 Google 端刪除／取消的 bot 行程，並刪除本地事件列（`0012`，預設旗標 off）。
- [x] 外部修改 round-trip 的 **5.x 支援範圍**已完成：非週期、有時刻行程在 Google 改開始時間／標題／地點／備註後，會更新本地並重排到點與 lead 提醒（`0013`）。
  - **all-day 外部修改不納入 5.x**：Google exclusive end date、本地時區與 DST 邊界需要 provider adapter 的明確契約；留到 6.x 架構收斂後另案評估。
  - **週期 master／instance／exception 外部修改不納入 5.x**：需完整 RRULE 反解與例外模型；LINE 建立的週期行程仍可 outbound 並在本地逐次提醒。
  - 附件／受邀者不符合個人單人定位，不實作。
- [x] sync token 增量輪詢會建立基線、處理 cancelled 與 5.x 範圍內的 confirmed 修改、在 410 GONE 清 token 重建，並以 `CALENDAR_INBOUND_INTERVAL` 節流；不採 watch channel，也不建立 Google-origin 新行程。
- [x] 衝突政策：本地 `synced` 才吃外部修改，`pending` 讓 outbound 先贏；provider 水位擋自身 echo；套用設 `synced` 防迴圈。Google 端由使用者刪除採 hard-delete，不增加人工確認。
- [x] calendar delivery 與 LINE reminder 分開去重：`ENABLE_REMINDERS` 開啟時，`toGoogleEvent` 對寫入 Google 的行程設 `reminders.useDefault=false`（清空 overrides），讓 Google 不再送自身預設通知，LINE 提醒成為單一通知源；未開 LINE 提醒則保留 Google 預設通知，不動使用者原本的行事曆提醒。

### 5B CalDAV / Apple / ICS（決定不實作，2026-07-17）

> **決定不實作（2026-07-17）：** 本專案為個人自架、單一 Google 帳號情境，Google Calendar 雙向同步（Phase 5A）已覆蓋主要行事曆需求。CalDAV／Apple／ICS 互通的維護成本（各家協定差異、帳號驗證、匯入匯出邊界）高於邊際效益，受眾也窄。下列項目保留為背景記錄，**不排入開發**。

- [—] ~~Google 穩定後再實作 CalDAV account adapter。~~
- [—] ~~Apple Calendar 優先透過 CalDAV 或 ICS 訂閱／匯入。~~
- [—] ~~提供單次 ICS 匯出作為最低成本互通方案。~~

**目前檔案：** `services/google-calendar.js`、`repositories/calendar-accounts.js`、`db/migrations/0004_google_calendar.sql`、`api/index.js`。後續 CalDAV 與 inbound sync 再拆 provider adapter。

**目前已驗收：** OAuth CSRF、token encryption、最小 scope、state 重放、帳號隔離、全天行程與 `409` 冪等均有測試；Production 基礎設定與 callback 路由已驗證。

**5A inbound 現況（2026-07-17）：** 外部刪除回收、timed（非週期）外部修改 round-trip、衝突政策與 calendar/LINE delivery 去重已實作，程式與 mock 測試齊備、真實端到端待驗。all-day 與 recurrence exception inbound 不納入 5.x；刪除採 hard-delete；附件／受邀者與 watch channel 不實作，維持 sync token 輪詢。

## Phase 6：天氣查詢與每日推播

> **查詢基線：** 現況、1–7 日預報、短期 cache 與 Open-Meteo attribution 已完成並通過真實 LINE 驗收。同名地點追問、自然語句意圖路由與每日訂閱需新的確認／subscription 資料模型，留在後續切片，不阻擋目前基線。

- [x] 選定 weather provider（**Open-Meteo**：免費、無需 API key、CC-BY 授權、台灣預報品質佳、內建 geocoding），走 `services/weather/` adapter（facade + open-meteo adapter），未來可換 provider。
- [x] 支援目前天氣與最多七日預報（`WEATHER_FORECAST_DAYS`，預設 5、上限 7），回覆資料地點（地名＋縣市＋國家）與「現在」標註。
- [x] 無歧義的台灣常用縣市簡稱（例如「台北」）會由 adapter 確定性補足行政區與國家再查詢。
- [x] 自然語句意圖路由：weather handler 在 schedule 之前辨識隱式天氣意圖（天氣詞在句首「今天天氣 嘉義」或句尾「台北天氣如何」），統一抽出地點；只抓句首／句尾的天氣查詢，不誤搶含「天氣」的一般聊天長句；意圖攔截 gated on `ENABLE_WEATHER`。
- [x] 同名行政區追問：`嘉義`／`新竹` 以確定性行政中心 fallback 提供市／縣座標選項，不受 Open-Meteo 漏掉縣級資料影響；`嘉義縣` 可直接查縣府中心，太保／民雄等鄉鎮可直接輸入。維持單層選擇，不建立全台鄉鎮階層瀏覽器。
- [x] Provider 找不到時不猜座標、不讓 LLM 補地名；提示改用「鄉鎮＋縣市／國家」或附近城市。多候選則優先顯示座標綁定選項。
- [x] 每日推播訂閱：`每日天氣 台北 8` 訂閱、`取消每日天氣` 全取消、`我的天氣訂閱` 列出。`subscriptions` 表（migration `0010`）存地點座標、時區、當地推送時刻與 `next_run_at`；`ENABLE_WEATHER_PUSH` 開關。（旅遊期間／多時段尚未做）
- [x] 重用 Phase 3 scheduler / delivery：cron `/cron/reminders` 每分鐘 `enqueueDueWeatherReminders`（原子 claim 到期訂閱＋入列 `weather-daily` job），worker 走同一 queue／drain，Push 沿用 `X-Line-Retry-Key` 冪等；不另建第二套 cron。
- [x] 對同地點／預報天數做短期 cache（`WEATHER_CACHE_TTL`，預設 600 秒），避免多人重複請求 provider。

**預計檔案：** `services/weather/index.js`、`app/handlers/weather.js`、`repositories/subscriptions.js`、`tests/handlers/weather.test.js`。

**完整驗收：** 查詢回覆會顯示 provider 實際命中地點與資料來源；供應商失敗不送過期資料冒充即時資訊。地點歧義追問、每日推播停用與不重複屬後續切片驗收。

**真實 LINE 驗收（2026-07-17）：** `天氣 台北` 已正確回覆「臺北市、臺灣」、現況、五日預報與 Open-Meteo attribution，查詢基線通過。`今天天氣 嘉義` 被誤判為行程，以及 `嘉義` 靜默選市、`嘉義縣` 查無地點，均列為上述後續改善，不回退基線狀態。

## Phase 7：增強搜尋（主題追蹤決定不做）

- [x] 搜尋結果保留標題、URL、來源站與時間：`fetchAnswer` 回傳 `sources`（前 3 筆），search handler 在 AI 答案下附「📎 來源」清單（標題（來源站・時間）＋連結）。
- [~] 來源與模型推論分開：來源只顯示（標題／連結／時間）、**不進 prompt**（避免注入放大），與 AI 整理段分開呈現——**已完成**。多來源交叉比對／標註分歧**決定不實作（2026-07-17）**：需抓每筆來源原文比對關鍵事實並標註分歧，價值中等、CP 值偏低，且抓原文提高注入與成本風險；單一答案＋來源連結已覆蓋主要需求。
- [x] 從搜尋到的節目／活動建立行程：搜尋答案含日期／時間跡象且開了 `ENABLE_SCHEDULE` 時，AI 答案下方多一顆「📅 建立行程」quick-reply；點下去以 postback 把答案餵進 **Phase 1 行程流程**（`記行程 <答案>`）→ 確定性日期解析→草稿→**使用者確認才建立**，不自動寫入、不繞過確認。答案截到 LINE postback 上限（300 字，事件日期通常在開頭）。注入受限：來源本就不進 prompt、parser 用 strict schema＋temperature 0、寫入前必經確認。實作見 `app/handlers/search.js`（`scheduleActionFor`）。
- [—] ~~主題追蹤使用 subscription + scheduler；提供頻率、來源、停止與去重控制。~~ **決定不實作（2026-07-17）**：主動定時推播主題摘要需改 `subscriptions` schema、維護「已推播項目」去重狀態與額外搜尋成本，與本助理「即問即答」的被動定位重疊度低。搜尋維持使用者主動查詢，不做主動追蹤推播。
- [x] 對網頁內容延續 SSRF、大小、timeout 與 prompt-injection 邊界：`search` 走 SerpAPI 固定端點（無 SSRF）；網頁抓取的 `ENABLE_URL_SUMMARY` 既有 SSRF／大小／timeout 防護；來源連結不進 prompt。

**預計檔案：** `services/search/index.js`、`services/search/sources.js`、`tests/services/search.test.js`（`app/handlers/topic-subscription.js` 隨主題追蹤一併不做）。

**驗收：** 每個可驗證的重要結論可追到 URL；來源失效、重複結果、惡意頁面與成本上限有測試。

## Phase 8：分享與群組協作（決定不實作，2026-07-17）

> **決定不實作（2026-07-17）：** 本專案定位為**個人**助理（單人自架自用）。分享連結與群組協作超出此範疇，且 signed link 撤銷／過期、群組權限（owner/editor/viewer）、防索引與 audit 的安全面維護成本高。決定不做，維持單人使用邊界。下列項目保留為背景記錄。

- [—] ~~建立可撤銷、可過期、不可猜測的 signed share link。~~
- [—] ~~分享頁依瀏覽者時區顯示，提供 ICS。~~
- [—] ~~支援受邀者加入行程，owner 可查看／撤銷。~~
- [—] ~~群組事件綁定 group source，沿用 mention gating。~~
- [—] ~~防止連結被搜尋引擎索引，限制速率並記錄 audit event。~~

## Phase 9：多頻道 adapter（決定不實作，2026-07-17）

> **決定不實作（2026-07-17）：** LINE 為唯一主頻道並已完整最佳化其 UX。多頻道 adapter 的抽象成本高、identity linking 的驗證／撤銷面複雜，且個人使用不需要跨頻道觸達。決定不做，專注 LINE。下列項目保留為背景記錄。

- [—] ~~抽象 normalized inbound event 與 outbound delivery。~~
- [—] ~~評估 Telegram、WhatsApp Cloud API 等頻道。~~
- [—] ~~對頻道能力差異做 feature matrix。~~
- [—] ~~iMessage 僅在有可合法維護的官方整合方式時研究。~~

## 架構收斂與 `6.0.0` 候選

語意化版本的 major 代表使用者或部署者必須處理的不相容變更，不代表 Phase 編號。只要新增功能仍與既有指令、環境變數與資料相容，就留在 `5.x`；不為了「路線圖走完」硬切 `6.0.0`。

`5.13.0` 先完成不破壞相容性的收斂；`6.0.0-rc.6` 已落地 breaking runtime 契約、feature-aware LINE 快捷入口、Node 24 容器可靠性、Express／Jest／ESLint 維護基線、Google Tasks 永久設定錯誤的安全恢復，以及週期行程當地鐘點校正與可見確認規則；既有 Production 升級、Cron 與回滾往返已通過，現進入集中驗收：

- [x] 提醒排程只有一個實作入口；到點、lead、週期與 inbound 修改共用相同 idempotency key 規則。
- [x] 移除可由 durable jobs 推導的 `event_reminders` 第二份狀態（`0017`）。
- [x] 正式助理模式強制 `DATABASE_URL`、durable queue 與 migration preflight；移除 serverless process-memory 冪等與同步 fail-open fallback。
- [x] 移除正式模式的 Vercel env storage 與其他 legacy state authority；Postgres 成為使用者、事件、任務、確認、job、run 與 bot source 的唯一 durable source of truth。對話 prompt/history 因隱私政策刻意保持 ephemeral。
- [x] 移除 `APP_WEBHOOK_QUEUE` 與 Vercel env storage 所需舊環境變數；`docs/DEVELOPMENT.md` 提供升級檢查、備份、migration 與明確 rollback 文件。
- [x] 將 Google Calendar／Tasks 的 outbound、inbound、權限與衝突政策收斂為共用可測 provider contract；全天 inbound、recurrence exception、Google-origin 建立與 Tasks due 回收仍維持明確不支援。
- [x] 在既有 5.x Production 完成 migration、health、Cron 與 5.x ↔ RC 回滾往返；新安裝流程由 migration runner、preflight 與部署手冊固定。
- [x] 全域 Quick Reply 收斂為最多 13 個常用且依 feature flags 顯示的入口；`指令` 依已啟用功能輸出分組完整清單與範例；文件提供選用 3×2 圖文選單，但不把 rich menu 管理變成 runtime 前置條件。
- [ ] 在真實 LINE + Supabase + Google 完成 5.x 累積驗收後，才發布 `6.0.0`。

非中文在 6.0 不列為 release gate：`zh_TW` 是正式支援基準，`en`／`ja` 仍是實驗性介面。RC.3 已移除 locale TODO 並讓 Google OAuth HTML 跟隨語系；若未來要升為正式語系，仍須補齊天氣格式、該語系日期／意圖 parser fixture，並完成 LINE + OpenAI + Google + 天氣 E2E。

因此 `6.0.0` 的程式入口、Production migration、Cron 與回滾演練已成立；目前只剩集中真實 LINE + Google 驗收。候選版不冒充正式 E2E 已通過。

## 跨階段品質門檻

每個 Phase 必須逐項滿足，不能以「之後補」略過：

- [ ] `npx eslint .` 與 `npm test` 通過；新行為有 unit / integration / race-condition 測試。
- [ ] DB migration 可從空資料庫套用，破壞性 migration 有 rollback / backup 計畫。
- [ ] 外部 API 使用 mock/fixture 測試，並有最小 live smoke test 手冊。
- [ ] 所有 webhook、job、OAuth callback、share link 具驗證、限流、冪等與安全錯誤訊息。
- [ ] 新能力預設有 feature flag、每使用者配額與成本觀測；失敗不自動無限重試。
- [ ] 不在 log、run trace 或錯誤回覆留下 token、完整對話、附件或不必要個資。
- [ ] 更新 README、`.env.example`、`docs/DEVELOPMENT.md`、`docs/DECISIONS.md` 與 CHANGELOG。
- [ ] Vercel preview / staging 實測後才開正式 feature flag；可獨立關閉與回滾。

## 建議里程碑

### 版本政策

- `4.x`：在不破壞現有部署、指令與資料相容性的前提下，完成 M1 基線代碼、migration 與實機驗收準備。`4.20.1` 對應 Phase 2 篩選修正、Production migrations／旗標、天氣 attribution 與文件對齊。
- `4.20.2`：依真實 LINE 驗收修正模糊時段擅自補時間，並將今天／明天／後天改為依使用者時區的確定性日期解消。
- `4.20.3`：行程／任務清單的操作回覆帶當次列表序號、不暴露內部 ID；任務相對日期依使用者時區確定性校正，避免 UTC 跨日錯一天。
- `4.20.4`：`我的任務 明天／明日` 改為真正的明日範圍；今天／今日與寬泛週期限也由程式依使用者時區確定日期；修正句尾標點污染 `#標籤`，並相容既有帶句號標籤。
- `4.20.5`：修正 `行程 <內容>` 未進入結構化行程流程、誤落一般對話的指令路由；例如 `行程 5分鐘後的測試通知` 會先顯示草稿並要求確認。
- `5.0.0`：M1 基線已通過真實 LINE + Supabase + Google 閉環並發布：行程新增／追問／修改並回寫 Google，任務新增／篩選／完成／重開／刪除，提醒準時且只送一次並能暫停／恢復。Google Tasks 同步、批次／週期行程、多重提醒、Google inbound sync 與天氣訂閱是後續 5.x 增強，不阻擋 M1。
- `5.8.1`：修正 Google Tasks 當地日期跨 UTC 日界、OAuth 回填未接線與同步競態；Calendar 同步／完成／刪除也共用 row lock，並補上 inbound `singleEvents` 一致性與時區保留。每日天氣排程跨 DST 仍維持當地指定鐘點。
- `5.13.0`：完成搜尋建行程、多重與週期提醒、Tasks inbound 成功水位，以及嘉義／新竹市縣 fallback；並以統一提醒排程 service 與移除重複索引開始相容性的架構收斂。
- `6.0.0-rc.1`：durable-only runtime、`0018` bot source、migration/config preflight、legacy Vercel storage／同步 fallback 移除，以及 Google provider contract；Production 升級與回滾已通過。
- `6.0.0-rc.2`：全域 Quick Reply 改為 feature-aware 的最多 13 個常用入口，`指令` 改為實際分組完整清單與範例，並完成 fork 可採用的選用圖文選單文件；供集中 LINE／Google 驗收。
- `6.0.0-rc.3`：補齊英／日 locale 與 Google OAuth HTML、統一 Node 24 容器基線、更新同 major dependencies、修復獨立 repo 的 Issue 回報入口；正式版 gate 不變。
- `6.0.0-rc.4`：完成 Express 5、Jest 30、ESLint 10 flat config、bot-source repository 注入，以及 Docker port／liveness／CI image smoke；LINE 與 durable 資料契約不變。
- `6.0.0-rc.5`：實機驗收確認 Google Tasks API 必須在 OAuth project 另行啟用；補強部署文件，並讓重新 OAuth backfill 可安全重排相同 idempotency key 的 dead Tasks sync job。
- `6.0.0-rc.6`：實機驗收發現週期行程明確鐘點可能被模型重複套用 UTC offset；改由程式依使用者時區鎖定 wall clock，週期開頭語句可直接進行程流程，確認摘要明列重複規則。
- 後續 `5.x`：只做向後相容的功能、可靠性與文件改善；版本可持續增加，不預設一定要到哪個 minor。
- `6.0.0`：RC 已在既有 Production 完成 migration、Cron 與回滾演練；集中 LINE／Supabase／Google 驗收通過後發布。

### 6.x 相依架構遷移

- [x] Express 5：已升 `5.2.1`，既有固定 route pattern、middleware、OAuth、webhook 與本機 HTTP liveness smoke 通過。
- [x] Jest 30：Jest／`@jest/globals`／`babel-jest` 已升 30.4，原有 ESM mock／transform 與 71 suites 全數通過。
- [x] ESLint flat config：已直接升目前穩定 ESLint 10，改用官方 recommended＋本專案明確規則，移除只支援 ESLint 7／8 的 `eslint-config-airbnb@19`，未使用 peer override。
- [ ] Babel 8：目前 `babel-jest 30` 官方仍支援 Babel 7；Babel 8 是 ESM-only 且提高 Node patch 契約，待能移除 Babel transform 或獨立驗證 ESM config 時再升，不與 runtime framework 綁成同一變更。
- [ ] `dotenv` 17、`html-to-text` 10 等其餘 major 依實際 migration notes 與回歸測試分批處理。

### M1 真實環境驗收矩陣（2026-07-17）

| 環節 | 狀態 | 證據／待驗項 |
| --- | --- | --- |
| Phase 1 行程 | 已通過 M1 | 真實 LINE 已驗過新增、模糊時間追問、修改回寫、完成與刪除，Google Calendar 結果一致 |
| Phase 2 任務 | 已通過 M1 | 新增、今天／明天／本週與標籤篩選、完成、刪除及重開已通過；重開後目標列回到待辦且不再出現在已完成列表，同名的另一筆仍保留，證明只更新被選取的資料列 |
| Phase 3 提醒 | 已通過 M1 | Cron 每分鐘執行；正常提醒只送一次，暫停期間不送且不補發，恢復後新提醒正常送達 |
| 5A Calendar outbound | 已通過基線 | OAuth、新增、修改、完成、刪除、解除連結及重新授權均已通過真實 LINE／Google 驗收 |
| Phase 6 天氣查詢 | 查詢基線通過 | `天氣 台北` 已在 Production 通過並顯示 attribution；自然語句路由已修，`5.13.0` 加入嘉義／新竹市縣確定性選擇，待真實 LINE smoke test |

1. **M0 可可靠執行：** Phase 0。先解決同步 webhook、process-memory 冪等與 Vercel env lost update。
2. **M1 個人助理 MVP：** Phase 1 + 2 + 3。文字行程、任務與不重複提醒形成第一個完整閉環。
3. **M2 無摩擦輸入：** Phase 4。把現有語音接到結構化助理（已完成）；圖片建行程決定不做。
4. **M3 外部互通：** Phase 5。Google Calendar 雙向同步（5A）；CalDAV／Apple／ICS（5B）**決定不做**（2026-07-17）。
5. **M4 主動資訊：** Phase 6 + 7。共用 scheduler 推天氣；搜尋維持即問即答，**主題追蹤決定不做**（2026-07-17）。
6. ~~**M5 協作與擴張：** Phase 8、Phase 9。~~ 分享／群組（Phase 8）與多頻道（Phase 9）**決定不做**（2026-07-17），維持個人單人、LINE 單頻道定位。

這個順序的核心理由是：行程與提醒是具狀態、具時間且會主動發訊息的功能。沒有持久化、交易、排程、冪等與可觀測性，新增越多功能，只會放大重複付費、漏送、誤送與個資風險。

## 明確不做

- **CalDAV／Apple／ICS 互通（原 Phase 5B）、分享與群組協作（原 Phase 8）、多頻道 adapter（原 Phase 9）、搜尋主題追蹤推播與多來源交叉比對／標註分歧（原 Phase 7 兩項）、圖片（海報／票券／截圖）建行程（原 Phase 4 一項）、批次建立多筆行程（原 Phase 1 一項）**——2026-07-17 決定不實作，維持「個人單人自架、LINE 單頻道、即問即答」定位。理由見各 Phase 段落。
- 不直接複製 Toki／Dola、fermi 或其他參考專案的原始碼、介面、文案、品牌或素材。
- 不以 OpenAI / ChatGPT 訂閱 OAuth 取代 `OPENAI_API_KEY`。
- 不讓 LLM 直接執行 SQL、任意工具名稱或未經 schema 驗證的寫入。
- 不以 serverless process memory 或 Vercel env 當正式行程／提醒資料庫。
- 不在 Phase 0 至 3 完成前，同時開發多頻道、dashboard 或 marketplace。
- 不承諾「所有 Toki／Dola 行為逐像素／逐文案相同」；目標是取得功能價值並符合本 repo 的安全、成本與授權邊界。

## 目前 API 與模型基線

> 模型名稱、價格與相容參數變動很快；每次實作前必須重新核對 OpenAI 官方 models、pricing 與 guides，不把本文當永久價格表。

| 功能 | API / 目前預設 | 判斷 |
| --- | --- | --- |
| 對話 | Chat Completions / `gpt-4o-mini` | 低成本預設；未來比較新模型時先跑 talk / sum / translate / analyze smoke tests |
| 影像理解 | Chat Completions image input / `gpt-4o` | 現況可用；降成本候選需先比中文辨識品質 |
| 語音轉文字 | Audio Transcriptions / `gpt-4o-mini-transcribe` | 已升級；`whisper-1` 可作明確 fallback |
| 生圖 | Images Generations / `gpt-image-2`、`low` | 已升級；base64 經 private Vercel Blob 與 signed URL 交付 LINE |
| 搜尋 | SerpAPI | 短期保留；Responses API web search 等搜尋介面抽象後再評估 |

授權與計費邊界：

- ChatGPT 訂閱與 OpenAI API 分開計費；本 bot 維持 `OPENAI_API_KEY`。
- Codex 的 ChatGPT sign-in 不是第三方 server-side LINE bot 可使用的通用 API OAuth。
- 若要改善 key 管理，優先採 OpenAI project / service-account key、權限切分、用量上限與 spend alert。
- 新模型必須驗證現有 `temperature`、`stop`、penalty 與輸出格式是否相容。
- 搜尋若改成 Responses API，必須同時完成引用、工具結果格式、成本觀測與 fallback，不能只換 endpoint。

官方來源：

- [OpenAI API models](https://developers.openai.com/api/docs/models)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [ChatGPT Plus 不包含 API usage](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)

## fermi 架構取捨

[`memochou1993/fermi`](https://github.com/memochou1993/fermi) 是原作者的 Supabase + OpenRouter 接班專案。方向可吸收，原始碼不直接合併：

| 領域 | 可吸收做法 | 本 repo 決策 |
| --- | --- | --- |
| Webhook | 快速 ACK、DB 冪等、durable queue | Phase 0 必做 |
| Worker | 背景處理、retry、dead letter | Phase 0 必做 |
| 狀態 | Postgres threads / runs / credentials | 新個人助理狀態採 Supabase Postgres |
| Delivery | reply token 時間預算與 Push fallback | 已有 Push fallback；後續納入 worker |
| Observability | run / step / cost trace | 必做，但不預設保存完整對話 |
| Provider | OpenRouter tool loop | 只保留可選方向；OpenAI direct API 仍是預設 |
| Dashboard | Nuxt + Supabase Auth | 目前不做 |
| Marketplace | MCP / BYO tools | prompt injection、credential scope、allowlist 完成前不做 |

fermi 採 FSL-1.1-MIT；本 repo 是功能相近的 MIT LINE assistant。為避免授權混雜與 Competing Use 不確定性，只重做公開概念，不搬 FSL 程式碼。

## 上游活躍度與回貢決策

截至 2026-07-17，[上游 `main`](https://github.com/memochou1993/gpt-ai-assistant/commits/main) 尚未封存，但已不呈現持續的功能開發：最後一次合併 PR 是 2024-07-09 的 [#333](https://github.com/memochou1993/gpt-ai-assistant/pull/333)，後續沒有新的 merged PR。2026-06-08 的 [`d84c806`](https://github.com/memochou1993/gpt-ai-assistant/commit/d84c806b8368ded9d790067235827cdac32a23ab) 是約 23 個月後的文件更新，只把過時 News 改為 fermi 接班指引；本專案的來源脈絡包含該版本，公開 Git 歷史於 2026-07-18 以目前快照重新初始化。

因此目前**不安排回貢上游**。上游舊架構與本專案的 Supabase、Google Calendar、行程、任務及提醒路線已明顯分岔；準備可套用上游 `4.9.1` 的獨立 PR、維護測試與後續溝通，成本高於目前效益。只有上游重新恢復程式開發，或維護者主動表示需要本專案的特定修正時再重新評估。這不影響 MIT 已授予的 fork、修改與發布權利；所有上游 attribution 仍永久保留。

## 其他參考專案

| 專案／服務 | 授權 | 可參考內容 | 不採用內容 |
| --- | --- | --- | --- |
| [LINE Node SDK](https://github.com/line/line-bot-sdk-nodejs) | Apache-2.0 | webhook 型別、簽章、Messaging API client | 升 Node runtime 前不為了形式整套替換 |
| [TheExplainthis/ChatGPT-Line-Bot](https://github.com/TheExplainthis/ChatGPT-Line-Bot) | MIT | URL / YouTube 摘要、persona UX | 明文使用者 key、舊 Flask/Replit 架構 |
| [ycs77/chatgpt-linebot](https://github.com/ycs77/chatgpt-linebot) | MIT | Redis TTL、群組 gating、圖片 proxy | 直接搬舊實作 |
| [n3d1117/chatgpt-telegram-bot](https://github.com/n3d1117/chatgpt-telegram-bot) | GPL-2.0 | usage budget、串流、多模態、群組 UX | GPL 原始碼 |
| [ctjoy/chatgpt-line-bot-serverless](https://github.com/ctjoy/chatgpt-line-bot-serverless) | 未宣告 | AWS Lambda 部署概念 | 未授權原始碼 |
| [Toki（前身 Dola）](https://toki.com/zh-hant) | 商業服務／無公開原始碼 | 自然語言行程／任務、模糊輸入、自適應提醒、完成、多日曆協調、衝突建議、多模態、天氣、主動追蹤與分享 UX；公開研究入口見本文件「研究範圍」 | 品牌、文案、素材、私有實作 |

參考專案的共同原則：吸收可驗證的行為與架構概念，依本 repo 的測試、隱私、成本與授權邊界自行實作。

## 授權策略

目前維持 MIT，不立即轉 FSL-1.1-MIT。

| 項目 | MIT | FSL-1.1-MIT |
| --- | --- | --- |
| 性質 | permissive open source | source-available / fair-source |
| 商用限制 | 幾乎沒有 | 禁止 Competing Use |
| 未來轉換 | 無 | 每版本發布兩年後轉指定 MIT future license |
| 對下游 | 採用與 fork 門檻低 | 商業與相似產品需額外評估 |

合併邊界：

- FSL 專案通常可以包含 MIT 程式碼，但必須保留原 copyright 與 license notice。
- MIT repo 不應直接混入尚未轉 MIT 的 FSL 原始碼後仍宣稱整體為乾淨 MIT。
- fermi 的特定版本滿兩年轉 MIT 後，才能依該版本的 MIT future license 評估；較新版本各自重新計時。
- 既有 MIT 版本權利不能因未來轉標而撤回，上游 `memochou1993/gpt-ai-assistant` attribution 也必須永久保留。

只有在要做 full-stack v2、多 owner / dashboard / BYOK marketplace、直接使用尚未轉 MIT 的 fermi code，或提供需要限制競品的商業服務時，才重新評估另開 FSL repo。屆時需清楚分區既有 MIT base、後續修改與第三方程式，重大商業使用前再取得法律意見。

來源：[FSL](https://fsl.software/)、[SPDX FSL-1.1-MIT](https://spdx.org/licenses/FSL-1.1-MIT.html)、[MIT License](https://opensource.org/license/mit)。
