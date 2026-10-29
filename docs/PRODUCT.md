# 產品邊界與背景評估

> 本檔是產品**目前**的邊界與規格：支援範圍、架構邊界、品質門檻、版本政策、API 與模型基線、授權策略，以及做這些決定時參考過的背景評估。**它不是待辦清單**：後續工作只寫在 [`ROADMAP.md`](ROADMAP.md)，耐久決策在 [`DECISIONS.md`](DECISIONS.md)，已完成項目的過程與驗收在 [`../CHANGELOG.md`](../CHANGELOG.md) 與 [`../REVIEW.md`](../REVIEW.md)。
> 產品邊界改了（新增或撤回支援範圍、改 Google contract、換模型預設），在同一個 commit 更新本檔。

## 支援範圍

| 能力 | 支援 | 明確不支援或尚未做 |
| --- | --- | --- |
| 對話、翻譯、摘要、看圖、生圖、語音轉文字 | 支援；語音與文字走同一個行程草稿流程，確認卡回顯聽到的原文 | 圖片（海報／票券／截圖）建行程 |
| 行程 | 新增／查詢／修改／刪除／完成、個人 IANA 時區、模糊時間追問、衝突警告、durable 確認、週期行程（RRULE） | 批次建立；修改履歷與回復；首次使用的時區引導。週期提醒以 UTC 日期算術，有 DST 的時區本地鐘點可能漂移一小時（Google 端 RRULE 正確） |
| 任務 | 新增／列表／完成／重開／刪除、期限、優先度、`#標籤` 與日期篩選、分頁 | title／期限修改走刪除重建 |
| 提醒 | 到點＋多重提前提醒（`REMINDER_OFFSETS`，預設 1440）、週期 occurrence、有期限任務、安靜時段、暫停／恢復、過期跳過、`X-Line-Retry-Key` 冪等 | 無期限任務不排提醒 |
| Google Calendar | `calendar.events.owned` OAuth（PKCE、envelope encryption）、outbound 新增／修改／刪除／完成；sync token inbound：mapped timed 非週期修改與刪除、primary calendar 未來 timed 非週期 Google-origin 匯入 | 全天 inbound、週期 series／exception inbound、非 primary 匯入、watch channel、附件／受邀者 |
| Google Tasks | 單向鏡像為主（Supabase 權威）；inbound 回收完成／重開／刪除／標題／備註（`ENABLE_GOOGLE_TASKS_INBOUND`） | `due` 回收；task list 只能用 `GOOGLE_TASKS_LIST_ID` 指定；etag 樂觀鎖 |
| 天氣 | Open-Meteo 現況與 1–7 日預報、市縣同名追問、每日推播訂閱 | 旅遊期間／多時段訂閱 |
| 搜尋 | SerpAPI、來源清單（不進 prompt）、從答案建立行程草稿（需確認） | 主題追蹤推播、多來源交叉比對 |
| 頻道與語系 | LINE；`zh_TW` 為正式支援 | 其他頻道；`en`／`ja` 為實驗性，升正式需補天氣格式、日期／意圖 parser fixture 與完整 E2E |

Google OAuth app 是少於 100 位使用者的未驗證個人用途，首次授權有 Google 警告；公開擴大使用前需完成敏感 scope 驗證。

## 架構邊界

LINE webhook 只做驗簽、冪等登記、入列與快速 ACK；worker 執行 AI 與外部 API；Postgres（Supabase）是唯一 durable source of truth；Supabase Cron 每分鐘觸發 scheduler。所有寫入先由模型產生結構化草稿、經程式驗證並由使用者確認才提交；LLM 不直接執行 SQL 或未經 schema 驗證的寫入。對話 prompt／history 刻意保持在記憶體、不落庫。細節見 [`DEVELOPMENT.md`](DEVELOPMENT.md)。

原 Phase 編號對照（其他文件仍會引用）：Phase 0 可靠性基礎、1 行程、2 任務、3 提醒、4 語音建行程（圖片建行程不做）、5A Google Calendar、5B CalDAV／ICS（不做）、6 天氣、7 搜尋（主題追蹤不做）、8 分享／群組（不做）、9 多頻道（不做）。

## 新功能的品質門檻

- `npx eslint .` 與 `npm test` 通過；新行為有 unit／integration／競態測試。
- DB migration 可從空資料庫套用，破壞性 migration 有 rollback／備份計畫。
- 外部 API 用 mock／fixture 測試，並有最小 live smoke 手冊。
- webhook、job、OAuth callback 具驗證、限流、冪等與安全錯誤訊息。
- 新能力預設有 feature flag 與成本觀測；失敗不無限重試。
- log、run trace、錯誤回覆不留 token、完整對話、附件或不必要個資。
- Preview／staging 實測後才開正式 feature flag，可獨立關閉與回滾。

## 版本政策

major 代表部署者必須處理的不相容變更，不代表功能多寡；向後相容的功能、可靠性與文件改善都留在 `6.x`。各版內容見 [`../CHANGELOG.md`](../CHANGELOG.md)。

## API 與模型基線

> 模型名稱、價格與相容參數變動快；實作前重新核對 OpenAI 官方 models、pricing 與 guides。

| 功能 | API／目前預設 | 判斷 |
| --- | --- | --- |
| 對話 | Chat Completions／`gpt-4o-mini` | 低成本預設；換模型前先跑 talk／sum／translate／analyze smoke tests |
| 影像理解 | Chat Completions image input／`gpt-4o` | 降成本候選需先比中文辨識品質 |
| 語音轉文字 | Audio Transcriptions／`gpt-4o-mini-transcribe` | `whisper-1` 可作明確 fallback |
| 生圖 | Images Generations／`gpt-image-2`、`low` | base64 經 private Vercel Blob 與 signed URL 交付 LINE |
| 搜尋 | SerpAPI | 改 Responses API web search 時，必須同時完成引用、工具結果格式、成本觀測與 fallback |

- ChatGPT 訂閱與 OpenAI API 分開計費；本 bot 維持 `OPENAI_API_KEY`。Codex 的 ChatGPT sign-in 不是第三方 server-side bot 可用的 API OAuth。
- 改善 key 管理優先採 OpenAI project／service-account key、權限切分、用量上限與 spend alert。
- 新模型必須驗證 `temperature`、`stop`、penalty 與輸出格式相容。
- 官方來源：[models](https://developers.openai.com/api/docs/models)、[pricing](https://developers.openai.com/api/docs/pricing)、[image generation](https://developers.openai.com/api/docs/guides/image-generation)、[speech to text](https://developers.openai.com/api/docs/guides/speech-to-text)、[web search](https://developers.openai.com/api/docs/guides/tools-web-search)、[ChatGPT Plus 不含 API usage](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)。

## fermi 架構取捨

[`memochou1993/fermi`](https://github.com/memochou1993/fermi) 是原作者的 Supabase + OpenRouter 接班專案，採 FSL-1.1-MIT。只重做公開概念，不搬原始碼：

| 領域 | 可吸收做法 | 本 repo 決策 |
| --- | --- | --- |
| Webhook／Worker | 快速 ACK、DB 冪等、durable queue、retry、dead letter | 已採用 |
| 狀態 | Postgres threads／runs／credentials | 採 Supabase Postgres |
| Delivery | reply token 時間預算與 Push fallback | 已有 Push fallback |
| Observability | run／step／cost trace | 採用，但不保存完整對話 |
| Provider | OpenRouter tool loop | 只保留可選方向；OpenAI direct 是預設 |
| Dashboard | Nuxt + Supabase Auth | 不做 |
| Marketplace | MCP／BYO tools | prompt injection、credential scope、allowlist 完成前不做 |

## 上游活躍度

[上游 `main`](https://github.com/memochou1993/gpt-ai-assistant/commits/main) 未封存，但最後一次 merged PR 是 2024-07-09 的 [#333](https://github.com/memochou1993/gpt-ai-assistant/pull/333)；2026-06-08 的 [`d84c806`](https://github.com/memochou1993/gpt-ai-assistant/commit/d84c806b8368ded9d790067235827cdac32a23ab) 只是把 News 改為 fermi 接班指引，已納入本專案來源脈絡。本 repo 公開歷史於 2026-07-18 以快照重新初始化，與上游沒有共同祖先；上游 attribution（`LICENSE`、`NOTICE.md`）永久保留。逐筆審查紀錄在 [`DECISIONS.md`](DECISIONS.md)，水位在 `tools/upstream-baseline.json`。

## 其他參考專案

| 專案／服務 | 授權 | 可參考內容 | 不採用內容 |
| --- | --- | --- | --- |
| [LINE Node SDK](https://github.com/line/line-bot-sdk-nodejs) | Apache-2.0 | webhook 型別、簽章、Messaging API client | 不為形式整套替換 |
| [TheExplainthis/ChatGPT-Line-Bot](https://github.com/TheExplainthis/ChatGPT-Line-Bot) | MIT | URL／YouTube 摘要、persona UX | 明文使用者 key、舊 Flask／Replit 架構 |
| [ycs77/chatgpt-linebot](https://github.com/ycs77/chatgpt-linebot) | MIT | Redis TTL、群組 gating、圖片 proxy | 直接搬舊實作 |
| [n3d1117/chatgpt-telegram-bot](https://github.com/n3d1117/chatgpt-telegram-bot) | GPL-2.0 | usage budget、串流、多模態、群組 UX | GPL 原始碼 |
| [ctjoy/chatgpt-line-bot-serverless](https://github.com/ctjoy/chatgpt-line-bot-serverless) | 未宣告 | AWS Lambda 部署概念 | 未授權原始碼 |
| [Toki（前身 Dola）](https://toki.com/zh-hant) | 商業服務 | 自然語言行程／任務、模糊輸入、提醒、天氣、分享等行為規格（研究來源：[官方更新](https://toki.com/zh-hant/updates)、[品牌演進](https://toki.com/brand)、Dola note 文章與 LINE VOOM 27 篇貼文） | 品牌、文案、素材、私有實作 |

## 授權策略

維持 MIT，不轉 FSL-1.1-MIT。MIT repo 不混入尚未轉 MIT 的 FSL 原始碼；fermi 特定版本滿兩年轉 MIT 後才能依該版本評估。只有要做 full-stack v2、多 owner／dashboard／BYOK marketplace、直接使用未轉 MIT 的 fermi code，或要限制競品的商業服務時，才重新評估另開 FSL repo，且重大商業使用前先取得法律意見。來源：[FSL](https://fsl.software/)、[SPDX FSL-1.1-MIT](https://spdx.org/licenses/FSL-1.1-MIT.html)、[MIT License](https://opensource.org/license/mit)。
