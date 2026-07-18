# 專案覆核

最後覆核：2026-07-18，目標版本 `6.0.0-rc.4`。

## 結論

6.0 的程式收斂與 RC 維護基線已完成，可進集中實機驗收，但目前只能標為 release candidate，不能宣稱正式 `6.0.0` 已通過。

本次移除 serverless process-memory 去重、同步 fail-open 與 Vercel env storage。所有 webhook 必須先通過 runtime preflight 並原子寫入 Postgres；缺事件 ID、DB／migration 異常或必要金鑰缺失時回 `5xx`，讓 LINE redelivery。`bot_sources` 使用 HMAC key 與交易鎖保存 user/group 啟停狀態及原子配額，並啟用 RLS、不提供 client policy；不落地原始 LINE id、名稱或對話。

Google Calendar／Tasks 的 scopes、能力矩陣與 inbound 衝突政策已收斂為共用 contract。Calendar mapped timed non-recurring inbound 與 Tasks mapped inbound/outbound 在契約內；全天 inbound、recurrence exception、Google-origin 建立及 Tasks due 回收仍明確不支援。RC.4 再完成 Express 5、Jest 30、ESLint 10 flat config、注入式 bot source repository，以及容器 port／liveness fail-safe。

## 驗證

- `npm ci`：成功；`npm audit --audit-level=high`：0 vulnerabilities。
- `npx eslint .`：通過；`npm run test:module-load`：原生 Node ESM 載入通過。
- `npm test -- --runInBand`：71 suites、497 tests 全部通過；新增記憶體 bot-source adapter 契約與 `/health/live` 回歸，既有 durable／Quick Reply／完整 `指令`／Google contract 測試全數保留。
- 聚焦覆蓋：durable-only webhook fail-closed、runtime migration/config preflight、bot source 原子上限與啟停、同使用者事件順序，以及 Google provider scopes／衝突／不支援能力。
- 單一 root 初始化前已建立包含全部 refs 的離線 bundle 並通過 `git bundle verify`；bundle 未提交至 repo。初始化後 `main` 只包含由 SanHsien 署名、訊息為「初始化」的一筆 root commit，Contributors API 只列 SanHsien。
- GitHub CI、CodeQL 與文件站 Pages 均成功；CodeQL 與 secret scanning open alerts 都是 0。
- 文件站本機 build 通過，13 頁共檢查 362 個內部連結；Production 首頁與主要設定頁 HTTP 200。
- Production `SERPAPI_API_KEY` 已設為 Vercel Sensitive env，值未進聊天、log 或 Git；Production Supabase 已套用 `0018_durable_sources.sql` 且 `bot_sources` RLS 已啟用。
- RC.3 Production 曾驗證為 `READY`、Node `24.x`，穩定網域回 `200`／`status: OK`；先前 `5.13.0` ↔ RC promote／rollback 往返仍是已通過基線。RC.4 推送後須重驗相同 production health。
- 本機以 Express 5 實際啟動 HTTP server，`GET /health/live` 回 `200 {"status":"OK"}`。CI 另建置 production image，啟動時不傳 `APP_PORT`，驗證預設 `3000`、HTTP liveness 與 Docker `healthy` 狀態。

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

1. 依集中清單完成真實 LINE + Supabase + Google 驗收：一般對話與搜尋建行程、單事件只處理一次、Calendar outbound/inbound、Tasks outbound/inbound、語音行程、多重與週期提醒、安靜／暫停時段、天氣市縣與搜尋來源。
2. 以上通過後，才把 package/release/docs 由 `6.0.0-rc.4` 提升為正式 `6.0.0`。

完整操作順序與回滾見 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)，驗收範圍與不支援項目見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
