# AGENTS.md

給 Codex 與其他 AI coding agents 在本專案工作時的指引。Claude Code 專屬補充見 [`CLAUDE.md`](CLAUDE.md)，兩者主要規則一致。

## 專案宗旨

`gpt-ai-assistant` 是一個 LINE 個人助理：透過 LINE Messaging API 收訊息，串接 OpenAI API 產生文字回覆、GPT Image 生圖與影像理解，並可經 SerpAPI 搜尋、Supabase 保存 durable 狀態及 Google Calendar 管理行程。以 serverless（Vercel 優先）方式部署，使用者自架、自備 API key 與 LINE channel。

本 repo 源自 [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant)（MIT），現為獨立維護 repository。

## 本專案的方向

- **核心不變**：保留 OpenAI + LINE、自架、自備 API key；不整套重寫，也不任意更換預設供應商。
- **已核准方向**：`5.0.0` 已完成 M1 真實 LINE 閉環；`6.0.0-rc.3` 收斂為 Supabase durable-only runtime、固定 queue、migration preflight、Google provider contract、最多 13 個 feature-aware LINE 快捷入口、完整 `指令` 清單與可維護的 Node 24 runtime。正式 `6.0.0` 須通過集中 LINE／Google 驗收。進階能力仍不可跳過 scheduler、delivery idempotency、recurrence round-trip 與衝突政策各自堆疊。
- 模型／API、fermi、參考專案與授權邊界也統一維護在 [`docs/ROADMAP.md`](docs/ROADMAP.md)；不要直接合併 fermi 原始碼。
- 未來可能的 Claude 版助理仍是候選，可能開新專案或在此 repo 分支，方式待定。
- **已排除方向**：不要嘗試用 OpenAI / ChatGPT 訂閱 OAuth 取代 API key；官方目前將 ChatGPT 訂閱與 API usage 分開計費與管理，Codex 的 ChatGPT sign-in 也不是第三方 server-side bot 可用的 API OAuth。
- **授權策略**：目前維持 MIT，不立即轉 FSL-1.1-MIT；直接併入 FSL / GPL / 未授權專案原始碼前先看 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
- 不要把 OpenAI 換成其他預設供應商、不要引入 Anthropic SDK、不要動搖「使用者自架、自備金鑰」的本質。

## 硬性邊界

- 不提交 API key、token、`.env` / `.env.*`、LINE channel secret、OpenAI/SerpAPI 金鑰或任何私密憑證。
- 不移除 MIT 授權與對 `memochou1993/gpt-ai-assistant` 的 attribution；見 [`NOTICE.md`](NOTICE.md)。
- 不把預設模型／金鑰／webhook 路徑寫死成特定人的值；一律走環境變數（見 `config/index.js` 與 `.env.example`）。
- 不宣稱本專案為 LINE、OpenAI 或任何服務官方或背書。
- 不在未確認方向前，替換 AI 供應商或大改指令協定。
- 不把使用者對話內容、LINE user id 等個資落地或外傳。

## 架構速覽

```text
LINE 使用者 ──▶ LINE Messaging API ──▶ webhook（Vercel serverless / 本機 Express）
                                              │
                                     api/index.js（入口）
                                              │
                                     app/（事件 → context → handlers/commands）
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        ▼                      ▼                     ▼
                   OpenAI API       SerpAPI       Supabase / Google Calendar
              （completion/image/vision）              │
                                                       ▼
                                                   LINE reply
```

- `api/index.js`：serverless / server 入口，掛 webhook。
- `app/`：事件處理核心——`app.js` 收 LINE events，`context.js` 建 context，`handlers/` 與 `commands/` 實作各指令（talk / draw / search / sum / analyze / translate / continue / retry / forget / report / version / deploy / doc…）。
- `config/index.js`：所有環境變數的單一讀取點（凍結物件）。
- `utils/`、`services/`（OpenAI / LINE / SerpAPI / Google Calendar / queue）、`repositories/`（Supabase data access）、`app/models/`（bot / event / context 模型）。

## 開發原則

- 改行為前先讀 `config/index.js`，確認相關開關與預設值。
- 新增指令依現有 `handlers/` + `commands/` 模式擴充，別另立平行架構。
- 動到金鑰、webhook、部署流程時，同步更新 `.env.example` 與 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
- 使用繁體中文回覆與撰寫維護文件；程式碼、變數、commit message 維持英文。
- 面向使用者的說明改 README（中文版為主）；架構與部署細節進 `docs/DEVELOPMENT.md`；重要取捨進 `docs/DECISIONS.md`。

## 驗證方向

改動後至少確認：

```bash
npm ci
npx eslint .      # eslint（airbnb config；無 npm script，直接跑）
npm test          # jest
```

必要時本機起服務手動打 webhook：

```bash
npm run dev       # nodemon api/index.js
```

不接受「應該可以」——面向行為的改動要用 lint + test 或本機實跑佐證。

## 文件入口

- [`README.md`](README.md) / [`README.en.md`](README.en.md)：使用者入口、功能與部署（中文為主）。
- [`REVIEW.md`](REVIEW.md)：最新一次 evidence-based 專案覆核、release gate 與未驗證項（只留最新版）。
- [`docs/ROADMAP.md`](docs/ROADMAP.md)：產品階段、Phase 狀態、模型／API、參考架構與授權邊界。
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)：架構、本機指令、環境變數、部署（Vercel 優先）。
- [`docs/DECISIONS.md`](docs/DECISIONS.md)：決策紀錄。
- [`NOTICE.md`](NOTICE.md)：上游來源、MIT 授權與第三方聲明。
- [`CHANGELOG.md`](CHANGELOG.md)：版本變更（沿用上游格式）。
