# GPT AI Assistant

[![Release](https://img.shields.io/github/v/release/SanHsien/gpt-ai-assistant?sort=semver)](https://github.com/SanHsien/gpt-ai-assistant/releases)
[![CI](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node-24-339933.svg)](package.json)
[![Platform: LINE](https://img.shields.io/badge/platform-LINE-00B900.svg)](https://developers.line.biz/)
[![Powered by OpenAI](https://img.shields.io/badge/AI-OpenAI-412991.svg)](https://platform.openai.com/)
[![Tests: Jest](https://img.shields.io/badge/tests-jest-blueviolet.svg)](tests)
[![Deploy: Vercel](https://img.shields.io/badge/deploy-Vercel-000000.svg)](https://vercel.com/)

[繁體中文](README.md) | [English](README.en.md)

`GPT AI Assistant` is a chatbot that connects the **OpenAI API** with the **LINE Messaging API**. Once deployed, you can chat with your own AI assistant right inside the LINE mobile app — conversation, image generation, image understanding, and web search, all in the LINE chat.

This repository originated from [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant) (MIT) and is now independently maintained by SanHsien. The Traditional Chinese [`README.md`](README.md) is the primary document.

## What it is

- **Native LINE experience** — no separate app; talk to your assistant in LINE.
- **Self-hosted, bring-your-own keys** — deploy with your own OpenAI and LINE channel credentials; data and billing stay yours.
- **Serverless deployment** — Vercel-first, one-click deploy (local Node or Docker also supported).
- **Command-based features** — beyond chat: image generation, vision, search, translation, scheduling, and summarize/analyze commands.

## Features

| Category | What it does |
|------|----------|
| 💬 Chat | Continuous conversation (`talk`); `continue`, `retry`, `forget` |
| 🎙️ Voice | Send a LINE voice message; transcribed by OpenAI speech-to-text (default `gpt-4o-mini-transcribe`, configurable) and handled as normal input — including **voice-created events** (the confirmation card echoes "🎤 Heard: ...") |
| 🎨 Draw | Generate images from a text prompt (`draw`, default GPT Image 2) |
| 👁️ Vision | Send an image for the AI to understand and describe (default `gpt-4o`) |
| 🔍 Search | Web search via SerpAPI (`search`) with a "📎 Sources" list (title/source/date/link; shown only, never fed into the prompt) |
| 🗓️ Schedule and reminders | Create an event (text or voice) with `Schedule ...` or a date-led statement such as `7/20 3 PM dental follow-up`. Ambiguous time prompts one focused question; event editing, overlap warnings, reminders, completion, deletion, and authorized Google Calendar updates are supported. **Bidirectional sync** (`ENABLE_GOOGLE_CALENDAR_INBOUND`) reclaims Google-side deletions and timed edits and dedups against LINE reminders. Reminders honor `Quiet hours 22-8` and `Pause reminders`/`Resume reminders` |
| ✅ Tasks | An assistant todo list stored independently in the Supabase `tasks` table. With `ENABLE_GOOGLE_TASKS`, create/complete/reopen/delete sync to Google Tasks (shared Calendar OAuth); with `ENABLE_GOOGLE_TASKS_INBOUND`, Google-side completion/reopen, deletion, title, and notes are reclaimed back (due is not reclaimed — the precise deadline stays authoritative locally). `Add task urgent submit report tomorrow #work` parses due date, priority, and `#tags`; use `My tasks` with `today/tomorrow/this week/next week/overdue/completed/#tag` filters, pagination, and one-tap complete, reopen, or delete (`ENABLE_TASKS`, off by default, needs `DATABASE_URL`) |

Task date aliases are resolved in the user's timezone. A broad `this week` deadline without a weekday is fixed to Sunday at 09:00; `next week` uses the following Sunday, so the model cannot pick an arbitrary day.
| 🌤️ Weather | Current conditions and forecasts (`Weather Taipei`); Taiwan place shorthand completion and same-name disambiguation, plus daily subscription push (`Daily weather Taipei 8`, `ENABLE_WEATHER_PUSH`). Data from Open-Meteo (free, no API key) with short-term caching (`ENABLE_WEATHER`, off by default) |
| 🌐 Translate | Translate to English / Japanese (`translate`) |
| 🧠 Summarize / Analyze | `sum` (advise, comfort, encourage…) and `analyze` (literary, mathematical, philosophical, psychological…) |
| ⚙️ System | `activate` / `deactivate`, `version`, `report`, `deploy` (self-redeploy), `doc` |

> Send `Command` to receive a grouped list of commands and examples generated from the features enabled on that deployment. The docs site provides the extended feature reference.

General replies attach up to 13 feature-aware LINE quick replies: `Schedule`, `My events`, `Add task`, `My tasks`, `Weather`, `Daily weather`, `Search`, `Draw`, `Link Google Calendar`, `Pause reminders`, `Resume reminders`, `Forget`, and `Command`. LINE renders quick replies as a single horizontal strip; the bot can't force a second row. Forks that want a persistent two-row mobile launcher can optionally configure the recommended 3×2 LINE Official Account rich menu described in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#line-quick-replies-and-optional-rich-menu).

`APP_LANG` accepts `zh_TW`, `zh`, `zh_CN`, `en`, and `ja`. Only `zh_TW` is fully accepted and production-supported today. `zh` and `zh_CN` currently reuse Traditional Chinese strings rather than a Simplified Chinese pack. English and Japanese start successfully and cover the main commands and Google OAuth pages, but weather formatting and natural-language date/intent parsing remain Chinese-oriented; treat them as experimental rather than complete localized deployments.

Google Calendar synchronization retries automatically up to three attempts in the background. The bot announces success only after Google accepts the event. A final failure offers **Retry sync**, **Not now**, and **Delete event**. Not now keeps the Supabase event and stops prompting; use `Failed syncs` later, then `Retry sync <ID>` or `Delete event <ID>`. Nothing is deleted without an explicit delete action.

Schedule shortcuts use LINE postbacks. The conversation shows natural labels such as **Confirm event** or **Complete event 2**; list actions include the current row number, while confirmation tokens, Supabase UUIDs, and Google event ids stay in hidden postback data. Text commands containing `<ID>` remain available only as a manual troubleshooting fallback.

An incomplete event remains a durable structured draft, never raw conversation text. The next natural-language answer continues it across serverless instances. Date-only statements become all-day events; vague periods such as "tomorrow afternoon" prompt for an exact time. `Edit event` lists editable local mappings and confirms the revised draft before applying it. Optimistic version checks reject stale overwrites, while overlap detection warns and leaves the final choice to the user.
>
> Each capability can be turned off individually for cost control (all on by default): `ENABLE_IMAGE_GENERATION`, `ENABLE_TRANSCRIPTION`, `ENABLE_VISION`, `ENABLE_SEARCH`.

## Quick start (Vercel-first)

1. **Get your keys** — OpenAI, LINE, SerpAPI (or disable search), plus a Supabase pooler URL, CA, and data-encryption key.
2. **Deploy to Vercel** — import this repo and set all required runtime variables as Production Sensitive values.
3. **Migrate and preflight** — run `npm run db:migrate` through `0019`, then `npm run db:preflight`.
4. **Set the LINE webhook** — point your LINE channel's Webhook URL to `{your-url}/webhook` and enable it.
5. **Start chatting** — add the LINE official account as a friend and send a message.

Version 6.0 requires Supabase Postgres with migrations `0001`–`0019`; there is no synchronous or Vercel-environment storage fallback. Health checks and webhooks fail closed when durable configuration, the database, or migrations are unavailable. Reminders also require Supabase Cron to call the protected worker endpoint every minute. Enable tasks and weather with `ENABLE_TASKS` and `ENABLE_WEATHER`. Google Calendar and Tasks additionally require a Web OAuth client, Vercel Production Sensitive environment variables, and both **Google Calendar API** and **Google Tasks API** enabled in the same Google Cloud project; granting the Tasks OAuth scope does not enable its API. Follow the deployment checklist in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#完整上線順序): enable APIs, apply migrations, and configure Cron before enabling flags and redeploying. After enabling `ENABLE_GOOGLE_TASKS`, send `Connect Google Calendar` again to grant the Tasks scope and backfill existing unsynced tasks. If synchronization previously failed because the API was disabled, enable it and reconnect; `rc.5` safely revives the same dead sync job instead of creating another task.

See [`.env.example`](.env.example) for the full variable list and `config/index.js` for defaults.

## Local development

Node.js 24 is required.

```bash
npm ci
cp .env.example .env    # fill in your keys
npm run dev             # nodemon Express server
npx eslint .            # ESLint flat config
npm test                # jest
```

The LINE webhook needs a publicly reachable HTTPS URL — use ngrok / cloudflared to expose your local port. Architecture and deployment details are in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Direction & roadmap

This project keeps **OpenAI + LINE, self-hosting, and user-supplied API keys** while evolving in phases into a personal assistant. It will not be rewritten wholesale or switch its default provider. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for phases, data models, API/model choices, reference architecture, and licensing boundaries.

### Done

- **Security hardening**: webhook fails closed when `LINE_CHANNEL_SECRET` is missing, `.env.example` defaults `APP_DEBUG=false`, CodeQL scanning + Dependabot added, dependency vulnerabilities resolved.
- **6 bug fixes**: group `forget` not clearing history, `search` crash on no results, `version` command taking down the batch, health route hanging, `stop` sequences never sent, audio temp-file leak.
- **Durable source state**: user/group activation uses only deployment-scoped HMAC keys in Postgres with atomic limits; raw LINE IDs and names are not persisted.
- **Default model upgrades**: chat `gpt-4o-mini`, image `gpt-image-2` (`low` quality), transcription `gpt-4o-mini-transcribe` (all env-overridable).
- **Capability feature flags**: `ENABLE_IMAGE_GENERATION` / `ENABLE_TRANSCRIPTION` / `ENABLE_VISION` / `ENABLE_SEARCH` for cost control.
- **Conversation TTL**: `APP_MAX_PROMPT_AGE` expires idle conversation context (disabled by default; set seconds to enable).
- **CI + badges**: GitHub Actions runs eslint + jest on every push; README shows live CI / CodeQL status badges.
- **Group reply policy**: `GROUP_REPLY_REQUIRES_MENTION` makes groups require a mention before replying, reducing noise (off by default).
- **LINE delivery checkpoint**: failed replies resend only the saved result, never rerun paid AI work or silently fall back to quota-counted Push API calls.
- **URL summary**: `ENABLE_URL_SUMMARY` (off by default) fetches a URL in the message via an SSRF-safe fetch and uses the page as summary context; residual risks in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
- **GPT Image support**: `gpt-image-2` is the default; base64 images are uploaded to private Vercel Blob and shared with LINE through a temporary signed URL. The model and quality remain configurable. Setup in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
- **Webhook deduplication**: LINE redeliveries and repeated `webhookEventId` values are processed only once, preventing duplicate paid API calls and replies.
- **Durable foundation (Phase 0)**: Supabase Postgres, atomic webhook idempotency, lease-fenced jobs, encrypted payloads, and HMAC-derived user keys. Version 6.0 always queues durably; missing IDs, database failures, or stale migrations reject the ACK so LINE can redeliver.
- **Events and reminders**: one sentence becomes a JSON-Schema-validated draft; explicit dates and local wall-clock times are resolved deterministically, while incomplete details continue through a durable structured clarification. Recurring phrases such as `Every day at 22:40 routine check` enter the schedule flow directly and show the recurrence rule before confirmation. Create and edit use token-bound confirmation, row locking, optimistic versions, and overlap warnings. `Connect Google Calendar` starts OAuth without invoking general chat; create and bot-originated updates sync through idempotent durable jobs, while list, complete, and delete call Google Calendar.
- **Durable checkpoints**: "AI finished" and "LINE delivered" are separate checkpoints, giving at-most-once AI work with retryable delivery. Delivery retries do not rerun the paid AI phase or duplicate a successful LINE reply.

### 6.0 release candidate

- **`6.0.0-rc.8`** switches Calendar inbound to non-expanded recurring-series sync, ignores recurrence instances, and uses migration `0019` to rebuild legacy v1 cursors safely. This prevents open-ended daily series from exhausting the Cron runtime. Final `6.0.0` still requires the remaining consolidated LINE/Google acceptance checks.
- **Google contract limits**: Calendar outbound CRUD and mapped timed non-recurring inbound plus mapped Tasks inbound/outbound are supported. Calendar all-day inbound, recurrence exceptions, Google-origin creation, and Tasks due-date inbound remain explicitly unsupported.
- **Further model/API upgrades** — first pass done; new models must be re-verified against official documentation before use, see [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **Adopt selected fermi architecture lessons** — rebuild reliability, persistence, observability in phases; do not merge fermi source code directly.
- **A Claude-based assistant** — possible future version, TBD.

### Excluded directions

- **OpenAI / ChatGPT subscription OAuth instead of API keys** — OpenAI currently bills and manages ChatGPT subscriptions separately from API usage; this repo should not be designed as a third-party LINE bot that consumes a user's ChatGPT subscription quota.
- **CalDAV / Apple / ICS interop (former Phase 5B)** — Google Calendar bidirectional sync already covers the single-Google-account personal use case; cross-protocol interop costs outweigh the benefit.
- **Event sharing and group collaboration (former Phase 8)** — stays a single-user personal assistant; no share links or group permission model.
- **Multi-channel adapters (former Phase 9)** — LINE is the sole optimized channel.
- **Search topic-tracking push and multi-source cross-referencing (former Phase 7 items)** — search stays user-initiated ask-and-answer with source links only.
- **Image-to-event capture (former Phase 4 item)** — vision confidence/multi-event complexity is high; images stay for vision chat. (**Voice-created events are implemented.**)
- **Batch creation of multiple events at once (former Phase 1 item)** — needs a multi-draft, per-item/all confirmation state machine; low value for single-user use, where one-by-one entry or recurring events already cover most needs.

The last six were decided on 2026-07-17; see [`docs/ROADMAP.md`](docs/ROADMAP.md).

See [`docs/DECISIONS.md`](docs/DECISIONS.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md) for phase status.

## Docs

- Docs site (Chinese): <https://sanhsien.github.io/gpt-ai-assistant-docs/>
- Docs site (English): <https://sanhsien.github.io/gpt-ai-assistant-docs/en/>
- Maintenance docs: [roadmap and technical evaluation](docs/ROADMAP.md), [development and deployment](docs/DEVELOPMENT.md), and [decision log](docs/DECISIONS.md)

> The docs site originated from [`memochou1993/gpt-ai-assistant-docs`](https://github.com/memochou1993/gpt-ai-assistant-docs) (VuePress), is now independently maintained, and is published via GitHub Pages. Upstream original: <https://memochou1993.github.io/gpt-ai-assistant-docs/>.

## Other reference projects

This project references a few services and open-source projects for concepts, specs, or deployment flows only (official LINE/OpenAI docs, other Traditional-Chinese LINE bots, fermi, Toki, etc.) and includes **none of their source code**; GPL / FSL / unlicensed projects are not merged into this MIT repo. See the Credits table in [`NOTICE.md`](NOTICE.md) for the full list, licenses, and what each informed; see [`docs/ROADMAP.md`](docs/ROADMAP.md) for the technical evaluation.

## Project source & credits

Upstream replaced its stale News section with a fermi successor pointer in [`d84c806`](https://github.com/memochou1993/gpt-ai-assistant/commit/d84c806b8368ded9d790067235827cdac32a23ab) on June 8, 2026. This project's source lineage includes that version, while its public Git history was reinitialized from the current independently maintained snapshot on July 18, 2026. No upstream contributions are currently planned; see the [roadmap](docs/ROADMAP.md#上游活躍度與回貢決策) for the activity assessment and decision.

Originated from [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant) (by Memo Chou, MIT). Thanks to the original author and all [contributors](https://github.com/memochou1993/gpt-ai-assistant/graphs/contributors). Attribution and third-party notices are in [`NOTICE.md`](NOTICE.md).

## License

[MIT](LICENSE) — original MIT license and upstream attribution preserved. This repo is not switching to FSL-1.1-MIT for now; see [`docs/ROADMAP.md`](docs/ROADMAP.md) for the licensing strategy and future switch conditions.
