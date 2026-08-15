---
name: gpt-ai-assistant
description: 維護 SanHsien/gpt-ai-assistant：自架 LINE × OpenAI 個人助理，含 Supabase durable runtime、Google Calendar／Tasks、行程、任務、提醒、搜尋、語音、圖片與天氣。
---

# GPT AI Assistant quick index

完整維護規則先讀 [`AGENTS.md`](AGENTS.md)。

## 何時使用

適用於：

- LINE event / command / Quick Reply 行為
- OpenAI chat、transcription、vision、image
- SerpAPI / URL summary / weather
- Supabase repositories、durable queue、jobs、reminders
- Google Calendar／Tasks OAuth、outbound / inbound sync contract
- DB migrations / preflight / rollback
- Vercel、Docker、CI、CodeQL、Dependabot

## 快速定位

- `api/index.js`：webhook / serverless 入口
- `app/`：events、context、handlers、commands
- `services/`：AI、LINE、Google、queue、reminders 等服務
- `repositories/`：Supabase data access
- `db/`：migrations / rollbacks
- `contracts/`：provider / sync 契約
- `config/index.js`：環境變數單一讀取點
- `.env.example`：可設定項清單
- `tests/`：Jest 回歸測試

## 文件來源

- 使用者安裝／部署／設定／操作／疑難排解：`SanHsien/gpt-ai-assistant-docs`
- runtime／架構／migration／contract／決策／release evidence：本 app repo
- 最新專案覆核：[`REVIEW.md`](REVIEW.md)
- 產品／Google contract：[`docs/ROADMAP.md`](docs/ROADMAP.md)
- 開發與 Production 驗證：[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- 決策：[`docs/DECISIONS.md`](docs/DECISIONS.md)
- 來源與授權：[`NOTICE.md`](NOTICE.md)

## 基本驗證

```bash
npm ci
npx eslint .
npm run test:module-load
npm test
```

依變更範圍再追加 migration、dependency policy 或 Production smoke。不要把版本號寫死在本技能檔；目前版本與正式發行以 `package.json`、tags 與 GitHub Releases 為準。
