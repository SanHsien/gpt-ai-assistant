# 專案覆核

最後覆核：2026-08-08，版本 `6.1.0`。

## 結論

6.0 的程式收斂、維護基線與集中實機驗收已完成；`6.0.1` 補上正式驗收清理時發現的行程刪除與提醒一致性修正。`6.1.0` 讓 primary Google Calendar 既存的未來單次 timed 行程與有期限任務共用 LINE 提醒，並完成 Production migration、Cron、Google inbound、實際 LINE 投遞與清理閉環。2026-08-08 另以 LINE Windows app 重跑 Google OAuth 與行程同步 smoke test，LINE、Calendar、Supabase、Vercel 及精準清理再次完成閉環。

本次移除 serverless process-memory 去重、同步 fail-open 與 Vercel env storage。所有 webhook 必須先通過 runtime preflight 並原子寫入 Postgres；缺事件 ID、DB／migration 異常或必要金鑰缺失時回 `5xx`，讓 LINE redelivery。`bot_sources` 使用 HMAC key 與交易鎖保存 user/group 啟停狀態及原子配額，並啟用 RLS、不提供 client policy；不落地原始 LINE id、名稱或對話。

Google Calendar／Tasks 的 scopes、能力矩陣與 inbound 衝突政策已收斂為共用 contract。Calendar mapped timed non-recurring inbound、primary calendar 上未來 timed non-recurring Google-origin baseline／增量匯入，以及 Tasks mapped inbound/outbound 在契約內；全天 inbound、recurrence series／exception、非 primary 匯入及 Tasks due 回收仍明確不支援。RC.4 完成 Express 5、Jest 30、ESLint 10 flat config、注入式 bot source repository 與容器 port／liveness fail-safe；rc.5 補 Tasks API 前置與 dead job 恢復；rc.6 修正實機發現的週期行程 UTC offset 重複套用，並讓確認摘要明列重複規則。

## 驗證

- `npm ci`：成功；`npm audit --audit-level=high`：0 vulnerabilities。
- `npx eslint .`：通過；`npm run test:module-load`：原生 Node ESM 載入通過。
- `npm test -- --runInBand`：77 suites、538 tests 全部通過；新增依賴 freshness、核准暫緩版本邊界、Dependabot 風險政策與 guarded merge workflow 回歸，既有週期行程、Google transport／worker time budget、Calendar sync query v2、桌面音訊、durable、Quick Reply、完整 `指令` 與 Google contract 測試全數保留。
- 聚焦覆蓋：durable-only webhook fail-closed、runtime migration/config preflight、bot source 原子上限與啟停、同使用者事件順序，以及 Google provider scopes／衝突／不支援能力。
- 單一 root 初始化前已建立包含全部 refs 的離線 bundle 並通過 `git bundle verify`；bundle 未提交至 repo。初始化後 `main` 只包含由 SanHsien 署名、訊息為「初始化」的一筆 root commit，Contributors API 只列 SanHsien。
- GitHub CI、CodeQL 與文件站 Pages 均成功；CodeQL 與 secret scanning open alerts 都是 0。
- 文件站本機 build 通過，13 頁共檢查 362 個內部連結；Production 首頁與主要設定頁 HTTP 200。
- Production `SERPAPI_API_KEY` 已設為 Vercel Sensitive env，值未進聊天、log 或 Git；Production Supabase 已套用 `0019_calendar_sync_query_version.sql` 並核對 checksum，`bot_sources` RLS 已啟用。
- Vercel Production 已確認 Node `24.x`、穩定網域與 `/health/live` 回 `200`；先前 `5.13.0` ↔ RC promote／rollback 往返仍是已通過基線，正式 `6.0.0` 亦已完成部署與 health 驗證。
- 集中實機已通過：功能感知 `指令`、嘉義市縣天氣追問、搜尋建立行程草稿、Calendar outbound 單筆建立、Google 端 timed 修改 inbound、舊／新時刻提醒各只送一次，以及 Tasks outbound、標題 inbound、完成、重開與不產生複本。
- Production 已移除程式不再讀取的 `APP_WEBHOOK_QUEUE`。實機發現的 `每天 22:40` 顯示為 `14:40` 已由 rc.6 的確定性時區校正修復，並在後續 LINE／Google 週期閉環驗收通過。
- **［已完成 Production 重驗］Google OAuth 與單筆行程同步**：2026-08-08 由 LINE Windows app 傳送一次 `連結 Google 行事曆`，維護者只接手 Google 登入／同意，AI 隨即續做同一輪驗收。唯一前綴 `SMOKE-20260808-213735` 的 22:22–22:37 行程只確認一次，LINE 回覆同步成功，Google Calendar 緊縮時間窗只有一筆；Supabase sync／status jobs 各 attempts 1 且 done，reminder job 排入後隨 event 刪除取消為 done、attempts 0，本輪 dead job 與 pending 孤兒提醒都是 0。Calendar event、1 筆 confirmation、3 筆 jobs 與本機 Temp 均精準清理並重查為 0。完整證據見 [2026-08-08 deploy report](.gstack/deploy-reports/2026-08-08-v6.1.0-google-oauth-smoke.md)。
- **［已修復］Production smoke 操作流程與文件不足**：本輪一度未先讀既有 LINE PC runbook、對已授權中間步驟重複詢問、Google OAuth 交接後未主動續測、誤把 Vercel Sensitive env 遮罩與 Chrome 擴充功能 UI 阻擋視為 Supabase 不可驗，並過早接受 DB 未驗限制。`bbf2d8c`（2026-08-08）將恢復流程、OAuth 新 tab／stale handle、已登入 Supabase SQL Editor 路徑、SELECT-only audit、bounded fallback、精準 CTE delete／`RETURNING`、多 job 歸零與 Temp lifecycle 寫入權威 runbook；同時明定 `processed_events`／`runs` 保留，避免破壞 webhook dedupe 或運維 evidence。獨立 `gpt-5.6-sol` high review 最終 APPROVE。
- **［已修復］刪除行程殘留 pending reminder**：正式驗收清理發現已刪除的行程仍有兩筆待執行提醒。根因是 `deleteEvent`／`deleteEventByProviderId` 只刪 `events`；`6b03aa3`（2026-07-22）改為原子刪除並取消該 event 的 pending reminder，涵蓋 LINE 與 Google inbound 路徑，repository／handler／inbound 聚焦測試共 91 項通過。Production 的兩筆孤兒工作及可精準界定的舊驗收資料已清除，複查為 0。
- **［已修復］依賴 PR 與 issue 缺少處理閉環**：`8149964`（2026-07-26）新增受信任 base 政策分類、head-SHA check、必要 CI gate、核准／squash merge、固定 freshness tracker reopen／close 與合併後重驗；GitHub Actions 已允許 workflow review，`main` 已設 strict required checks、1 人核准、stale dismissal、conversation resolution、linear history及禁止 force push／delete。Dependabot PR #7、#8 經 guarded merge 自動核准合併，執行期 PR #6 經人工檢查 release notes、差異與完整 checks 後合併。
- **［已修復］並發事件可能遺失 auto-merge queue 項目**：GitHub concurrency 只保留一筆 running 與一筆 pending，原設計可能取消另一 PR 的成功事件；`c455265`（2026-07-26）改為每次成功事件重新掃描整個 auto-merge label queue，並維持目前 head 的政策 check、required checks 與 merge-head 比對。
- **［已修復］開發工具 major 自動合併過寬與 npm audit 19 high**：Babel 8 通過測試但與 Jest 30 內部 Babel 7 peer contract 衝突；`047a0d3`（2026-07-26）回復 Babel 7.29.7、將 npm major 一律改為人工審查，並以套件範圍 overrides 升級 Jest 的 `glob`／`test-exclude` 漏洞鏈；`86ad207`（2026-07-26）同步讓 Dependabot 暫緩不相容的 Babel major，並由 freshness issue 持續追蹤相容時機。`npm ci` 無 peer conflict，`npm audit --audit-level=high` 為 0，完整 lint、module-load 與 77 suites／537 tests 通過。
- **［已修復］人工審查 PR 與 tracker 狀態延遲**：最終 `gpt-5.6-sol` high 跨 repo 覆核指出，人工審查型 Dependabot PR 若只開啟或未合併直接關閉，原本要等月排程才更新 freshness tracker；`735fcb6`（2026-07-26）讓 opened／reopened／synchronize／ready-for-review／closed 都立即 dispatch freshness，closed 只同步 tracker、不再分類或修改已關閉 PR，且全程不 checkout／執行 PR 程式碼。
- **［已修復］PR lifecycle dispatch 失敗與 tracker 無法關閉**：PR #9 實跑顯示，無 checkout 的 `sync-freshness` 未指定 repository，`gh workflow run` 因找不到 Git context 失敗；同時 Babel 8 已核准暫緩仍永久計入 `needs_attention`。`fdb0841`（2026-07-29）明確傳入 repository，新增僅限 Babel 8 的版本化 deferral（不隱藏 7.x 更新或 Babel 9），並人工審查升級 `express-rate-limit` 8.6.1。完整 lint、module-load、77 suites／538 tests 與 `npm audit` 0 通過；freshness 本機輸出 `needs_attention=false`。
- **［已完成並通過 Production 驗收］Google 既存行程、行程提前一天與任務到期提醒**：`a810e04`（2026-07-29）將 `REMINDER_OFFSETS` 預設改為 `1440` 並保留到點提醒；Calendar inbound v3 baseline 會匯入 primary calendar 既存的未來 timed non-recurring Google-origin 行程。三輪 `gpt-5.6-sol` high 覆核發現並修正 baseline 重入互刪、單次大量匯入逾時、改為不支援型態仍殘留提醒、task mutation 非原子、舊 task job 穿透、時區 fallback 與 rollback 殘留提醒等問題。最終 baseline／incremental 以 owner-exclusive fencing claim 固定 query snapshot，每個 durable job 僅處理一頁，checkpoint 與 continuation 入列同 transaction；過期接手沿用 generation／timeMin／pageToken，舊 token no-op，僅 final page 清理未見 `inbound_origin` mapping 並保存 cursor。另新增 `task-reminder` durable job、transactional lifecycle、`taskVersion` fencing 與既有 due task backfill。Production 已套用 `0020_calendar_google_origin_baseline.sql` 並核對 checksum `542c90d30ef8c24d75dc87f5a408bd886ecb155388a058eaf9682498f55cebad`、v3 default 與 2＋5 個新欄位；功能旗標已校正並重新部署。Google Calendar 端建立且關閉 Google 自身通知的臨時行程，於 21:09 被增量匯入並排出 3 個 LINE job，提前一天 job 於 21:13 成為 done；臨時 due task 也由 backfill 排出 3 個 job，提前一天 job 於 21:15 成為 done。兩者 dead 都是 0，測試資料與未來 pending job 已清理為 0。
- **［已修復］transaction client 並行查詢的 pg 9 相容性風險**：Production 驗收在成功的 `/cron/reminders` 發現 node-postgres deprecation warning；`fc44828`（2026-07-29）將 Calendar／Tasks inbound enqueue、行程／任務 reminder scheduling 與天氣訂閱在同一 transaction client／executor 上的查詢改為逐筆 await，保留 claim＋enqueue 原子性、queued 計數、start job 與缺少 LINE target 的跳過語意。5 條 deferred-promise 回歸測試與獨立 code review 均通過；完整驗證為 80 suites／588 tests、lint、module-load、audit 0、diff check。部署 `dpl_5fcH7EW6nxUsmmzYMdyG4kpq3g6H` 後另以未來 due task 觸發 3 個 reminder job，Cron HTTP 200、0 dead，Vercel log 不再出現該警告，探針與 jobs 已清理。
- 本機以 Express 5 實際啟動 HTTP server，`GET /health/live` 回 `200 {"status":"OK"}`。GitHub CI 另成功建置 production image，啟動時不傳 `APP_PORT`，驗證預設 `3000`、HTTP liveness 與 Docker `healthy` 狀態。

## 交叉覆核（Claude，2026-07-18，`6.0.0-rc.3`）

由 Claude 對 Codex 的 rc.1–rc.3 改動做獨立覆核，證據如下：

- **重跑驗證，與上節宣稱一致**：`npm ci` 成功；`npm audit --audit-level=high` 0 vulnerabilities；`npx eslint .` 通過；`npm test` 70 suites／494 tests 全過；`npm run test:module-load` 原生 Node ESM 載入通過（本機 Node v25，符合 `engines >=24`）。
- **授權硬性邊界成立**：單一 root commit（`初始化`）後，`LICENSE` 仍保留原始 MIT 全文與 `Copyright (c) 2022 Memo Chou`；`NOTICE.md` 明文記載上游來源、授權義務與「公開 Git 歷史於 2026-07-18 重新初始化」。MIT 要求的是保留授權與版權聲明，不要求 git 歷史，合規。離線 refs bundle 不在 repo 內，Claude 無法獨立驗證，以上節維護者記錄為準。
- **rc.2／rc.3 程式抽查**：`buildCommandHelp` 與 `buildGeneralCommands` 依 feature flags 動態組裝且有 13 上限與 gating 回歸測試；`resolveLocale` 對未知 `APP_LANG` fail-fast 並列出可用值；OAuth 頁面 locale 化接線正確；`回報` 已指向本 repo issues；`LATEST_MIGRATION`（`0018`）與 migrations 目錄一致；`Dockerfile` 以 production deps＋非 root `node` 執行、`.dockerignore` 排除 `.git`／`.env`／tests／docs；README／CHANGELOG／REVIEW 版本敘述一致為 `6.0.0-rc.3`。
- **6.0 架構結論維持先前覆核**：durable-only fail-closed、`bot_sources`（HMAC key＋advisory lock＋RLS）、runtime preflight、Google provider contract、共用提醒排程與 claim/complete watermark 均正確；rc.1 覆核發現的兩個 5.12 bug（rrule ESM named export、原生 Date 週期 overflow）已修並有 CI 防回歸。

### 建議處理結果（Codex，`6.0.0-rc.4`）

1. **［已完成］容器 `APP_PORT` 預設**：`Dockerfile` 設 `APP_PORT=3000` 與 `EXPOSE 3000`；Compose `environment` 也用 `${APP_PORT:-3000}` 覆蓋空白／缺值，避免 container 啟動卻沒有 listener。
2. **［已完成］Docker healthcheck**：新增不依賴 Supabase、Google 或 GitHub 的 `GET /health/live`，image 以 Node 內建 `fetch` 執行 healthcheck；CI 實際 build／run image 並等待 `healthy`。需更正原建議：`restart: unless-stopped` 只在主程序退出時重啟，單靠 `unhealthy` 不會自動重啟；自動回收 unhealthy container 仍需 orchestrator／監控策略。
3. **［已完成］`bot-sources` 注入式測試隔離**：durable repository 已移除 `APP_ENV === 'test'` 與記憶體 Map；`Context`／`handleEvents` 接受明確 repository dependency，記憶體 adapter 只存在 `tests/helpers`。
4. **［已完成］major 升級**：Express `5.2.1`、Jest `30.4.x` 與 ESLint `10.7` flat config 已升級並通過全量測試。ESLint 直接採目前穩定 10，而非停在 9；Babel 維持 `babel-jest 30` 官方支援的 7.x，避免把非必要的 Babel 8 ESM-only 轉換混入同一批 runtime 遷移。

## Release Gate

- [x] 功能入口、天氣市縣追問與搜尋來源／建立行程草稿。
- [x] Calendar outbound 單筆、mapped timed inbound 修改與提醒重排去重。
- [x] Tasks outbound／inbound 標題、完成、重開與單筆去重。
- [x] 單事件只處理一次、每分鐘 Supabase Cron、到點提醒、暫停／恢復不補發。
- [x] rc.6 週期行程：`每天 23:00` 正確顯示當地鐘點與「重複：每天」，Google 建立單一 recurring series；第一次到點只送一次，並排出下一次 `lead60` 與到點 job。
- [x] `REMINDER_OFFSETS=60,1440`：Production 校正後，午夜行程於 23:01 收到一次「1 小時前」提醒；Supabase `lead60` job 為 done，到點 job 保持 pending。
- [x] `6.1.0` Google-origin／task reminder：非 BOT 建立的 Google 行程由 v3 incremental 匯入並在 LINE 收到提前一天提醒；due task backfill 同樣實際送達，兩者各 1 done、0 dead，提前一小時與到點 job 的 pending 狀態符合設計。
- [x] `0020` migration、Production Sensitive flags、每分鐘 Cron、Node 24 Vercel deployment、CI、CodeQL 與 code scanning alerts 已重驗；正式探針證明 transaction enqueue 序列化後無 pg warning，所有臨時驗收資料已清為 0。
- [x] 2026-08-08 LINE PC Google OAuth smoke：授權後單筆行程同步、Calendar bounded search、Supabase sync／status／reminder jobs、Vercel 0 個 5xx／timeout、精準 CTE 清理與 event／confirmation／jobs／pending orphan／window dead jobs 五欄歸零均已驗證。
- [x] rc.8 已套用 `0019` 並部署：23:39 系列模式 baseline、23:45 v2 sync token 增量輪詢都一次 done；觀察期間每分鐘 `/cron/reminders` 均為 HTTP 200，沒有新增 60 秒 timeout。
- [x] rc.11 LINE PC 桌面音訊閉環：語音句首同音字容錯已於 2026-07-22 以 `2cbef0d` 修復；正式部署後，音訊產生原始轉錄回顯與 2026-07-23 15:00 行程草稿，確認後 LINE 回覆同步成功，Google Calendar bounded search 只找到一筆對應事件。

所有 Release Gate 均已通過；`6.1.0` 已完成 Google Calendar／Tasks reminder 的 Production 閉環與相容性探針。

完整操作順序與回滾見 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)，驗收範圍與不支援項目見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
