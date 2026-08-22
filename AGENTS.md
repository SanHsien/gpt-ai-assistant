# AGENTS.md

本檔是 **SanHsien/gpt-ai-assistant** 的 AI coding agent 主要維護規則。Claude 專屬薄入口見 [`CLAUDE.md`](CLAUDE.md)，快速索引見 [`SKILL.md`](SKILL.md)；衝突時以本檔為準。

## 專案定位

**GPT AI Assistant** 是可自架的 LINE 個人助理。LINE 是主要使用介面，OpenAI 是預設 AI provider；Supabase 提供 durable runtime，Google Calendar／Tasks、SerpAPI、Open-Meteo 等依功能設定整合。

本專案衍生自 [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant)，保留 MIT License 與 attribution，現由 SanHsien 獨立維護。

## 硬性產品邊界

- **LINE-first**：不要為了抽象化而改造成多頻道平台。
- **OpenAI-default**：未有明確產品決策前，不替換預設 AI provider，也不直接引入其他 provider SDK。
- **Self-hosted / BYO keys**：憑證、模型、webhook、資料庫與第三方服務設定一律走環境變數，不寫死個人值。
- 不提交 API key、token、`.env`、LINE secret、OpenAI／SerpAPI／Google／Supabase 憑證或任何私密資料。
- 不移除上游 MIT／attribution；來源與第三方聲明以 [`NOTICE.md`](NOTICE.md) 為準。
- 不宣稱 LINE、OpenAI、Google、Supabase、Vercel 或其他服務官方背書。
- 保留 durable queue、webhook idempotency、delivery checkpoint、migration preflight 與 fail-closed 原則；不要為了簡化流程退回 process-memory 或 fail-open runtime。
- 不新增不必要的原始 LINE user id、名稱或長期對話內容保存。既有 HMAC identifier、加密 job payload 與結構化持久狀態的邊界不可在未評估下放寬。
- Google Calendar／Tasks 的支援範圍以既有 contract 為準；不要把尚未支援的 all-day／recurrence inbound、非 primary 匯入或 Tasks due reclaim 當成已完成能力。

## 架構地圖

- `api/`：HTTP / Vercel serverless 入口、webhook
- `app/`：LINE event → context → handlers / commands
- `services/`：OpenAI、LINE、Google、queue、reminders、weather、search 等服務
- `repositories/`：Supabase data access
- `db/`：migrations / rollbacks
- `contracts/`：跨服務契約與能力邊界
- `config/index.js`：環境變數單一讀取點
- `tests/`：Jest 回歸測試
- `tools/`：依賴 freshness / Dependabot policy 等維護工具

## 開發原則

- 一般變更走 **branch → PR → CI → merge**，不要直接在 `main` 上堆工作。
- 改行為前先讀 `config/index.js` 與相關 service / repository / contract，確認 feature flag、預設值與 durable 路徑。
- 新增 LINE 指令時沿用既有 `handlers/` + `commands/` 模式；不要另建平行 command framework。
- 會造成付費 API 呼叫的流程要維持「運算完成」與「LINE 送達」分離，重試不得無意重跑付費工作。
- 資料寫入、queue claim、Google sync、reminder lifecycle 等一致性修改要優先補 repository / service 級回歸測試。
- 修改 migration 時，保留 forward migration、preflight 與 rollback 的一致性，不改寫已發布 migration 的歷史語意。
- 不為了「更完整」主動增加新的 governance workflow；目前 CI、CodeQL、Dependabot 與 dependency-freshness 已足夠。
- 純文件／維護規則整理不需要機械式 bump 版本。
- **合併任何 PR 前先讀 diff**（包含 Dependabot 開的）：`gh pr diff <編號>`。CI 綠燈證明的是「測試沒紅」，不是「改了什麼、該不該進 main」——lockfile 的連鎖升級、transitive major、跨出宣告範圍的變更，只有讀 diff 看得到。核准或合併訊息要寫出讀到什麼、為什麼可接受。`dependabot-merge.yml` 依政策自動核准的低風險類別是唯一例外——那條路徑的把關是分類器與必要 checks；只要是人或 agent 手動按下 merge，就適用本條。

## 文件 source of truth

### 使用者文件：`SanHsien/gpt-ai-assistant-docs`

獨立文件 repo 是以下內容的權威來源：

- 安裝
- 部署
- 環境變數與第三方服務設定
- Google OAuth 操作
- 使用方式
- 疑難排解

本 repo 的 README 只做產品入口與必要快速開始，不複製完整使用者手冊。

### 本 app repo

本 repo 是以下內容的權威來源：

- runtime 行為與程式契約
- API / provider contract
- DB migrations / rollbacks
- 架構與開發流程
- 技術決策
- release implementation / evidence

文件分工：

- `README.md` / `README.en.md`：產品入口、能力與必要安全／部署摘要
- `docs/DEVELOPMENT.md`：runtime 架構、開發、部署實作與驗證
- `docs/ROADMAP.md`：產品範圍、Google contract、未來與明確不做
- `docs/DECISIONS.md`：耐久性技術／產品決策
- `REVIEW.md`：最新 evidence-based 覆核與未驗證項
- `CHANGELOG.md`：正式版本歷史
- `NOTICE.md`：來源、授權與第三方聲明

只更新**真正受此次變更影響**的文件；不要要求每次 commit 都同步 README、ROADMAP、REVIEW、CHANGELOG、DECISIONS 與文件站全套。

### REVIEW.md 規則

`REVIEW.md` 是最新覆核快照，不是每個 bug 的強制流水帳。

- 若此次工作直接修復 `REVIEW.md` 已追蹤的問題，更新對應狀態與證據。
- 若新發現的問題會實質改變目前風險／驗證結論，更新 `REVIEW.md`。
- 一般 bug fix 若已有測試、PR 與 CHANGELOG／commit evidence，**不因規則本身而新增 REVIEW bookkeeping**。

## 驗證

一般程式變更至少執行：

```bash
npm ci
npx eslint .
npm run test:module-load
npm test
```

CI 另外會：

- 建立 production Docker image
- 啟動容器
- 驗證 `/health/live`
- 驗證 image healthcheck

依變更範圍追加：

- migration / durable runtime：`npm run db:migrate`、`npm run db:preflight` 與對應 migration/repository tests
- dependency policy：`npm run check:dependencies` / `npm run check:dependabot-policy`
- Production LINE / Google / Supabase / Vercel 實機流程：先讀 `docs/DEVELOPMENT.md` 的正式驗收 runbook，且未完成的外部驗證要明確標示，不得用「應該可用」代替證據

## 完成條件

提交前確認：

1. 沒有突破 LINE-first、OpenAI-default、自架／BYO keys 與 durable runtime 邊界。
2. 相關測試、lint、module-load 或 runtime preflight 已按變更範圍通過。
3. 沒有秘密、個資、production token 或測試殘留進 repo。
4. 只更新必要文件；使用者部署／操作細節若有變更，同步到 `gpt-ai-assistant-docs` 的權威頁面。
5. PR 清楚列出使用者可見影響、資料／同步風險、驗證結果與未驗證範圍。
