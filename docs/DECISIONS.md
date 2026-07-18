# Decisions

本專案的重要決策紀錄（新到舊）。每筆記：日期、決定、理由。與 [`DEVELOPMENT.md`](DEVELOPMENT.md) 的「怎麼做」互補，這裡記「為什麼」。

## 2026-07-18 — 公開歷史以目前快照重新初始化

- **決定**：在 repository 已解除 fork network、且不再規劃回貢上游後，將目前完整檔案樹建立為由 SanHsien 署名、commit message 為「初始化」的單一 root commit；`main` 與目前 release tag 指向新 root，刪除其餘公開 tags／舊 prerelease refs。
- **不是改寫作者**：不把 Memo Chou 或其他上游 contributors 的 commits 改成 SanHsien 署名，而是讓舊 commit graph 不再是公開 `main` 的祖先。來源與著作權仍由 [`LICENSE`](../LICENSE)、[`NOTICE.md`](../NOTICE.md)、README 及上游連結永久揭露。
- **可還原性**：執行前以 `git bundle create --all` 保存全部 refs 並通過 `git bundle verify`；bundle 不提交至 repo。舊 commit URL、外部 clone 與舊 tag 不再是支援中的公開歷史。
- **發布與部署**：只重建目前 `v6.0.0-rc.3` prerelease；force-push 後重新驗證 CI、CodeQL、Vercel health 與 Contributors，並清理舊 GitHub Deployment metadata。CHANGELOG 保留產品版本歷程，但不保證每個舊版本仍有 tag。

## 2026-07-18 — RC 維護更新與相依 major 延後

- **現在更新**：Node／Vercel／container 基線統一到 Node 24，更新既有 major 內相依套件，補齊 locale、OAuth HTML、npm metadata 與獨立 repo Issue 入口。這些不改動 durable schema 或使用者指令契約。
- **不硬升 major**：Express 5、Jest 30、Babel 8、ESLint 10／flat config 與其他 major 必須各自閱讀 migration notes、補測並分批落地；RC 不以 peer-dependency override 製造表面最新版。
- **Deployment 紀錄**：GitHub Deployment 是外部整合 metadata，不是 Git 歷史或上游 attribution。獨立 repo 可清除指向舊 SHA 的紀錄，但保留目前 Production；Vercel 端部署保留作 rollback，另以 retention policy 管理。

## 2026-07-18 — Quick Reply 收斂，圖文選單保持選用

- **Quick Reply**：一般回覆附加依 feature flags 過濾的最多 13 個常用入口，使用 LINE 官方上限換取功能可發現性；LINE client 決定單列橫向版面，程式不模擬兩列。
- **完整入口**：`指令` 必須依部署中已啟用的功能回覆分組完整清單、可輸入指令與範例，不能再以四個維護按鈕的舊 template 代替功能說明。
- **圖文選單**：fork 可在 LINE Official Account Manager 手動建立單頁 3×2 rich menu，使用穩定文字指令接既有 webhook。它不是 6.0 runtime 必要條件，也不把 channel token、rich menu id 或圖片生命週期寫死進 repo。
- **暫不 API 管理**：只有需要分頁、per-user menu 或 alias 切換時才新增 Messaging API 自動化；在此之前 GUI 方案較容易部署、回滾與查看統計，也不增加 bot 啟動前置條件。
- **語系界線**：`zh_TW` 是唯一正式支援與實機驗收語系；`en`／`ja` 保持可啟動的實驗性 locale，`zh_CN` 暫時共用繁體字串。文件不得因存在英文 README 或 locale key 就宣稱完整非中文部署。

## 2026-07-18 — `6.0.0` 採 durable-only runtime

- **決定**：正式 runtime 強制 Supabase Postgres、durable webhook queue 與最新 migration preflight；移除 `APP_WEBHOOK_QUEUE`、process-memory redelivery filter、同步 fail-open、Vercel env storage 及其 access-token 設定。DB 或必要設定不可用時回 `5xx`，讓 LINE redelivery，不在未取得 durable idempotency 前執行付費工作。
- **狀態界線**：`bot_sources` 只保存 HMAC source key、user/group 類型及啟停狀態；原始 LINE id、顯示名稱與對話不落庫。短期 prompt/history 仍可隨 instance 消失，因其不是業務真相源。
- **Google contract**：Calendar／Tasks scopes、outbound/inbound 支援矩陣與 local-pending/stale 衝突政策成為共用可測契約。全天 Calendar inbound、recurrence exception、Google-origin 建立與 Tasks due 回收在真實 round-trip 完成前保持不支援。
- **發布方式**：先部署 `6.0.0-rc.1` 做既有 Production 升級與集中 LINE／Google 驗收；通過後才發正式 `6.0.0`。回滾部署最後 5.x，保留向後相容的 `0018` 表，避免事故中做破壞性 schema 操作。

## 2026-07-17 — 轉為獨立 repository，保留上游 MIT attribution（歷史方案已由 2026-07-18 決策取代）

- **決定**：維護者不再規劃回貢原專案；先依 GitHub 官方 **Leave fork network** 轉為獨立 repository，後續不再保留 `upstream` remote 作日常同步來源。原先規劃保留上游 commit graph，後於 2026-07-18 改為目前快照單一 root。
- **永久邊界**：解除 GitHub fork 關係或整理 commits 不會消滅上游著作權與 MIT notice；[`LICENSE`](../LICENSE)、[`NOTICE.md`](../NOTICE.md) 及 README 的來源與致謝必須保留。獨立 repo 只能表示治理與開發方向獨立，不能把上游程式宣稱為本維護者原創。
- **歷史影響**：舊 commit URL、tag／release 指向與外部 clone 會失效；執行前建立完整 bundle 備份，轉換後重建目前 release、Actions、Vercel webhook／部署與 branch settings。官方流程見 [GitHub Detaching a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/detaching-a-fork)。

## 2026-07-17 — `6.0.0` 只保留給 breaking 架構收斂

- **決定**：Phase 完成不是 major version 的觸發條件。向後相容的功能與可靠性改善持續發布為 `5.x`；只有 durable-only runtime、移除 legacy storage／fallback／env 契約等需要部署者遷移的不相容變更，才發布 `6.0.0`。
- **理由**：SemVer major 是相容性訊號。為里程碑數字提前升 major，或永遠不規劃可落地的 breaking 收斂，都會讓版本失去判讀價值。
- **執行**：`5.13.0` 先做相容收斂（統一 reminder scheduler、移除重複 reminder index、Tasks inbound 成功水位）；其餘 6.0 entry criteria 與 rollback 門檻維護在 [`ROADMAP.md`](ROADMAP.md)。

## 2026-07-17 — 文件精簡，但保留 latest-only REVIEW.md

- **決定**：每個主題維持單一真相源（SSOT）——變更看 [`CHANGELOG.md`](../CHANGELOG.md)、Phase 狀態看 [`ROADMAP.md`](ROADMAP.md)、決策看本檔；根目錄 [`REVIEW.md`](../REVIEW.md) 只保留最新一次 evidence-based 覆核、未驗證項與 release gate，不複製完整歷史。
- **理由**：完全刪除 `REVIEW.md` 與 repo 的 agent 工作規則及維護習慣衝突；latest-only 可保留交接價值，同時避免逐版累積與其他文件漂移。
- **最新覆核結論**：以根目錄 [`REVIEW.md`](../REVIEW.md) 為唯一最新狀態；本段只保留 latest-only 文件策略，不複製會過期的版本與測試數字。
- **CLAUDE.md 瘦身**：規則 SSOT 在 [`AGENTS.md`](../AGENTS.md)，`CLAUDE.md` 收斂為指標＋Claude 專屬回覆要求；`SKILL.md` 規則亦指向 AGENTS。

## 2026-07-17 — 收斂路線圖範疇：四個方向決定不實作

- **決定不做**：CalDAV／Apple／ICS 互通（原 Phase 5B）、行程分享與群組協作（原 Phase 8）、多頻道 adapter（原 Phase 9）、搜尋主題追蹤主動推播與多來源交叉比對／標註分歧（原 Phase 7 兩項）、圖片建行程（原 Phase 4 一項；**語音建行程仍實作**）、批次建立多筆行程（原 Phase 1 一項，2026-07-17 補；**週期行程仍實作**）。
- **理由**：本專案定位為**個人單人自架、LINE 單頻道、即問即答**。上述方向都跨出此定位——5B 是跨行事曆協定互通（Google 雙向同步已覆蓋需求）、Phase 8 是多人分享／群組權限、Phase 9 是跨平台觸達、主題追蹤是主動定時推播、多來源交叉需抓來源原文比對事實。它們的維護與安全成本（協定差異、signed link 撤銷／過期、identity linking、去重狀態、抓原文的注入與成本風險）高於個人使用的邊際效益。
- **仍保留**：Phase 5A Google Calendar 雙向同步（已做刪除回收 + timed 修改 round-trip）、Phase 6 天氣、Phase 7 搜尋來源呈現（來源只顯示、不進 prompt）。ROADMAP 相關段落已標「決定不實作」並保留原項目為背景記錄；README「已排除方向」同步。

## 2026-07-17 — 發布 v5.0.0：M1 真實閉環完成

- **門檻已達成**：Phase 1 行程新增／追問／修改／完成／刪除與 Google Calendar 結果一致；Phase 2 任務新增／篩選／完成／重開／刪除已在真實 LINE 通過；Phase 3 提醒只送一次、暫停不送且不補發、恢復後未來提醒正常送達。
- **重開只影響選取列**：實機重開後，目標任務由已完成回到待辦；另一筆同名任務仍保留原狀，證明它是先前測試建立的獨立資料列，不是一次重開兩筆。
- **任務邊界明示**：`5.0.0` 的任務仍以 Supabase 為權威資料來源；新增與重開成功訊息會說明它只存在助理待辦、尚未同步 Google Tasks，也不建立 Google Calendar 行程。
- **後續 5.x**：Google Tasks 同步另作獨立版本；批次／週期行程、多重提醒、Google inbound sync、天氣訂閱與多模態等增強不屬於 M1 gate。

## 2026-07-17 — 目前不回貢低活躍上游

- **現況**：上游未封存，但最後一次 merged PR 停在 2024-07-09；2026-06-08 的 [`d84c806`](https://github.com/memochou1993/gpt-ai-assistant/commit/d84c806b8368ded9d790067235827cdac32a23ab) 只是把過時 News 改成 fermi 接班指引。該版本已納入本專案來源脈絡，先前文件只提 fermi，未留下 commit 與活躍度證據。
- **決定**：目前不安排 issue、PR 或整批回推。本 fork 已走向 Supabase、Google Calendar、行程、任務與提醒，為上游 `4.9.1` 另行拆修正、補相容測試與持續溝通的成本高於效益。
- **重評條件**：只有上游恢復程式開發，或維護者主動表示需要本 fork 的特定修正時再評估；本 fork 的開發不等待上游回應。

## 2026-07-17 — v4.20.5 修正「行程」簡短前綴

- **實機失敗**：`行程 5分鐘後的測試通知` 未命中只有「記行程／新增行程／安排行程」的中文別名，落入一般對話並錯稱無法設定通知。
- **決定**：將「行程」加入既有 schedule command aliases，沿用相同的結構化解析、確認、Google Calendar 同步與到點 reminder，不另建提醒捷徑或平行資料模型。「N 分鐘／小時／天後」由程式依當下時間確定性解消，模型不能自行做時間加法。
- **驗證**：新增 handler 回歸測試，確認只移除「行程」前綴並把 `5分鐘後的測試通知` 交給 schedule parser；parser 測試覆蓋分鐘／小時／天 offset、prompt hint，以及模型給錯 start 時的程式校正與 duration 保留。

## 2026-07-17 — 相對日期與模糊時段不再信任模型預設

- **實機失敗**：台北時間 7/17 00:29 輸入「記行程 明天下午看診」，模型把 UTC 日界後的「明天」錯解為 7/17，並擅自把「下午」補成 15:00。Prompt 已明文禁止仍無法保證。
- **決定**：今天／明天／後天與星期都先依使用者 IANA timezone 轉成確切日期；模型回傳其他日期時由程式校正，並保留當地鐘點、跨日偏移與行程長度。
- **模糊時段**：凌晨、早上、上午、中午、下午、傍晚、晚上等若沒有鐘點，即使模型給了完整 start／end，程式仍清除擅自補的時間並進入 durable `time` 追問；「下午茶」不視為時段。

## 2026-07-16 — `5.0.0` 以 M1 真實閉環為版本門檻

- **不因代碼完成就提前切 major**：Phase 1–3 的 M1 基線已實作，但 `5.0.0` 只在真實 LINE + Supabase + Google 關鍵閉環通過後發布。當時（2026-07-16）只有行程新增同步已驗，追問／修改、任務 CRUD／篩選、真實提醒與提醒偏好仍待實機驗收；這些項目後續已於 2026-07-17 通過並發布 `5.0.0`，結果見本文件最上方決策。
- **M1 基線與 5.x 增強分開**：M1 包含單筆文字行程、任務、單一到點提醒與暫停／恢復。批次／週期行程、修改履歷、多重提醒／自訂 offset、Google inbound sync、天氣每日訂閱需新資料模型與衝突／送達政策，改列 5.x 後續，不假裝已完成也不阻擋 M1。
- **Phase 0 觀測不硬接**：`runs` repository 與 `traceRun()` 已存在，但未有 best-effort 故障隔離、錯誤遮罩與 token／成本回傳；直接包正式 handler 會讓觀測 DB 影響 bot 可用性或落地敏感錯誤。因此保留未完成，連同備份／還原與 worker crash 演練另作可驗證切片。
- **`4.20.1` 的目標**：修正任務「今天／本週」篩選下界與 `TASK_LIST_LIMIT`，補 Open-Meteo attribution，套用 Production `0007`–`0009`，啟用任務／天氣旗標，並對齊 repo、文件站與 GitHub Release。
- **任務週界與寬泛期限**：任務的一週固定週一開始、週日結束；只有「本週／這週／下週」而沒有星期幾時，以對應週日 09:00 作期限。今天／今日、明天／明日、本週／下週清單都由程式依使用者時區建立半開範圍；未知篩選 fail closed，不以全部任務冒充成功。

## 2026-07-15 — Phase 1 durable 追問、修改與衝突邊界

- **追問必須跨 instance 恢復，但不落地原始對話**：`confirmations` 只保存白名單 partial draft、`missing_fields`、operation 與 TTL。已確定但尚無法組成 timestamp 的日期／時間以 `known*` 結構化提示保留，下一句合併後仍經本地 validator。
- **日期完整即可為整天**：只有日期沒有時間的陳述不追問；模糊時段、只有時間沒有日期、或無法確定跨日結束才追問。
- **修改是 confirmation workflow，不是 LLM 直寫**：使用者先選 bot 管理的 event，自然語只產生修訂草稿。確認時以 event row lock 與 `expected_version` 防止 stale overwrite，並重排提醒、重開 Google durable sync。
- **衝突預警但不擅自決定**：Supabase 中同 owner 的 confirmed event 時段重疊時在確認卡提示，最終仍由使用者確認。Google-only 外部 event 與外部變更回收仍屬 Phase 5 inbound sync。
- **事件順序是正確性邊界**：durable pending lookup 會交回 event loop，因此同一 webhook batch 的同一使用者必須依 LINE 順序串行；不同使用者仍可並行。

## 2026-07-15 — Google Calendar 成為行程操作面，Supabase 保留可靠性狀態

- **問題釐清**：LINE 回覆「已建立行程」原本只代表資料寫入 Supabase `events`，因為 repo 當時沒有 Google OAuth 或 Calendar API，所以不可能出現在 Google 行事曆。
- **決定**：啟用 `ENABLE_GOOGLE_CALENDAR` 後，新增以 durable sync job 寫入 Google Calendar，`我的行程` 與刪除直接呼叫 Google Calendar；Supabase 不再冒充使用者看得到的日曆，而是保留 confirmation、owner boundary、加密憑證、provider event mapping、retry 與 backfill。
- **授權邊界**：Calendar 只申請 `calendar.events.owned`；啟用 Google Tasks 時才追加 `tasks` scope。兩者共用 web-server OAuth、一次性 state 與 S256 PKCE。state 只存 SHA-256；PKCE verifier 與 Google token 用既有 AES-256-GCM envelope 加密，不保存 Google email，也不把 code/token 寫入 log。
- **冪等與部署**：本地 UUID 轉成 Google 可接受的 deterministic event id；重試遇 `409` 視為前次已成功。功能預設關閉，必須先套 `0004`、建立 Google OAuth client 並補齊 Vercel env 才開旗標。
- **Production 落地**：同日已完成 Calendar API、External OAuth app、Web client、Vercel Sensitive env、`0004` migration 與 `ENABLE_GOOGLE_CALENDAR=true`。OAuth app 隨後發布為 In Production，避免 Testing 模式的 Calendar refresh token 7 天到期；個人用途暫不送驗證，接受首次授權警告與 100 位新使用者上限。公開 repo 只記錄環境變數名稱與泛用步驟，不保存 Client ID、secret、Supabase ref 或個人帳號。
- **指令輸入要容錯但不可進 LLM**：首次實測的「連結Google行事曆」因缺少文件範例中的空格而誤落一般對話。指令表現已補無空格及「連接／綁定／授權」變體並加回歸測試；OAuth 指令不得成為付費聊天 prompt。
- **日期開頭文字可直接建草稿**：只靠 `記行程` 前綴不符合個人助理的自然輸入預期。明確日期開頭、帶事項且不是問句的訊息直接進既有 parse／validation／confirmation 流程；日期問句與算式仍交給一般聊天，避免誤建行程。
- **星期由程式先解消，不交給模型猜**：裸 `星期／週／周 + 星期幾` 代表下一個尚未跨過的同名日；`本／這週` 固定本週，`下週` 固定下一週。程式把確定日期寫入 parser system message，模型不得改選其他週。
- **提醒沿用 durable jobs，排程由 Supabase Cron 觸發**：Vercel Hobby cron 只有每日精度，不適合到點提醒；現有 jobs 已有 lease、fencing、retry、dead-letter 與加密 payload，因此不另建平行 queue。使用者 LINE id 只以 AES-256-GCM envelope 保存，推播以 job UUID 作 LINE retry key；完成行程會同時關閉仍 pending 的 reminder job。LINE Push 計入月額度，故功能維持 opt-in。
- **Google 同步只發最終結果**：「Supabase event 已建立」不等於「Google 已同步」，因此移除過渡訊息。`google-calendar-sync` 預設最多 3 次，每分鐘 Cron 會在沒有 webhook 時繼續領取；前兩次失敗保持靜默，成功或最終失敗才建 `google-calendar-status` Push job。
- **不重試不等於刪除**：最終失敗保留 `events.sync_status='error'`。「暫不處理」只停止詢問，不改也不刪資料；使用者可用「同步失敗行程」重新列出，並明確選擇新的 3 次重試週期或 owner-scoped 刪除。系統不會因忽略、逾時或「暫不處理」自動刪行程。
- **尚非雙向同步**：OAuth、新增、bot 內修改 PATCH 回寫、直接查詢／刪除與既有未來行程回補已完成；解除連結／撤銷、Google 外部變更回收、sync token/watch channel 與完整衝突政策仍留在 Phase 5。

## 2026-07-14 — Schedule 接線覆核與 confirmation token 綁定

- **按鈕必須綁草稿 token**：初版按鈕只送「確認行程／取消行程」，handler 再查最新 pending。連續建立兩個草稿後按舊卡片會操作新草稿，故按鈕文字改帶隨機 token；手動輸入不帶 token 時才相容性地使用最新 pending。
- **結構化輸出雙層防線**：Chat Completions 使用 strict JSON Schema，並保留本地 `event-draft` 白名單 validator。行程解析不繼承聊天的 presence/frequency penalty 或 stop sequences；`temperature=0` 降低隨機性，但不宣稱模型輸出位元級完全相同。
- **真實模型結果**：模型會為選填欄位輸出 `null`；本地 validator 將合法選填 `null` 正規化成未提供，未知欄位、錯誤型別與非法 recurrence 仍拒絕。
- **migration 可逆**：補 `db/rollbacks/0003_job_checkpoints.sql`；Production 已套用 `0003` 並查驗兩個 checkpoint 欄位。

## 2026-07-14 — Durable checkpoint 取代 at-most-once

- **決定**：把「AI 已完成」（`jobs.result`，加密）與「LINE 已送達」（`jobs.delivered_at`）拆成兩個 durable checkpoint（migration `0003`），語意改為 **AI 至多執行一次、送達可重試多次**。`max_attempts` 從 1 恢復為 `WORKER_MAX_ATTEMPTS`（預設 3）。
- **理由**：`max_attempts=1` 擋掉了「重試重複付費」，但代價是 worker 一被砍訊息就靜默消失（已回 `200`，LINE 不會重送）。這在生圖等長工作上是真實情境，而非理論風險。
- **送達為何能安全重試**：LINE 的 reply token **只能用一次**——用同一個 token 重送不會產生重複訊息，LINE 會直接拒絕。因此送達天生冪等，仍**不需要**改用計額度的 push。
- **AI 為何不能重跑**：函式在 AI 階段被砍時不會拋錯，job 會在租約過期後被重新領取。此時 `attempts > 1` 而 `result` 為空即代表上次死在 AI 階段，直接 dead-letter。這是「不重複付費」的實際執行點——不再靠 `max_attempts=1`。
- **部署順序**：Vercel 一 push 即部署，migration 不同步。checkpoint 寫入遇 `42703` 時退回無 checkpoint 行為，空窗期不會整批失敗（expand/contract）。
- **已知殘留**：送出成功但在標記送達前崩潰 → 重送同一 token → LINE 4xx → job 進 dead-letter。訊息已送達且不會重複，只是 job 狀態偏悲觀。

## 2026-07-14 — Webhook queue 採 LINE event 單次處理（已被上面的 checkpoint 取代）

- **覆核修正**：Claude 的初版 queue worker 註解宣稱不會 push，但實際沿用 `replyMessage()` 的 reply-failed-to-push fallback；另在 DB 前丟棄 redelivery，且 fail-open event 先 ACK 才同步處理。三者分別可能消耗 push 額度、吞掉首次未入列事件、以及在同步失敗後阻止 LINE 再投遞，均已修正並補入口時序測試。
- **LINE event 採 at-most-once**：固定 `max_attempts=1`，queue worker 明確關閉 push fallback。理由是整個 handler 尚無「AI 已完成／訊息已送達」durable checkpoint；盲目 retry 可能把一次 LINE delivery failure 變成多次 OpenAI／生圖費用。
- **redelivery 交給 DB 判斷**：queue 模式不再入口先丟棄 redelivery；原子 `processed_events + jobs` transaction 已存在時去重，首次未成功入列時則允許重送補入。
- **ACK 邊界**：durable 入列成功可先回 `200` 再 `waitUntil()` drain；沒有 durable 保護的 fail-open event 必須先同步成功才 ACK，失敗回 `500`。
- **租約**：LINE job lease 預設由 60 秒提高到 120 秒，高於目前 Vercel function 60 秒上限，避免仍在執行的 job 被誤判過期。

## 2026-07-14 — Supabase 上線與 Phase 0 併發／私隱加固

- **Supabase 已建立**：免費專案位於 Tokyo，Vercel Production 使用 transaction pooler。啟用 SSL enforcement，client 以 Dashboard CA 做 hostname verification；明文連線已實測被拒絕。
- **不採用原本「登記後另行入列」**：`processed_events` 與 job 必須同 transaction，否則入列失敗會使 redelivery 被永久略過。
- **lease 需 fencing token**：只用 job id 完成／重試時，過期舊 worker 可覆寫新 worker；現在每次 claim 產生新 token，狀態變更必須同時匹配。
- **confirmation 必須 durable**：純函式 state machine 不能防止多 instance 同時 commit；現以 DB row lock + transaction 保證併發確認只建立一筆 event。
- **私隱邊界**：durable job payload 以 AES-256-GCM 加密，LINE user id 以 HMAC 代碼後落庫。`DATA_ENCRYPTION_KEY` 遺失就無法解密舊 job，必須與 DB 備份同等保管。
- **驗證**：migration / rollback / re-migration 實際往返；併發 ingest `1/2`、stale/current lease `false/true`、併發 confirmation `1 event`；密文與 HMAC 均直接查 DB 確認。

## 2026-07-14 — Phase 0 起手：資料庫基礎（inert，不改線上 bot）

- **決定**：依 [`ROADMAP.md`](ROADMAP.md) Phase 0 建立資料庫基礎的第一片：`services/database.js`（`pg` 直連、`DATABASE_URL` 驅動、fail closed）、`db/migrations/0001_init.sql`（`users`/`processed_events`/`jobs`/`runs`）、`repositories/processed-events.js`（`INSERT ... ON CONFLICT` 原子冪等）＋ mock 測試。新增相依 `pg`。
- **刻意 inert**：這批**尚未接入 webhook / handler**，未設 `DATABASE_URL` 時完全不使用——主人剛把 bot 接通，不能因為引入 DB 依賴而弄壞正在運作的部署。接線（webhook 冪等改走 DB、durable queue worker）留待 Supabase 上線後的下一片。
- **技術選擇對齊 ROADMAP**：用 `pg` 直連（非 `@supabase/supabase-js`），因為 Phase 0 需要交易、列鎖與 `FOR UPDATE SKIP LOCKED` 佇列；`jobs` 表即「等價 durable queue」，不強制依賴 pgmq 擴充。照 ROADMAP 明列的預計檔案結構實作，避免與 Codex 的架構分歧。
- **Supabase 後續**：專案、Vercel env 與 migration 已於同日完成；後續工作是 webhook / worker / schedule handler 接線。
- **驗證**：`npx eslint .` 0 errors、`npm test` 53/53（24 suites）。此為 inert 基礎，未改運行時行為，記入 CHANGELOG `Unreleased`，不單獨切版。

## 2026-07-13 — 採用 LINE 個人助理功能路線圖

- **決定**：在保留 OpenAI + LINE、自架、自備 API key 的前提下，分階段加入行程、任務、提醒、多模態建行程、日曆同步、天氣推播、含來源搜尋與安全分享。完整規格以 [`ROADMAP.md`](ROADMAP.md) 為準。
- **排序**：先完成 Supabase Postgres、durable queue、worker、scheduler、DB 冪等與觀測性，再交付具狀態與主動推播的功能。現有 Vercel env storage 與 process-memory 去重不得承載新功能的正式狀態。
- **理由**：最近 LINE webhook timeout redelivery 已實際造成重複付費呼叫與回覆；行程、提醒與雙向同步若沒有交易、lease、retry 與 delivery idempotency，會放大相同問題。
- **參考邊界**：Toki（前身 Dola）的現行官網、更新頁、品牌演進、舊版 note 文章與 LINE VOOM 27 篇貼文只用來整理產品行為，不複製其程式碼、文案、品牌、畫面或素材。fermi 只吸收架構經驗，不併入 FSL 原始碼。
- **OAuth 邊界**：允許 Google Calendar OAuth，因為它是授權日曆資料；仍禁止把 OpenAI / ChatGPT 訂閱 OAuth 當成第三方 bot 的 API 金鑰替代品。
- **頻道範圍**：LINE first。多頻道 adapter 排在核心能力穩定之後；沒有合適官方整合方式的 iMessage 不列為必交付。

## 2026-07-12 — v4.12.3（private Blob signed URL + webhook 去重）

- **問題一**：實際 Blob store 是 private，程式卻用 `access: 'public'`，production 回覆 `Cannot use public access on a private store`。
- **修法一**：改用 private upload，再以 Vercel Blob signed token 簽出只允許單一 pathname GET、約 7 天有效的 URL。Store credential 不會交給 LINE，也不需要另建 public store。
- **問題二**：生圖約需 18 秒，LINE 在收到 webhook 200 前已判定 request timeout，約每 62 秒 redeliver；每次都可能重新生圖並產生成本。
- **修法二**：優先保護成本，所有 `isRedelivery=true` 事件直接忽略；另以 bounded Set 記住 warm runtime 最近 1000 個 `webhookEventId`，擋掉同批或未標 redelivery 的重複事件。首次處理若失敗，使用者需重新送出指令。
- **止血措施**：修復部署前曾暫時在 Production 設 `ENABLE_IMAGE_GENERATION=false`；永久修復上線後移除。

## 2026-07-12 — v4.12.2（生圖預設改為 GPT Image 2）

- **問題**：production 實測 `dall-e-3` 回覆 `The model 'dall-e-3' does not exist`；OpenAI 官方已把 DALL-E 3 標為 deprecated。
- **決定**：預設改為官方現行 Image API 模型 `gpt-image-2`，沿用既有 base64 → Vercel Blob → LINE 公開 URL 流程。
- **成本控制**：預設品質採 `low`；若維護者明確把模型設回 DALL-E 且未指定品質，則自動用相容的 `standard`。
- **逾時預算**：生圖 API 獨立設 55 秒，Vercel function 設 60 秒；production 是未啟用 Fluid Compute 的 Hobby project，60 秒為目前方案上限。其他 API 保留原本較短 timeout。
- **部署確認**：production 沒有舊模型環境變數覆寫，且已連結 Vercel Blob store，因此 push 後的新預設可直接生效。
- **驗證**：新增 `tests/config.test.js`；並重跑 GPT Image / Blob 相關測試、完整 Jest 與 ESLint。
- **CodeQL 後續**：同次 push 發現 URL 摘要的 regex HTML 轉換有 `bad-tag-filter` / `double-escaping` 高嚴重度 alerts；改用 MIT `html-to-text@9` parser（保留 Node 18 相容），並補變形 script tag 與單次 entity 解碼測試。

## 2026-07-12 — v4.12.1（修 Blob 認證：支援 Vercel OIDC，token 改選用）

- **問題**：實際在 Vercel 連結 Blob store 後，注入的是 `BLOB_STORE_ID`（＋webhook key）而非 `BLOB_READ_WRITE_TOKEN`——新版 Vercel Blob 走 OIDC 授權。但 `utils/upload-image.js` 原本硬性要求 `BLOB_READ_WRITE_TOKEN`、沒有就丟錯，反而擋掉 OIDC 這條路。
- **修法**：`uploadImage` 改為 token **選用**——有就明確傳入，沒有就不傳，交給 `@vercel/blob` 依序解析（明確 token → OIDC（`BLOB_STORE_ID` + 執行期 OIDC token）→ `BLOB_READ_WRITE_TOKEN` 環境變數）。在 Vercel 連結 store 的情況下無需靜態 token。
- **驗證依據**：直接讀 `node_modules/@vercel/blob` 認證邏輯確認 OIDC + `BLOB_STORE_ID` 分支。更新 `tests/upload-image.test.js`（缺 token → 不傳 token、仍呼叫 put）。`npm test` 39/39。
- **fallback**：若某環境 OIDC 未生效（log `No blob credentials found`），再設 `BLOB_READ_WRITE_TOKEN` 即可。
- 版本 `4.12.0` → `4.12.1`（patch）。

## 2026-07-12 — 發布 v4.12.0（GPT Image 支援：Vercel Blob 圖片儲存）

> 歷史紀錄：本節的 `dall-e-3` 預設與 public Blob 作法已分別由 v4.12.2 的 `gpt-image-2`、後續 private Blob signed URL 修正取代；目前設定請以 [`DEVELOPMENT.md`](DEVELOPMENT.md) 為準。

- **決定**：以 **Vercel Blob** 作為生圖的圖片儲存後端（主人有 Vercel 免費帳號），解鎖 GPT Image（`gpt-image-1`，回傳 base64）。新增相依 `@vercel/blob@^2.6.1`（`npm audit` 0）。
- **實作**：`utils/upload-image.js`（base64 → Vercel Blob → 公開 URL，需 `BLOB_READ_WRITE_TOKEN`）；`utils/generate-image.js` 改為：回應有 `url`（DALL·E）直接用、有 `b64_json`（GPT Image）上傳 Blob 取 URL。**預設 `dall-e-3`（URL）維持不變、不需 Blob**——自動向下相容，無需 flag。
- **測試**：`tests/generate-image.test.js`（url 分支不上傳 / b64 分支上傳）、`tests/upload-image.test.js`（mock @vercel/blob，含缺 token 丟錯）。皆 mock，不需真實 Blob/OpenAI。
- **限制（DEVELOPMENT.md 記錄）**：Blob 圖片不會自動清除、會累積受免費額度限制；URL 公開可讀。
- **驗證分工**：我建置 + mock 測邏輯；端到端需主人：Vercel 建 Blob store（自動注入 token）、設 `OPENAI_IMAGE_GENERATION_MODEL=gpt-image-1`、確認 OpenAI GPT Image 權限、部署。
- **版本**：`4.11.0` → `4.12.0`（語意化中版號，向下相容）。tag `v4.12.0` + Release。`npx eslint .` 0、`npm test` 39/39（19 suites）。

## 2026-07-12 — 發布 v4.11.0（網址摘要，SSRF-safe，預設關）

- **網址摘要**：新增 `ENABLE_URL_SUMMARY`（預設 `false`）。開啟後 talk 遇到訊息含 http(s) 網址時，會抓取網頁純文字作為對話上下文交給模型。
- **SSRF 防護**（可測核心）：`utils/is-private-ip.js`（純函式，判私有/迴環/link-local/保留 IPv4+IPv6）、`utils/assert-safe-url.js`（scheme 白名單 + 解析所有 IP 檢查）、`utils/fetch-url.js`（無 redirect、限大小/逾時、僅 text）。新增 `tests/ssrf-guard.test.js`（字面 IP + scheme，不需網路）。
- **殘留風險（已於 DEVELOPMENT.md 誠實記錄）**：DNS rebinding（未做 IP pinning）、不支援 redirect、fetched 內容的 prompt injection。因此**預設關**、建議僅信任使用者的自架情境開啟。signed image proxy / provider abstraction 仍待做。
- **版本**：`4.10.0` → `4.11.0`（語意化中版號，向下相容：只新增環境變數且預設關）。tag `v4.11.0` + GitHub Release。
- **驗證**：`npx eslint .` 0 errors、`npm test` 35/35（17 suites）。

## 2026-07-12 — 發布 v4.10.0（群組政策 + Push fallback + 版本檢查改指 fork）

- **群組 reply policy**：新增 `GROUP_REPLY_REQUIRES_MENTION`（預設 `false`＝原行為）。`true` 時群組必須以指令或 bot 名稱點名才回一般訊息，減少群組噪音。改 `app/handlers/talk.js` 的 `check`；新增 `tests/group-reply-policy.test.js`。
- **LINE Push fallback**：`services/line.js` 新增 `push`；`utils/reply-message.js` 在 reply 失敗（reply token 失效/過期或 API 出錯）且有可推播目標時改用 Push API 送出，避免訊息靜默遺失。新增 `tests/reply-message.test.js`。（`fermi` 評估的 reply-token elapsed budget 部分暫緩：Vercel `maxDuration` 10s 下 reply token 不會過期，邊際效益低。）
- **版本檢查改指 fork**：`utils/fetch-version.js` 由上游 `memochou1993/gpt-ai-assistant` 改為 `SanHsien/gpt-ai-assistant`，讓 `version` 指令與更新提示比對本 fork 自己的版本。
- **語意化版本**：`package.json` `4.9.1` → `4.10.0`（中版號）。理由：本 fork 至今全部改動皆向下相容——只新增環境變數且有安全預設、bug 修復、模型預設變更但未改/刪環境變數名，無破壞性變更。CHANGELOG 的 `Unreleased` 收斂為 `4.10.0`，並打 tag `v4.10.0` + GitHub Release。
- **驗證**：`npx eslint .` 0 errors、`npm test` 26/26（16 suites）。

## 2026-07-11 — 對話 TTL + CI workflow + 狀態徽章

- **conversation max-age TTL**：新增 `APP_MAX_PROMPT_AGE`（秒，預設 `0`＝停用）。`app/prompt/prompt.js` 的 `Prompt` 加 `updatedAt`（write/writeImage/patch 更新）；`app/prompt/index.js` 的 `getPrompt` 在超過 TTL 時刪除舊 prompt、回傳全新的。**預設 0＝行為與先前完全一致**，operator 可設 `3600` 等值讓久未互動的對話 context 自動過期，控 token 成本與避免舊脈絡污染。新增 `tests/prompt-ttl.test.js`（age 內保留 / 過期換新 / age=0 永不過期）。
- **CI workflow**：新增 `.github/workflows/ci.yml`，每次 push / PR 對 `main` 跑 `npm ci` → `npx eslint .` → `npm test`（Node 20）。讓「測試通過」成為可驗證的門檻，而非人工聲稱。
- **README 徽章**：新增 CI 與 CodeQL 的**即時狀態徽章**（連到對應 Actions workflow），並補一個 `tests: jest` 靜態徽章。狀態徽章置於最前。
- **驗證**：`npx eslint .` 0 errors、`npm test` 21/21（14 suites）。

## 2026-07-11 — 能力 feature flags（成本控制）

- **決定**：新增 4 個能力開關（評估內容現已併入 [`ROADMAP.md`](ROADMAP.md)），預設全開、可 opt-out（`env.X !== 'false'`）：`ENABLE_IMAGE_GENERATION`、`ENABLE_TRANSCRIPTION`、`ENABLE_VISION`、`ENABLE_SEARCH`。
- **動機**：剛把生圖升到較貴的 `dall-e-3`、語音/看圖也可能產生成本；讓部署者能一鍵關掉個別能力控成本或縮小攻擊面，而不必改碼。
- **實作**：`config/index.js` 加旗標；`app/handlers/draw.js`、`app/handlers/search.js` 在 handler 開頭 gate，停用時回覆 `__ERROR_FEATURE_DISABLED`（新增於 zh/en/ja locale）；`app/context.js` 的 audio（transcription）、image（vision）在 `initialize()` 內短路（`pushError` 回覆停用訊息、跳過 handler pipeline）。預設全開＝行為與先前完全一致。
- **驗證**：新增 `tests/feature-flags.test.js`（draw / search 停用時回文字、不呼叫外部 API）；`npx eslint .` 0 errors、`npm test` 18/18（13 suites）。

## 2026-07-11 — 升級預設 API 模型（Phase 1-2 落地）

- **決定**：依模型評估（現已併入 [`ROADMAP.md`](ROADMAP.md)）把「過舊/次佳」的呼叫模型換成新預設（皆走環境變數，可覆寫）：
  - 對話 `OPENAI_COMPLETION_MODEL`：`gpt-3.5-turbo` → **`gpt-4o-mini`**（品質大升、成本更低；支援既有 `temperature`/`stop`/penalty 參數，相容 Chat Completions）。
  - 生圖 `OPENAI_IMAGE_GENERATION_MODEL`：`dall-e-2` → **`dall-e-3`**（仍回傳 URL、相容 LINE image reply；`OPENAI_IMAGE_GENERATION_SIZE` 預設改 `1024x1024`，dall-e-3 最小尺寸）。⚠️ dall-e-3 單張成本約為 dall-e-2 的 2 倍以上，可設回 `dall-e-2`。
  - 語音 `services/openai.js` 硬編 `whisper-1` → **可設定** `OPENAI_TRANSCRIPTION_MODEL`，預設 **`gpt-4o-mini-transcribe`**（更省，LINE 語音多半短）；可設回 `whisper-1` 或升 `gpt-4o-transcribe`。
  - 看圖 `OPENAI_VISION_MODEL` 維持 `gpt-4o`（已是現代模型，未動）。
- **驗證**：`npx eslint .` 0 errors、`npm test` 全過（測試未寫死 model 名）。
- **仍待做（我做不到，需金鑰）**：用真實 OpenAI key 對 `talk`/`sum`/`translate`/`analyze`/vision/語音/生圖各打幾條中文案例做 smoke test，確認輸出風格與成本符合預期。只有這步能取代「評估文件的價格/名稱是參考值」的保留。
- **未採用**：`gpt-5-mini`/`gpt-5.6-luna`/GPT Image 新版等——名稱/價格需先對官方頁重核，且 GPT Image 回傳 base64 需先做 LINE 可讀 URL 暫存，屬後續階段。

## 2026-07-11 — 目前維持 MIT，不立即轉 FSL-1.1-MIT

- **決定**：記錄 MIT / FSL-1.1-MIT 差異與合併邊界（現已併入 [`ROADMAP.md`](ROADMAP.md)）。本 repo 目前仍維持 MIT，不立即轉 FSL-1.1-MIT。
- **理由**：本 repo 目前是輕量、自架、維護型 fork，MIT 後遺症最少；轉成 FSL 不會自動解除 fermi 原始碼的授權限制，也會降低下游採用與貢獻意願。
- **未來重評條件**：若要直接併入尚未轉 MIT 的 fermi 原始碼、另開 full-stack v2、或提供商業服務並需要限制直接競品使用，再重新評估 FSL-1.1-MIT。

## 2026-07-11 — 其他參考專案只取概念，不直接併碼

- **決定**：逐一評估 LINE 官方 SDK、TheExplainthis、ycs77、ctjoy、n3d1117 Telegram bot；評估現已併入 [`ROADMAP.md`](ROADMAP.md)。
- **理由**：這些專案可提供 Redis TTL、群組 gating、signed image proxy、usage/budget、feature flags、plugin registry、AWS Lambda 部署等概念，但授權與架構差異不適合直接合併程式碼。
- **下一步**：優先考慮 LINE Push fallback、feature flags + usage logging、conversation TTL / group policy、signed image proxy。

## 2026-07-11 — fermi 只吸收架構方向，不直接合併原始碼

- **決定**：把原作者接班專案 `memochou1993/fermi` 評估為架構參考（現已併入 [`ROADMAP.md`](ROADMAP.md)）：可吸收 webhook queue、reply/push fallback、Postgres 持久化、run trace、encrypted credentials、capability 思路；不直接合併 fermi 原始碼，也不把本 repo 立即改成 Supabase + Nuxt + OpenRouter。
- **理由**：fermi 採 `FSL-1.1-MIT`，目前不是即時 MIT；且它是完整 full-stack 重構，直接合併會破壞本 repo「輕量 OpenAI + LINE 自架 bot」定位。
- **下一步**：依評估文件分階段重做最有價值的能力：先做 LINE reply token budget + Push fallback，再抽 storage/provider，之後才評估 Supabase 持久化與 queue worker。

## 2026-07-11 — 排除 OpenAI / ChatGPT 訂閱 OAuth 作為此 bot 授權方向

- **決定**：此 repo 不做「使用 OpenAI / ChatGPT 訂閱 OAuth 取代 `OPENAI_API_KEY`」的功能。維持 OpenAI API key / project / service account 類路線。
- **理由**：OpenAI 官方說明目前仍將 ChatGPT 訂閱與 API usage 分開計費與管理；Codex 的 ChatGPT sign-in 是 Codex 客戶端授權面，不是第三方 server-side LINE bot 可用來呼叫 OpenAI API 的 delegated OAuth。
- **影響**：README、AGENTS、CLAUDE、NOTICE 不再把「OpenAI 訂閱 OAuth」列為候選 roadmap。若未來官方推出適用於第三方 API app 的 delegated auth，再另開評估。

## 2026-07-11 — API / 模型升級採分階段評估

- **決定**：把對話、看圖、語音、生圖、搜尋的 API 與模型候選拆開評估，不直接一次改預設；評估現已併入 [`ROADMAP.md`](ROADMAP.md)。
- **理由**：對話 / vision 可較低風險測 `gpt-4o-mini` 或 `gpt-4.1-mini`；但語音轉錄目前硬編 `whisper-1`，生圖新版 GPT Image 常回傳 base64 而 LINE image reply 需要公開 URL，OpenAI web search 又需要 Responses API 與成本格式調整。這些不應只改 model string。
- **下一步**：先做小型 smoke test 比較 `gpt-4o-mini`、`gpt-4.1-mini`；再新增 `OPENAI_TRANSCRIPTION_MODEL`；最後再設計 GPT Image 圖片暫存與搜尋 provider 抽象。

## 2026-07-11 — 自架文件站（GitHub Pages 專案站）

- **決定**：fork 上游文件 repo [`memochou1993/gpt-ai-assistant-docs`](https://github.com/memochou1993/gpt-ai-assistant-docs)（VuePress）到 `SanHsien/gpt-ai-assistant-docs`，以 GitHub Pages 專案站發佈於 **<https://sanhsien.github.io/gpt-ai-assistant-docs/>**（英文 `/en/`）。沿用同名 repo 故 VuePress `base` 不用改。
- **改動（docs repo）**：config 的 `repo`/`docsRepo` 指向 `SanHsien/*`；移除上游作者的 Google Analytics id；部署改用官方 GitHub Pages Actions（`upload-pages-artifact` + `deploy-pages`）取代第三方 gh-pages 分支 action；Pages 來源設為 Actions。build+deploy 綠燈、首頁與子頁（含 `deployment.html` Vercel 教學）皆 200。
- **改動（本 repo 引用）**：README.md / README.en.md 的文件站連結改指自架站並註明 fork 自上游；**`app/handlers/doc.js`** 的 `/doc` 指令回覆網址也改為自架站（原本回上游）。
- **授權注意**：上游 docs repo 無 LICENSE 檔（但 package.json 標 MIT），fork 關係本身已在 GitHub 保留 attribution；README/NOTICE 亦註明來源。

## 2026-07-11 — 全盤 bug 檢視與修復（6 項）

fresh-context code review 後逐項驗證，修掉 6 個真正的 bug（非風格）：

1. **群組「忘記」指令沒清歷史** `app/handlers/forget.js` — 歷史用 `context.id`（群組=groupId）當 key，但 forget 用 `context.userId` 去 delete，群組永遠清不掉。改 `removeHistory(context.id)`。（prompt 本就 userId-keyed，維持不動。）
2. **搜尋無 organic_results 會 crash** `utils/fetch-answer.js` — `organicResults[0].snippet` 在只有 answer_box/knowledge_graph 時丟 TypeError。改 `organicResults?.[0]?.snippet || ''`（search handler 早有 `answer || 未找到` fallback，剛好接上）。
3. **版本指令無 try/catch＋fetchVersion 無 timeout** `app/handlers/version.js`、`utils/fetch-version.js` — GitHub raw 逾時會讓整批 webhook 事件回覆全滅。加 timeout（`APP_API_TIMEOUT`）＋handler try/catch，失敗仍回傳 current 版本。
4. **健康檢查路由未捕捉例外** `api/index.js` GET `/` — Express 4 async reject 不自動處理，`fetchVersion` 失敗會讓請求掛到平台逾時。加 try/catch，`latestVersion` 失敗回 null 仍正常回應。
5. **`OPENAI_COMPLETION_STOP_SEQUENCES` 從未送出** `services/openai.js` — config 有解析、CHANGELOG 有記載，但 `createChatCompletion` body 沒帶 `stop`（疑遷移到 chat completions 時漏帶）。補上 `stop`。⚠️ 這會恢復預設 `[' assistant:', ' user:']` 的截斷行為（影響很小、屬回復原意，不喜可移除）。
6. **語音轉錄留下無用 /tmp 檔** `app/context.js` — `fs.writeFileSync` 寫的檔從沒被讀（Whisper 用 buffer，`file` 只當 multipart 檔名），serverless warm container 會累積。移除 writeFileSync 與 fs import，`file` 改純檔名。

驗證：`npm test` 10/10；改動檔 eslint 無非-CRLF 錯誤。

## 2026-07-11 — 開發前安全整備（加固 + CodeQL + Dependabot）

- **確認**：開發前完整安全掃描——`npm audit` 0、Dependabot 0 open、Secret scanning 0、無硬編金鑰、`.env` 未提交也不在歷史。webhook 有正確的 LINE 簽章驗證（HMAC-SHA256 + `timingSafeEqual`，`api/index.js` 進 handler 前先過 middleware）。
- **加固**：`middleware/validate-line-signature.js` 補 `!signature` 與 `req.rawBody || ''` 防呆——缺 `x-line-signature` header 時乾淨回 403，不再因 `Buffer.from(undefined)` 丟 500。非安全漏洞（請求本就被擋），只是行為與 log 更乾淨。
- **CodeQL**：新增 `.github/workflows/codeql.yml`（push/PR/週一排程掃 JS/TS，`security-and-quality` query set），開啟 GitHub code scanning。
- **Dependabot 自動更新**：新增 `.github/dependabot.yml`——npm（prod/dev 分組）與 github-actions 每週檢查，讓相依日後自動保持修補。
- **驗證**：`npm test` 10/10；兩個 YAML 語法檢查通過。

## 2026-07-11 — 清除相依套件漏洞

- **決定**：修掉 GitHub/Dependabot 在 default branch 回報的相依漏洞。`npm audit fix` 處理所有非破壞性項目（大多為 transitive：babel、axios、express→body-parser/qs/send/serve-static/path-to-regexp、braces、picomatch…），並把 dev 工具 `nodemon` 從 `^2.0.20` 升到 `^3.1.14`（唯一 breaking，只影響本機熱重載）。結果 `npm audit` 從 30 項（2 critical / 14 high…）降到 **0**。
- **驗證**：`npm test` 修前修後皆 10/10 通過。
- **未處理（另案）**：`npx eslint .` 有大量 `linebreak-style` CRLF 錯誤——本機 checkout 換行符問題（git autocrlf + OneDrive），非程式碼錯誤、與本次無關。待決定是否加 `.gitattributes` 統一 LF 再一次性 normalize。
- **邊界**：直接相依 `axios` `^1.2.1`、`express` `^4.18.2` 的 `^` 範圍已涵蓋修補版，只動 lockfile，不改 package.json 版本字串（除 nodemon）。未升 eslint 8→9 / gpt-3-encoder 等無 advisory 的舊套件，避免無謂 breaking。

## 2026-07-11 — 建立 fork 開發鷹架

- **決定**：比照 `SanHsien/sticker-forge` 的做法，為此 fork 補上 AI 接手文件與維護文件：`AGENTS.md`、`CLAUDE.md`、`SKILL.md`、`NOTICE.md`、`REVIEW.md`、`docs/DEVELOPMENT.md`、`docs/DECISIONS.md`，並改寫 README 為中文版為主（`README.md`）＋英文版（`README.en.md`）。
- **理由**：讓 Claude Code / Codex 等 agent 接手時有一致的規則與定位；中文為主符合維護者慣用語言。

## 2026-07-11 — fork 方向：維持 OpenAI + LINE 原架構

- **決定**：此 fork 現階段維持原專案的 OpenAI + LINE 設計，做維護與小改良，不重寫、不換供應商。
- **理由**：原架構可用且熟悉；維護成本低，適合先做 bugfix、安全加固與模型 / API 升級。
- **候選方向（尚未拍板）**：
  - 依 [`ROADMAP.md`](ROADMAP.md) 逐步升級模型與 API。
  - 未來可能的 Claude 版助理——可能開新專案，也可能在此 repo 分支，方式待定（看哪種較合適）。
- **邊界**：候選方向動工前先與維護者確認；未定前不引入 Anthropic SDK、不換供應商、不動搖「使用者自架、自備金鑰」本質。

## 2026-07-11 — 部署定位：不限定、Vercel 優先

- **決定**：部署平台不寫死，但文件與預設以 Vercel serverless 為主；同時保留本機 node 與 Docker 兩種跑法作為選項。
- **理由**：原架構（`vercel.json`、`VERCEL_*` 環境變數、`deploy` 自我重新部署指令）本就為 Vercel 設計；但不封死其他自架方式。
