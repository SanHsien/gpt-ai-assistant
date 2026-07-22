---
name: gpt-ai-assistant
description: 維護 SanHsien/gpt-ai-assistant。本專案是 LINE × OpenAI 個人助理：支援文字、生圖、影像理解、SerpAPI 搜尋、Supabase durable queue、Google Calendar／Tasks 雙向同步、行程、任務、提醒與天氣；目前穩定版為 6.0.0。serverless（Vercel 優先）部署、使用者自架自備金鑰，源自 memochou1993/gpt-ai-assistant（MIT）並獨立維護。
---

# gpt-ai-assistant

## 何時使用

使用者要維護 `SanHsien/gpt-ai-assistant`，或開發這個 LINE × OpenAI 助理：

- 修 bug、改良既有指令（talk / draw / search / schedule / Google Calendar / sum / analyze / translate / continue / retry / forget / report / version / deploy / doc…）。
- 擴充新的 LINE 指令或訊息處理。
- 調整 OpenAI / LINE / SerpAPI 串接與環境變數。
- 調整 Vercel（或本機）部署流程。
- 維護 Supabase migrations、每分鐘 worker、Google Calendar／Tasks OAuth 與同步契約。

## 不適用

- 未與維護者確認方向前，替換 AI 供應商（OpenAI → 其他）、引入 Anthropic SDK 或大改指令協定。
- 把金鑰／模型／webhook 值寫死進程式碼。
- 代管使用者對話、LINE user id 或任何個資。
- 宣稱 LINE / OpenAI 官方背書。

## 快速定位

- `README.md` / `README.en.md`：使用者入口、功能與部署（中文為主）。
- `REVIEW.md`：最新一次覆核與未驗證項。
- `NOTICE.md`：fork 來源與授權聲明。
- `AGENTS.md` / `CLAUDE.md`：AI 接手規則。
- `api/index.js`：webhook 入口。
- `app/`：事件 → context → handlers/commands。
- `config/index.js`：環境變數單一讀取點。
- `.env.example`：可設定項清單。
- `repositories/` / `db/`：Supabase data access、migrations 與 rollbacks。
- `docs/DEVELOPMENT.md`：架構、本機指令、部署。
- `docs/DECISIONS.md`：決策紀錄。

## 完成回報

回報時列出：

- 修改了哪些檔案。
- 是否改到指令協定、OpenAI/LINE/SerpAPI 串接、環境變數或部署流程。
- 執行過哪些驗證（lint / test / 本機實打 webhook）。
- 是否碰觸已核准的 [`docs/ROADMAP.md`](docs/ROADMAP.md)；有無跳過 durable storage / queue / scheduler 前置條件，或涉及仍需維護者拍板的候選方向。
