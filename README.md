# GPT AI Assistant

[![Release](https://img.shields.io/github/v/release/SanHsien/gpt-ai-assistant?sort=semver)](https://github.com/SanHsien/gpt-ai-assistant/releases/latest)
[![CI](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[繁體中文](README.md) · [English](README.en.md) · [完整文件站](https://sanhsien.github.io/gpt-ai-assistant-docs/) · [Latest Release](https://github.com/SanHsien/gpt-ai-assistant/releases/latest)

**GPT AI Assistant** 是一個可自架的 **LINE 個人 AI 助理**。你用自己的 LINE、OpenAI 與 Supabase 設定部署後，就能直接在 LINE 裡聊天、傳語音或圖片、搜尋資料、管理行程與任務、接收提醒與查天氣。

它不是另一個聊天介面殼，而是一個以 **LINE 為前端、durable queue 為可靠性核心** 的個人助理服務：付費 AI 工作與 LINE 送達分開 checkpoint，行程、任務與提醒有持久化狀態，Google Calendar／Tasks 可選擇整合。

> **部署、環境變數、Google OAuth、操作教學與疑難排解以 [文件站](https://sanhsien.github.io/gpt-ai-assistant-docs/) 為準。** 本 repo 的 `docs/` 主要保存 runtime、架構、資料契約、migration、技術決策與發行實作。

## 適合誰

- 想在 **LINE** 裡使用自己的 AI 助理，而不是再安裝一個聊天 App。
- 願意自行部署，並使用自己的 OpenAI／LINE／Supabase 憑證與帳單。
- 需要的不只是聊天，還包括**行程、任務、提醒、搜尋、語音、圖片與天氣**。
- 重視 serverless 環境下的 webhook 防重送、持久化 queue、重試與資料邊界。

目前正式支援重點是 **繁體中文 (`zh_TW`) + LINE + OpenAI**。英文與日文介面可啟動，但自然語言日期、天氣格式與部分意圖辨識仍以繁體中文為主要驗收基準。

## 核心能力

| 類別 | 能做什麼 |
| --- | --- |
| AI 對話 | 連續聊天、續寫、重試、忘記脈絡；模型可由環境變數設定 |
| 語音與圖片 | LINE 語音／常見音訊檔轉錄、圖片理解、GPT Image 生圖 |
| 搜尋與網址 | SerpAPI 搜尋；可選 SSRF-safe 網址摘要；搜尋結果附來源連結 |
| 行程 | 自然語言建立／修改／完成／刪除行程、衝突提示、週期行程、LINE 提醒 |
| Google Calendar | 授權後可做 outbound CRUD；支援 primary calendar 中安全範圍的 timed non-recurring inbound 同步 |
| 任務 | Supabase 待辦、期限／優先度／標籤／篩選、完成／重開／刪除與到期提醒 |
| Google Tasks | 可選 outbound/inbound 狀態同步；精確 due 仍以本地資料為準 |
| 天氣 | Open-Meteo 現況／預報與可選每日天氣推播，免額外天氣 API key |
| LINE UX | Feature-aware Quick Reply、確認卡、postback 操作、安靜時段與提醒暫停／恢復 |

可用 feature flags 個別關閉較高成本或非必要功能，例如生圖、語音、vision、搜尋、任務、天氣、Google Calendar／Tasks 等。完整旗標與預設值請看 [文件站](https://sanhsien.github.io/gpt-ai-assistant-docs/) 與 [`.env.example`](.env.example)。

## 使用體驗

在 LINE 裡可以直接輸入自然語句，例如：

```text
明天下午三點牙醫回診
新增任務 重要 明天交報告 #工作
天氣 台北
搜尋 本週 OpenAI 重要消息
```

建立行程時，時間資訊不足會先追問；完整草稿確認後才寫入。Google 同步失敗時會保留本地資料並提供重試／暫不處理／刪除選項，不會因外部服務暫時失敗就直接丟失使用者資料。

LINE 語音訊息或支援的音訊附件會先轉錄，再走與文字相同的輸入流程；建立行程時會回顯轉錄內容，方便辨識「聽錯」與「解析錯」。

## 可靠性與資料邊界

這個專案的工程重點不只在 AI 回答，而在 serverless 環境下避免重複計費、重複訊息與狀態遺失：

- webhook 先做 durable preflight 與冪等寫入；必要設定、DB 或 migration 異常時 fail closed，讓 LINE redelivery。
- 「AI 已完成」與「LINE 已送達」是不同 checkpoint；送達重試不重新執行已完成的付費 AI 工作。
- queue payload 以加密方式保存；使用者／群組狀態使用 deployment-scoped HMAC key，不保存原始 LINE user id 或名稱。
- 一般對話內容不作為長期個資資料庫保存；需要持久化的是結構化狀態、工作與必要運維資訊。
- Google Calendar／Tasks 僅在使用者完成 OAuth 授權後操作其授權範圍。

完整 runtime、安全與資料契約請看 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)、[`docs/DECISIONS.md`](docs/DECISIONS.md) 與 [`REVIEW.md`](REVIEW.md)。

## Google 整合邊界

目前 Calendar 支援 bot 建立／管理的 outbound 行程，以及 primary calendar 中**未來、單次、有時刻**的安全範圍 inbound 同步。以下仍刻意不納入完整同步契約：

- Calendar 全天事件 inbound
- recurring series / exception inbound
- 非 primary calendar 匯入
- Google Tasks due-date inbound 回收

這些限制是明確產品邊界，不代表一般 LINE 行程／任務功能失效。詳細 contract 見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 快速開始

### 1. 準備服務

基本部署需要：

- LINE Messaging API channel
- OpenAI API key
- Supabase Postgres
- Node.js 24
- Vercel（建議）或可執行 Node/Docker 的環境

搜尋、Google Calendar／Tasks、生圖 Blob 等功能各有額外設定。

### 2. 安裝與檢查

```bash
git clone https://github.com/SanHsien/gpt-ai-assistant.git
cd gpt-ai-assistant
npm ci
cp .env.example .env
npm run db:migrate
npm run db:preflight
```

### 3. 部署並設定 LINE webhook

部署後，把 LINE channel 的 Webhook URL 指向：

```text
https://YOUR_HOST/webhook
```

正式上線前還需要確認 Supabase migrations、Cron、Production Sensitive env，以及你實際啟用功能所需的 API／OAuth。**不要只照 README 猜設定**；請依 [完整部署文件](https://sanhsien.github.io/gpt-ai-assistant-docs/) 的順序操作。

## 本機開發

```bash
npm ci
cp .env.example .env
npm run dev
npx eslint .
npm run test:module-load
npm test
```

LINE webhook 需要可從 Internet 抵達的 HTTPS URL；本機開發可透過 ngrok、cloudflared 或同類 tunnel 暴露測試端點。

CI 另外會建立 production Docker image，啟動容器並驗證 `/health/live` 與 image healthcheck。

## 架構概覽

```text
LINE
  │ webhook
  ▼
api/index.js
  │ preflight / durable enqueue / idempotency
  ▼
Supabase-backed jobs
  │
  ├── OpenAI ── chat / transcription / vision / image
  ├── SerpAPI ── search
  ├── Google ── Calendar / Tasks
  └── Open-Meteo ── weather
  │
  ▼
LINE delivery checkpoint
```

主要程式位置：

- `api/`：HTTP / serverless 入口
- `app/`：LINE event、context、handlers / commands
- `services/`：AI、LINE、Google、queue、reminders 等服務
- `repositories/`：Supabase data access
- `db/`：migrations / rollbacks
- `config/index.js`：環境變數單一讀取點
- `tests/`：Jest 回歸測試

## 文件分工

### 使用者文件

- [完整文件站（繁中）](https://sanhsien.github.io/gpt-ai-assistant-docs/)
- [English docs](https://sanhsien.github.io/gpt-ai-assistant-docs/en/)
- [`SanHsien/gpt-ai-assistant-docs`](https://github.com/SanHsien/gpt-ai-assistant-docs)：安裝、部署、設定、使用方式與疑難排解的 source of truth

### 本 repo 維護文件

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)：runtime 架構、開發、部署實作與驗證
- [`docs/ROADMAP.md`](docs/ROADMAP.md)：產品邊界、資料／Google contract 與後續方向
- [`docs/DECISIONS.md`](docs/DECISIONS.md)：技術與產品決策
- [`REVIEW.md`](REVIEW.md)：最新 evidence-based 專案覆核與未驗證項
- [`CHANGELOG.md`](CHANGELOG.md)：版本歷史
- [`NOTICE.md`](NOTICE.md)：來源、attribution 與第三方聲明

## 專案方向

GPT AI Assistant 維持以下核心：

- **LINE 是唯一主要使用介面**，不抽象成多頻道平台。
- **OpenAI 是預設 AI provider**，使用者自備 API key。
- **自架與可驗證的 durable runtime** 優先於增加更多聊天花樣。
- Google Calendar／Tasks 是個人助理整合，不擴張成多人協作或企業工作流平台。

完整已完成／不做項目與未來規劃見 [`docs/ROADMAP.md`](docs/ROADMAP.md)，不再在 README 重複維護一份平行 roadmap。

## 專案來源與授權

本專案衍生自 [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant)，保留原始 MIT 授權與 attribution，現由 SanHsien 獨立維護。詳細來源與第三方聲明見 [`NOTICE.md`](NOTICE.md)。

程式碼採 [MIT License](LICENSE)。本專案不代表 LINE、OpenAI、Google、Supabase、Vercel 或其他服務官方背書。
