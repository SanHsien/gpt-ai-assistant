# NOTICE

gpt-ai-assistant（SanHsien independently maintained edition）
Copyright 2026 SanHsien

本專案源自 [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant)，原專案採 MIT License 授權；解除 GitHub fork 關係不改變此來源與授權義務。

原始作品：

- Project: `gpt-ai-assistant`
- Author: `Memo Chou`（memochou1993）
- License: MIT
- Original copyright notice: `Copyright (c) 2022 Memo Chou`

本 repo 保留原始 MIT license 於 [`LICENSE`](LICENSE)。衍生版本的修改、文件與專案專屬變更由 SanHsien 維護，另有註明者除外。

目前本 repo 維持 MIT，不轉為 FSL-1.1-MIT。MIT / FSL-1.1-MIT 的差異、未來轉標條件，以及 fermi 合併邊界見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## License Notes

MIT License 允許使用、複製、修改、合併、發布、散布、再授權與商業使用，前提是所有副本或重要部分都保留原始著作權聲明與授權聲明。

再散布本專案或其重要部分時：

- 保留 [`LICENSE`](LICENSE) 的原始 MIT 全文。
- 保留對 `memochou1993/gpt-ai-assistant` 的 attribution。
- 若新加入的第三方套件、字型、圖示、圖片或生成素材其授權有要求，另外標註其 attribution。

## Project Scope

`gpt-ai-assistant` 是一個 LINE 聊天機器人：透過 LINE Messaging API 接收訊息，串接 OpenAI API 產生回覆、生圖與影像理解，並可經 SerpAPI 做網路搜尋。以 serverless（Vercel 優先）方式部署，使用者用自己的 API key 與 LINE channel 自架。

本專案目前定位：**維持 OpenAI + LINE、自架、自備金鑰，並分階段演進為個人助理**。行程、任務、提醒、日曆、天氣、搜尋與分享依 [`docs/ROADMAP.md`](docs/ROADMAP.md) 推進；Toki（前身 Dola）僅作公開產品行為參考，未使用其程式碼、品牌、文案或素材。fermi 僅作可靠性與持久化架構參考，不合併其 FSL 原始碼。未來可能的 Claude 版助理仍待定。OpenAI / ChatGPT 訂閱 OAuth 已評估為不適合此 repo 取代 API key。

## Upstream 後續專案

原作者於 2026-06-08 的上游 commit [`d84c806`](https://github.com/memochou1993/gpt-ai-assistant/commit/d84c806b8368ded9d790067235827cdac32a23ab) 將過時的 News 區塊改為接班專案 [`memochou1993/fermi`](https://github.com/memochou1993/fermi) 的指引；本專案的來源脈絡包含該上游版本，公開 Git 歷史則於 2026-07-18 以目前快照重新初始化。fermi 是基於 Supabase + OpenRouter 的可自架 LINE 助理。本專案不依賴 fermi，也不直接合併其原始碼；僅把 webhook queue、持久化、run trace、reply/push fallback、capability 等架構方向作為參考，詳見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## Credits and Acknowledgments

除 fork 來源外，下列服務與專案啟發了本專案的設計。**本 repo 未包含這些專案的任何原始碼**——僅就概念與公開文件化的規格作參考、獨立實作。對 GPL／FSL／無授權的專案，其與本 repo（MIT）授權不相容或需額外評估，是「未複製任何程式碼」的額外理由。

| Project | License | What it informed |
| --- | --- | --- |
| [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/) | Official platform | webhook 規格、訊息型別、簽章驗證的權威來源。 |
| [OpenAI Platform](https://platform.openai.com/docs/) | Official service | chat completions、images（DALL·E）、audio transcriptions（Whisper）、vision 端點規格。 |
| [line/line-bot-sdk-nodejs](https://github.com/line/line-bot-sdk-nodejs) | Apache-2.0 | LINE 官方 Node SDK；webhook 簽章驗證與訊息型別的實作參考。 |
| [TheExplainthis/ChatGPT-Line-Bot](https://github.com/TheExplainthis/ChatGPT-Line-Bot) | MIT | 繁中最多星的 LINE ChatGPT bot；指令設計與部署流程參考。 |
| [ycs77/chatgpt-linebot](https://github.com/ycs77/chatgpt-linebot) | MIT | 另一個繁中 LINE GPT bot；輕量實作參考。 |
| [ctjoy/chatgpt-line-bot-serverless](https://github.com/ctjoy/chatgpt-line-bot-serverless) | No declared license | AWS Lambda serverless 部署的另一種做法。 |
| [n3d1117/chatgpt-telegram-bot](https://github.com/n3d1117/chatgpt-telegram-bot) | GPL-2.0 | 同類（Telegram）的功能廣度（串流、多模態、群組）概念參考；GPL 不併入 MIT。 |
| [memochou1993/fermi](https://github.com/memochou1993/fermi) | FSL-1.1-MIT | 原作者的接班專案（Supabase + OpenRouter），只作方向與架構參考；本 repo 不直接合併其原始碼。 |
| [Toki（前身 Dola）](https://toki.com/zh-hant) | Commercial service / no public source | 自然語言行程／任務、自適應提醒、完成、多日曆、衝突建議、多模態與主動追蹤的公開產品行為參考；另見 [Updates](https://toki.com/zh-hant/updates)、[Dola note](https://note.com/dola_ai/n/nc457877a6b09) 與 [LINE VOOM](https://linevoom.line.me/user/_deGOEUAnNSgP1QW6kUVOtnQRZ3lnRXY7A0ukxwQ?=)。未複製私有程式碼、品牌、文案或素材。 |

若未來版本納入任何第三方原始碼，該程式碼連同其授權與 attribution 會加到本檔並置於明確標示的位置。Copyleft 授權（GPL 等）的程式碼不會併入本專案的 MIT 模組。

## Third-Party Services

本專案未獲 LINE Corporation / LY Corporation、OpenAI、Vercel、SerpAPI 或任何文中提及之第三方服務的關聯、背書或贊助。

LINE、LINE Messaging API、OpenAI、ChatGPT、GPT、DALL·E、Vercel、SerpAPI、Toki、Dola 等名稱僅用於識別、互通與產品研究目的。

使用者與維護者需自行遵守：

- LINE Messaging API 與 LINE Developers 條款。
- OpenAI API 使用條款與用量政策。
- Vercel（或其他部署平台）服務條款。
- SerpAPI 服務條款（若啟用搜尋功能）。
- 當地著作權、商標、隱私與消費者保護法規。

## AI Output Responsibility

AI 產生的文字與圖片仍可能需要人工審閱，不得宣稱本工具保證正確、合法、無侵權或適合商業使用。對外提供服務前，使用者應自行審查生成內容是否含侵權、真人肖像、個資、冒犯或受限內容。

## Secrets Caution

不要把 API key、token、`.env` / `.env.*`、LINE channel secret、OpenAI/SerpAPI 金鑰或任何私密憑證提交進版控。部署所需的敏感值一律透過部署平台（Vercel）的環境變數或本機未追蹤的 `.env` 設定。
