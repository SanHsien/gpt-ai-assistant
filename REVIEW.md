# 專案覆核

最後覆核：2026-07-18，目標版本 `6.0.0-rc.3`。

## 結論

6.0 的程式收斂與 RC 維護基線已完成，可進集中實機驗收，但目前只能標為 release candidate，不能宣稱正式 `6.0.0` 已通過。

本次移除 serverless process-memory 去重、同步 fail-open 與 Vercel env storage。所有 webhook 必須先通過 runtime preflight 並原子寫入 Postgres；缺事件 ID、DB／migration 異常或必要金鑰缺失時回 `5xx`，讓 LINE redelivery。`bot_sources` 使用 HMAC key 與交易鎖保存 user/group 啟停狀態及原子配額，並啟用 RLS、不提供 client policy；不落地原始 LINE id、名稱或對話。

Google Calendar／Tasks 的 scopes、能力矩陣與 inbound 衝突政策已收斂為共用 contract。Calendar mapped timed non-recurring inbound 與 Tasks mapped inbound/outbound 在契約內；全天 inbound、recurrence exception、Google-origin 建立及 Tasks due 回收仍明確不支援。RC.3 另補齊 Google OAuth locale、Node 24／Docker／Compose 基線、相容依賴與獨立 repo 的問題回報入口。

## 驗證

- `npm ci`：成功；`npm audit --audit-level=high`：0 vulnerabilities。
- `npx eslint .`：通過；`npm run test:module-load`：原生 Node ESM 載入通過。
- `npm test -- --runInBand`：70 suites、494 tests 全部通過；新增 Google OAuth 頁面依 `APP_LANG` 顯示與英／日 locale 回歸，既有 durable／Quick Reply／完整 `指令`／Google contract 測試全數保留。
- 聚焦覆蓋：durable-only webhook fail-closed、runtime migration/config preflight、bot source 原子上限與啟停、同使用者事件順序，以及 Google provider scopes／衝突／不支援能力。
- 單一 root 初始化前已建立包含全部 refs 的離線 bundle 並通過 `git bundle verify`；bundle 未提交至 repo。初始化後 `main` 只包含由 SanHsien 署名、訊息為「初始化」的一筆 root commit，Contributors API 只列 SanHsien。
- GitHub CI、CodeQL 與文件站 Pages 均成功；CodeQL 與 secret scanning open alerts 都是 0。
- 文件站本機 build 通過，13 頁共檢查 362 個內部連結；Production 首頁與主要設定頁 HTTP 200。
- Production `SERPAPI_API_KEY` 已設為 Vercel Sensitive env，值未進聊天、log 或 Git；Production Supabase 已套用 `0018_durable_sources.sql` 且 `bot_sources` RLS 已啟用。
- 單一 root force-push 後的 Vercel Production 為 `READY`、Node `24.x`；穩定網域實測回 `200`、`status: OK`，`currentVersion`／`latestVersion` 均為 `6.0.0-rc.3`。先前 `5.13.0` ↔ RC promote／rollback 往返仍是已通過基線。
- 本機沒有 Docker CLI，因此未執行 image build；Dockerfile／Compose 已由 eslint 以外的靜態 diff 覆核，正式 container 使用者仍需依文件執行 `docker compose up --build` smoke test。

## 交叉覆核（Claude，2026-07-18，`6.0.0-rc.3`）

由 Claude 對 Codex 的 rc.1–rc.3 改動做獨立覆核，證據如下：

- **重跑驗證，與上節宣稱一致**：`npm ci` 成功；`npm audit --audit-level=high` 0 vulnerabilities；`npx eslint .` 通過；`npm test` 70 suites／494 tests 全過；`npm run test:module-load` 原生 Node ESM 載入通過（本機 Node v25，符合 `engines >=24`）。
- **授權硬性邊界成立**：單一 root commit（`初始化`）後，`LICENSE` 仍保留原始 MIT 全文與 `Copyright (c) 2022 Memo Chou`；`NOTICE.md` 明文記載上游來源、授權義務與「公開 Git 歷史於 2026-07-18 重新初始化」。MIT 要求的是保留授權與版權聲明，不要求 git 歷史，合規。離線 refs bundle 不在 repo 內，Claude 無法獨立驗證，以上節維護者記錄為準。
- **rc.2／rc.3 程式抽查**：`buildCommandHelp` 與 `buildGeneralCommands` 依 feature flags 動態組裝且有 13 上限與 gating 回歸測試；`resolveLocale` 對未知 `APP_LANG` fail-fast 並列出可用值；OAuth 頁面 locale 化接線正確；`回報` 已指向本 repo issues；`LATEST_MIGRATION`（`0018`）與 migrations 目錄一致；`Dockerfile` 以 production deps＋非 root `node` 執行、`.dockerignore` 排除 `.git`／`.env`／tests／docs；README／CHANGELOG／REVIEW 版本敘述一致為 `6.0.0-rc.3`。
- **6.0 架構結論維持先前覆核**：durable-only fail-closed、`bot_sources`（HMAC key＋advisory lock＋RLS）、runtime preflight、Google provider contract、共用提醒排程與 claim/complete watermark 均正確；rc.1 覆核發現的兩個 5.12 bug（rrule ESM named export、原生 Date 週期 overflow）已修並有 CI 防回歸。

### 建議（不阻擋 RC，正式 6.0.0 前後酌辦）

1. **［低］容器 `APP_PORT` 預設**：app 只在 `APP_PORT` 有值時 `listen`（`config` 預設 `null`）；`.env` 漏設時容器會啟動卻不聽任何 port 且無錯誤訊息。建議 `Dockerfile` 加 `ENV APP_PORT=3000`（或 compose `environment` fallback）讓容器路徑 fail-safe。`.env.example` 已含 `APP_PORT=3000`，照文件走不會踩到。
2. **［低］Docker healthcheck**：根路由已是 status 端點，可在 Dockerfile／Compose 加 healthcheck，讓 `restart: unless-stopped` 能偵測 hang 而重啟；建議與正式 6.0.0 的 `docker compose up --build` smoke test（上節已列，維護者環境目前無 Docker CLI）一併完成。
3. **［資訊］`bot-sources` 的 test-mode 分支**：`APP_ENV === 'test'` 走記憶體 Map 是 production 程式內含測試分支的務實作法，現階段可接受；若日後此模組再擴充，建議改為注入式儲存以分離測試路徑。
4. **［資訊］major 升級延後正確**：Express 5、Jest 30、Babel 8、ESLint flat-config 留在 6.x 後續、不混入 RC——同意此判斷，RC 應維持最小變因。

## Release Gate

1. 依集中清單完成真實 LINE + Supabase + Google 驗收：一般對話與搜尋建行程、單事件只處理一次、Calendar outbound/inbound、Tasks outbound/inbound、語音行程、多重與週期提醒、安靜／暫停時段、天氣市縣與搜尋來源。
2. 以上通過後，才把 package/release/docs 由 `6.0.0-rc.3` 提升為正式 `6.0.0`。

完整操作順序與回滾見 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)，驗收範圍與不支援項目見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
