# 路線圖

> 本 repo 後續工作的單一真相源。做完一項，就在同一個 commit 刪掉那一列；新工作只加在這裡。
> 現況段的數字是 2026-10-29 依 `main` `6b8ad1c6de3a` 查的快照，開工前先重查 GitHub。

## 現況
自架的 LINE × OpenAI 個人助理（行程、任務、提醒、Google Calendar／Tasks、天氣、搜尋），最新 release 是 `v6.1.0`（2026-07-29）。2026-10-29 查 `main`：open issue 0、open PR 0、Dependabot 與 code scanning open alert 皆 0，CI／CodeQL／Dependabot guarded merge 最近一次 success，「上游更新檢查」2026-10-26 排程 success（查法：`gh issue list -R SanHsien/gpt-ai-assistant`、`gh api repos/SanHsien/gpt-ai-assistant/dependabot/alerts?state=open`、`gh run list -R SanHsien/gpt-ai-assistant -b main`）。
`v6.1.0` 之後累積的修正已整理補齊至 `CHANGELOG.md` `[Unreleased]`，待完成近期項目後發版；Preview 已能連 staging 通過 runtime preflight（[`DECISIONS.md`](DECISIONS.md) 2026-10-28）。

## 近期：可以直接動手
| 項目 | 為什麼 | 驗收方式 | 建議執行者 | 證據 |
| --- | --- | --- | --- | --- |
| LINE webhook 背景 drain 加時間預算 | `/cron/reminders` 已用 `REMINDER_WORKER_TIME_BUDGET_MS` 限時，webhook 路徑的 `drainQueue()` 沒傳 `maxDurationMs`；多個 job 連續卡住時總時間可能超過 Vercel 60 秒 | 新增測試：模擬連續卡住的 job，webhook drain 在預算內停止並回報 `budgetExhausted: true`，剩餘 job 留在 queue；`npx eslint .`、`npm test` 綠 | Claude Sonnet | `api/index.js:166`（無預算）對照 `api/index.js:130-132`；`services/worker.js:143-157` |
| 決定 `系統 部署` 指令的授權邊界 | 任何能和 bot 對話的 LINE 使用者都能觸發 `VERCEL_DEPLOY_HOOK_URL`；另外沒設 hook 時只推錯誤訊息、仍照樣呼叫 `deploy()` | `DECISIONS.md` 有一筆決定（限定擁有者／預設關閉／維持現狀三選一＋理由）；若改程式：非授權使用者觸發時不呼叫 `services/vercel.js` 的測試、缺 hook 時提早 return 的測試都通過 | Claude Opus | `app/handlers/deploy.js:11`、`app/handlers/deploy.js:20-21`；`app/app.js:34`（無授權檢查即進 handler） |
| 發下一個 6.x 版本 | 讓上面的修正進到正式環境；Preview → staging 的驗證路徑已打通 | Preview 部署連 staging 的 `/` 回 `status: OK` 且版本號為新版；Production 部署後 `/health/live` 回 200；`gh release view -R SanHsien/gpt-ai-assistant` 顯示新 tag。不重新初始化或清空 staging，不拿 Production 資料庫做實驗 | 維護者 | [`DECISIONS.md`](DECISIONS.md) 2026-10-28；版本政策見[`PRODUCT.md`](PRODUCT.md)「版本政策」 |

## 中期：等條件成立再做
| 項目 | 觸發條件 | 驗收方式 | 建議執行者 | 證據 |
| --- | --- | --- | --- | --- |
| Babel 7 → 8 | `@jest/transform` 新版改依賴 `@babel/core ^8`（或專案移除 Babel transform） | `npm ls @babel/core` 只剩 8.x；`npx eslint .`、`npm test`、`npm run test:module-load` 綠；刪掉 `.github/dependency-deferrals.json` 的兩筆暫緩 | Codex | `.github/dependency-deferrals.json`；查法 `npm view @jest/transform dependencies` |
| 移除 `@vercel/cli-config` 底下的 zod override；處理 `sprintf-js` | `@vercel/cli-config` 發新版且打包的 zod ≥ 4.6.6；`sprintf-js` 出修補版或 dev 鏈不再用 `js-yaml@3` | override 移除後 `npm audit` 不回升；Dependabot 該筆 state=fixed（`gh api repos/SanHsien/gpt-ai-assistant/dependabot/alerts?state=open`） | Codex | [`DECISIONS.md`](DECISIONS.md) 2026-10-24 |
| 審上游新變更 | 「上游更新檢查」workflow 開出或 reopen 提醒 issue（failure＝有未審 commit／PR／issue，不是工具壞） | 逐筆寫進 `DECISIONS.md`（引用或不引用＋理由），推進 `tools/upstream-baseline.json` 的 `reviewedThrough`／`reviewedPrThrough`／`reviewedIssueThrough`；提醒 issue 自動關閉 | Claude Sonnet | `tools/upstream-baseline.json`（審到 `d84c806`、PR #374、issue #376）；`.github/workflows/upstream-check.yml` |
| 擴大 Google 同步範圍：全天 inbound、週期 series／exception inbound、非 primary 匯入、Tasks `due` 回收 | 個人使用反覆遇到「Google 端改了全天或週期行程，LINE 提醒沒跟上」 | 先在 `DECISIONS.md` 寫 provider contract（exclusive end date、DST、RRULE 例外模型）；每一型有 mock 測試＋真實 Google 單筆閉環 | Claude Opus | [`PRODUCT.md`](PRODUCT.md)「支援範圍」；`REVIEW.md` 結論段（明確不支援） |
| 看圖進階路徑（標註、局部放大、計數） | 個人使用反覆出現「小字看不清、要在原圖標註、要計數」，且 OpenAI prototype 的品質提升能覆蓋成本與延遲 | 照 [`DECISIONS.md`](DECISIONS.md) 2026-08-23 列的前置設計（feature flag、owner-scoped durable state、cost trace、兩段 checkpoint）逐項有測試 | Claude Opus | [`DECISIONS.md`](DECISIONS.md) 2026-08-23 Agentic Vision |
| LINE／OpenAI 金鑰從 Preview 隔離 | 開始在 Preview 做會回 LINE 訊息或用 OpenAI 額度的功能實測 | Vercel 的 Preview 只有 LINE 測試頻道憑證與設了花費上限的 OpenAI 測試金鑰，Production 金鑰只套用 Production；重新部署後 Preview 的 `/` 仍回 `status: OK` | 維護者（要收 email 驗證碼） | [`DECISIONS.md`](DECISIONS.md) 2026-10-29 金鑰隔離 |

## 刻意不做
| 不做什麼 | 理由 | 什麼情況下重新考慮 |
| --- | --- | --- |
| CalDAV／Apple／ICS、分享與群組協作、多頻道 adapter、搜尋主題追蹤推播、多來源交叉比對、圖片建行程、批次建立多筆行程 | 定位是個人單人自架、LINE 單頻道、即問即答；這些項目的安全面與維護成本高於邊際效益（[`DECISIONS.md`](DECISIONS.md) 2026-07-17「收斂路線圖範疇」） | 產品定位改為多人或多頻道時 |
| 回貢上游 `memochou1993/gpt-ai-assistant` | 上游最後一次 merged PR 是 2024-07-09，架構已分岔，準備可套用 PR 的成本高於效益（[`DECISIONS.md`](DECISIONS.md) 2026-07-17） | 上游恢復程式開發，或上游維護者主動要特定修正 |
| 換掉 OpenAI API key 路線：ChatGPT 訂閱 OAuth、把其他 provider SDK 設為預設、合併 fermi（FSL）原始碼、轉 FSL 授權 | 訂閱 OAuth 不是 server-side API；第二套 provider stack 與 FSL 原始碼會破壞「輕量、MIT、OpenAI direct」邊界（[`DECISIONS.md`](DECISIONS.md) 2026-07-11 三筆、2026-08-23） | 要做 full-stack v2、多 owner／dashboard，或 fermi 某版本已滿兩年轉 MIT |
| 重新初始化或清空 staging 資料庫；用 Production 資料庫做實驗 | staging 是 Preview 驗證的目標（[`DECISIONS.md`](DECISIONS.md) 2026-10-28）；Production 存的是實際使用資料 | 不重新考慮（固定邊界） |

## 維護方式
依賴：Dependabot 每週＋每月 freshness workflow；開發工具 minor／patch 走 guarded merge，執行期依賴與 major 人工審查，暫緩的 major 寫進 `.github/dependency-deferrals.json`。
上游：「上游更新檢查」每週一跑，有未審項目才處理（見中期表）。發版：`main` 累積使用者可見修正後發 6.x，先 Preview → staging，再 Production；不相容變更才升 major。

產品邊界、支援範圍、Google contract、品質門檻、版本政策、API 與模型基線與授權策略見 [`PRODUCT.md`](PRODUCT.md)（2026-10-29 從本檔搬出；本檔只放後續工作）。
