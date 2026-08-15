# GPT AI Assistant

[![Release](https://img.shields.io/github/v/release/SanHsien/gpt-ai-assistant?sort=semver)](https://github.com/SanHsien/gpt-ai-assistant/releases/latest)
[![CI](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml/badge.svg)](https://github.com/SanHsien/gpt-ai-assistant/actions/workflows/codeql.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[繁體中文](README.md) · [English](README.en.md) · [Documentation](https://sanhsien.github.io/gpt-ai-assistant-docs/en/) · [Latest Release](https://github.com/SanHsien/gpt-ai-assistant/releases/latest)

**GPT AI Assistant** is a self-hosted **personal AI assistant for LINE**. Deploy it with your own LINE, OpenAI, and Supabase configuration, then chat, send voice or images, search the web, manage events and tasks, receive reminders, and check weather without leaving LINE.

It is more than a chat wrapper. LINE is the user interface, while a **durable queue and persistent assistant state** provide the reliability layer behind the bot. Paid AI work and LINE delivery use separate checkpoints, events and tasks survive serverless restarts, and Google Calendar / Tasks can be connected when needed.

> **For installation, environment variables, Google OAuth, user workflows, and troubleshooting, use the [documentation site](https://sanhsien.github.io/gpt-ai-assistant-docs/en/).** The `docs/` directory in this repository focuses on runtime behavior, architecture, data contracts, migrations, technical decisions, and release implementation.

## Who it is for

- People who want their own AI assistant **inside LINE**, rather than another chat application.
- Users comfortable self-hosting and bringing their own OpenAI, LINE, and Supabase credentials and billing.
- People who need more than chat: **events, tasks, reminders, search, voice, images, and weather**.
- Developers who care about webhook idempotency, durable jobs, retries, and explicit data boundaries in serverless environments.

The production acceptance baseline is currently **Traditional Chinese (`zh_TW`) + LINE + OpenAI**. English and Japanese interfaces can run, but natural-language date parsing, weather formatting, and some intent recognition remain Chinese-oriented and should be treated as experimental localization.

## Core capabilities

| Area | What it does |
| --- | --- |
| AI chat | Continuous conversation, continue, retry, and forget; models are configurable through environment variables |
| Voice and images | LINE voice/common audio transcription, image understanding, and GPT Image generation |
| Search and URLs | SerpAPI web search; optional SSRF-safe URL summarization; search replies include source links |
| Events | Natural-language create/edit/complete/delete, conflict warnings, recurring schedules, and LINE reminders |
| Google Calendar | Authorized outbound CRUD plus safe-scope inbound sync for timed non-recurring events on the primary calendar |
| Tasks | Supabase-backed todos with due dates, priority, tags, filters, complete/reopen/delete, and deadline reminders |
| Google Tasks | Optional outbound/inbound state synchronization; precise due-time authority remains local |
| Weather | Open-Meteo current conditions, forecasts, and optional daily weather push without another API key |
| LINE UX | Feature-aware Quick Replies, confirmation cards, postbacks, quiet hours, and pause/resume reminders |

Feature flags can disable higher-cost or optional capabilities such as image generation, transcription, vision, search, tasks, weather, and Google integrations. See the [documentation](https://sanhsien.github.io/gpt-ai-assistant-docs/en/) and [`.env.example`](.env.example) for the authoritative configuration list.

## What using it feels like

Inside LINE, you can send natural requests such as:

```text
Tomorrow at 3 PM dental follow-up
Add task urgent submit report tomorrow #work
Weather Taipei
Search for this week's important OpenAI news
```

When an event is incomplete, the assistant asks for the missing detail before writing anything. A complete draft must be confirmed first. If Google synchronization later fails, the local record is retained and the bot offers retry, defer, or delete instead of silently discarding state.

LINE voice messages and supported audio attachments are transcribed and then enter the same input pipeline as text. Event confirmation echoes the transcript so users can distinguish a transcription mistake from a scheduling-parsing mistake.

## Reliability and data boundaries

The engineering focus is not only answer quality. The runtime is designed to avoid duplicate paid work, duplicate replies, and lost state in serverless execution:

- Webhooks pass durable preflight and idempotent persistence before processing; missing required configuration, database failures, or stale migrations fail closed so LINE can redeliver.
- **AI completed** and **LINE delivered** are separate checkpoints. Delivery retries resend saved output instead of rerunning paid AI work.
- Durable job payloads are encrypted. User/group state uses deployment-scoped HMAC identifiers rather than storing raw LINE user ids or names.
- General conversation text is not treated as a permanent profile database; persistent storage is reserved for structured assistant state, jobs, and necessary operational records.
- Google Calendar / Tasks are used only after the user completes OAuth authorization for the relevant scopes.

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), [`docs/DECISIONS.md`](docs/DECISIONS.md), and [`REVIEW.md`](REVIEW.md) for the full runtime, security, and evidence details.

## Google integration boundaries

Calendar currently supports outbound management of bot-managed events plus safe-scope inbound synchronization for **future, timed, non-recurring** events on the primary calendar. These remain intentionally outside the complete inbound contract:

- all-day Calendar events
- recurring series / exceptions
- non-primary calendar imports
- Google Tasks due-date reclamation

These are explicit product boundaries, not failures of the normal LINE event/task workflows. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the detailed contract.

## Quick start

### 1. Prepare services

A basic deployment needs:

- a LINE Messaging API channel
- an OpenAI API key
- Supabase Postgres
- Node.js 24
- Vercel (recommended), or another Node/Docker-capable host

Search, Google Calendar / Tasks, and image Blob delivery require additional configuration.

### 2. Install and preflight

```bash
git clone https://github.com/SanHsien/gpt-ai-assistant.git
cd gpt-ai-assistant
npm ci
cp .env.example .env
npm run db:migrate
npm run db:preflight
```

### 3. Deploy and configure the LINE webhook

After deployment, point the LINE channel Webhook URL to:

```text
https://YOUR_HOST/webhook
```

Before production use, verify migrations, Cron, Production Sensitive environment values, and any APIs/OAuth required by enabled features. **Do not infer the full deployment sequence from this README**; follow the [complete deployment documentation](https://sanhsien.github.io/gpt-ai-assistant-docs/en/).

## Local development

```bash
npm ci
cp .env.example .env
npm run dev
npx eslint .
npm run test:module-load
npm test
```

The LINE webhook needs a publicly reachable HTTPS endpoint; use ngrok, cloudflared, or a similar tunnel for local testing.

CI also builds the production Docker image, starts the container, and validates `/health/live` plus the image healthcheck.

## Architecture at a glance

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

Main code areas:

- `api/`: HTTP / serverless entry points
- `app/`: LINE events, context, handlers, and commands
- `services/`: AI, LINE, Google, queue, reminders, and integrations
- `repositories/`: Supabase data access
- `db/`: migrations and rollbacks
- `config/index.js`: single environment-variable read point
- `tests/`: Jest regression tests

## Documentation ownership

### User documentation

- [Documentation site](https://sanhsien.github.io/gpt-ai-assistant-docs/en/)
- [Traditional Chinese docs](https://sanhsien.github.io/gpt-ai-assistant-docs/)
- [`SanHsien/gpt-ai-assistant-docs`](https://github.com/SanHsien/gpt-ai-assistant-docs): source of truth for installation, deployment, configuration, usage, and troubleshooting

### Maintainer documentation in this repo

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md): runtime architecture, development, deployment implementation, and validation
- [`docs/ROADMAP.md`](docs/ROADMAP.md): product boundaries, data/Google contracts, and future direction
- [`docs/DECISIONS.md`](docs/DECISIONS.md): technical and product decisions
- [`REVIEW.md`](REVIEW.md): latest evidence-based project review and unverified items
- [`CHANGELOG.md`](CHANGELOG.md): version history
- [`NOTICE.md`](NOTICE.md): provenance, attribution, and third-party notices

## Product direction

GPT AI Assistant keeps these core constraints:

- **LINE remains the sole primary user interface** rather than becoming a multi-channel platform.
- **OpenAI remains the default AI provider**, using user-supplied API keys.
- **Self-hosting and a verifiable durable runtime** take priority over adding more chat gimmicks.
- Google Calendar / Tasks remain personal-assistant integrations rather than expanding into multi-user collaboration or enterprise workflow software.

Completed work, excluded directions, and future planning live in [`docs/ROADMAP.md`](docs/ROADMAP.md); the README intentionally does not maintain a second parallel roadmap.

## Origin and license

This project is derived from [`memochou1993/gpt-ai-assistant`](https://github.com/memochou1993/gpt-ai-assistant), retains the original MIT license and attribution, and is now independently maintained by SanHsien. See [`NOTICE.md`](NOTICE.md) for detailed provenance and third-party notices.

Source code is available under the [MIT License](LICENSE). This project is not officially endorsed by LINE, OpenAI, Google, Supabase, Vercel, or any other service provider.
