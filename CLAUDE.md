# CLAUDE.md

Claude Code 在本專案工作時，先讀 [`AGENTS.md`](AGENTS.md)。**產品邊界、架構、文件分工與驗證規則都以 `AGENTS.md` 為準**；本檔只補 Claude 專屬工作方式，不複製專案規則。

- 以繁體中文回報修改、驗證與剩餘風險。
- 不把簡單任務擴寫成大型重構或文件工程。
- 涉及金鑰、webhook、durable queue、migration、Google sync 或 Production smoke 時，先讀相關實作與 `docs/DEVELOPMENT.md`，不要從 README 推測完整操作。
- 使用者部署／設定／操作／疑難排解的權威文件在 `SanHsien/gpt-ai-assistant-docs`；app repo 只更新真正受影響的 runtime／架構／決策文件。
- 未完成的 LINE／Google／Supabase／Vercel 實機驗證要明確標示，不能以工具限制或「應該可用」代替產品證據。
