# CLAUDE.md

Claude Code 在本專案工作時的指引。**專案定位、維護方向、硬性邊界、架構速覽、常用位置與驗證方向的唯一真相源是 [`AGENTS.md`](AGENTS.md)**——先讀它，本檔只補 Claude 專屬要點，不重複規則。

## 回覆要求

- 使用繁體中文，先講修改、驗證、剩餘事項。
- 不要把簡單任務寫成冗長架構分析。
- 動到金鑰／webhook／部署流程時，同步更新 `.env.example` 與 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

## 文件同步

新增／改動功能後，同步對應文件（各主題單一真相源）：使用者說明 [`README.md`](README.md)／[`README.en.md`](README.en.md)、最新覆核與未驗證項 [`REVIEW.md`](REVIEW.md)、變更 [`CHANGELOG.md`](CHANGELOG.md)、Phase 狀態與範疇 [`docs/ROADMAP.md`](docs/ROADMAP.md)、決策理由 [`docs/DECISIONS.md`](docs/DECISIONS.md)、授權與參考專案 [`NOTICE.md`](NOTICE.md)。文件站（另一 repo `gpt-ai-assistant-docs`，中英）在版本／功能敘述變動時一併更新。
