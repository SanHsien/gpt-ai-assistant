# Calendar and Task Reminders Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:dispatching-parallel-agents (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make future timed events on the connected primary Google Calendar—including events not created by the bot—and due tasks send LINE reminders one day before by default, while retaining an at-time reminder.

**Architecture:** Reuse the existing Calendar inbound cursor, durable `jobs` queue, reminder Cron, encrypted LINE target, quiet hours, pause/resume preference, stale-job policy, and LINE retry key. Calendar inbound v3 rebuilds a baseline and imports only future, timed, non-recurring events from the connected `primary` calendar; Google-origin rows are owner-scoped and mapped by the existing unique `(owner_id, provider_event_id)` index. Baseline and incremental sync both use a fenced, owner-exclusive durable claim: the database fixes the generation/timeMin or syncToken plus current pageToken, each job handles one bounded page, and checkpoint plus continuation enqueue commit together. A stale claimant may take over the same persisted snapshot; the old token becomes a no-op. Only the final page cleans unseen baseline mappings, stores `nextSyncToken`, and releases the claim. Later Google modifications reuse the row-locked inbound update path to cancel and reschedule jobs, while deletions atomically remove the mapping and cancel pending jobs. All-day events, recurring series/instances, and Google-origin events on non-primary calendars remain explicit non-goals. Due tasks receive a dedicated job kind and sender so task lifecycle cancellation cannot collide with event jobs.

**Tech Stack:** Node.js 24 ESM, PostgreSQL/Supabase durable jobs, Jest 30, LINE Messaging API.

---

## Chunk 1: Reminder scheduling and delivery

### Task 1: Define the default reminder policy

**Files:**
- Modify: `config/index.js`
- Modify: `.env.example`
- Test: `tests/config.test.js`

- [x] Write a failing test that expects `REMINDER_OFFSETS` to default to `[1440]`.
- [x] Run the focused test and verify it fails with the current empty default.
- [x] Change the default to `1440`, retaining parsing, validation, deduplication, sorting, and the five-offset limit.
- [x] Run the focused test and verify it passes.

### Task 2: Schedule and cancel task reminder jobs

**Files:**
- Modify: `constants/jobs.js`
- Create: `services/task-reminder-scheduling.js`
- Test: `tests/services/task-reminder-scheduling.test.js`

- [x] Write failing tests for one-day lead plus at-time jobs, no-due tasks, past candidates, idempotency keys, and prefix cancellation.
- [x] Run the focused tests and verify the missing module/job kind failures.
- [x] Implement `TASK_REMINDER`, `scheduleTaskReminders`, and `cancelPendingTaskReminders` using the existing durable queue.
- [x] Run the focused tests and verify they pass.

### Task 3: Deliver task reminders through LINE

**Files:**
- Modify: `services/reminders.js`
- Modify: `services/worker.js`
- Test: `tests/services/reminders.test.js`
- Test: `tests/services/worker.test.js`

- [x] Write failing tests for task reminder text, complete quick action, delivered checkpoint, completed/deleted task skip, pause, quiet hours, stale jobs, and worker dispatch.
- [x] Run the focused tests and verify they fail before implementation.
- [x] Add `sendTaskReminder`, sharing the existing delivery safeguards without changing event reminder behavior.
- [x] Register the task reminder handler in the worker.
- [x] Run the focused tests and verify they pass.

## Chunk 2: Google-origin Calendar baseline and lifecycle

### Task 4: Expand the provider contract without changing OAuth scope

**Files:**
- Modify: `contracts/google-provider.js`
- Test: `tests/contracts/google-provider.test.js`

- [x] Write a failing contract test that allows Google-origin creation only for the supported primary/timed/non-recurring slice.
- [x] Verify the existing `calendar.events.owned` scope covers events on a user-owned primary calendar; do not request a broader scope.
- [x] Change `createFromGoogle` to the supported contract and keep all-day and recurrence exceptions false.
- [x] Run the focused test and verify it passes.

### Task 5: Import one supported Google event and schedule reminders atomically

**Files:**
- Modify: `repositories/events.js`
- Test: `tests/repositories/events.test.js`

- [x] Write failing tests for owner-scoped import, unique provider mapping, encrypted `channel_target`, one-day plus at-time scheduling, and no target/reminders-disabled behavior.
- [x] Run the focused tests and verify the missing import path fails.
- [x] Extend the row-locked inbound reconciliation to insert a missing Google-origin event with `sync_status='synced'`, `provider_updated_at`, and no outbound job.
- [x] Use `INSERT ... ON CONFLICT (owner_id, provider_event_id) DO NOTHING` so concurrent/retried inbound jobs cannot duplicate a mapping.
- [x] In the same transaction, load only that owner's encrypted `users.channel_target` and enqueue reminder jobs through `scheduleEventReminders`.
- [x] Run the focused tests and verify they pass.

### Task 6: Rebuild the baseline and reconcile incremental creates, edits, and deletes

**Files:**
- Modify: `services/google-calendar-inbound.js`
- Create: `db/migrations/0020_calendar_google_origin_baseline.sql`
- Create: `db/rollbacks/0020_calendar_google_origin_baseline.sql`
- Modify: `repositories/calendar-accounts.js`
- Modify: `services/runtime-preflight.js`
- Test: `tests/services/google-calendar-inbound.test.js`
- Test: `tests/repositories/calendar-accounts.test.js`
- Test: `tests/services/runtime-preflight.test.js`

- [x] Write failing tests proving the no-token baseline imports existing supported Google-origin events instead of only saving a cursor.
- [x] Write failing tests proving an incremental Google-origin create imports, a mapped edit reschedules, and a cancellation deletes the mapping and cancels jobs through the repository.
- [x] Write failing tests proving all-day, recurring series/instances, bot-managed unknown IDs, past events, and non-primary calendars are not imported.
- [x] Run the focused tests and verify the current managed-ID filter/baseline behavior fails.
- [x] Bump the Calendar inbound query version to 3 so existing connected accounts clear their v2 cursor and rebuild one baseline.
- [x] Add migration/rollback `0020` to move the DB default and existing cursor version between 2 and 3 and persist the inbound claim, generation/timeMin, and pageToken; update runtime preflight.
- [x] Process baseline and incremental pages with the same supported-event predicate. Preserve `singleEvents=false` so unbounded recurring series are never expanded, and limit each durable job to one page.
- [x] Keep managed `gpta...` events update-only: never import one without a local mapping, preventing a duplicate after an interrupted outbound create.
- [x] Fence all page mutations by an owner-exclusive claim. Fresh concurrent baselines no-op; stale takeover preserves the persisted generation/timeMin/pageToken and invalidates the old token.
- [x] Atomically checkpoint `nextPageToken` and enqueue a continuation. Save `nextSyncToken`, clean unseen `inbound_origin` rows, and release the claim only after the final page and local reconciliation succeed.
- [x] Limit local reconciliation concurrency to `DATABASE_POOL_MAX`, cap each page with `CALENDAR_INBOUND_PAGE_SIZE`, and backfill imported events missing reminder jobs.
- [x] Run the focused tests and verify they pass.

## Chunk 3: Task lifecycle integration

### Task 7: Keep reminder jobs consistent with task state

**Files:**
- Modify: `app/handlers/tasks.js`
- Modify: `repositories/tasks.js`
- Modify: `services/google-tasks-inbound.js`
- Test: `tests/app/handlers/tasks.test.js`
- Test: `tests/repositories/tasks.test.js`
- Test: `tests/services/google-tasks-inbound.test.js`

- [x] Write failing tests that creation and reopening schedule future due reminders, while completion, deletion, and Google inbound completion/deletion cancel them.
- [x] Run the focused tests and verify the new expectations fail.
- [x] Preserve the encrypted current LINE target when reminders are enabled.
- [x] Schedule after local create/reopen and cancel after local complete/delete.
- [x] Apply the same lifecycle reconciliation after mapped Google Tasks inbound changes.
- [x] Make local and inbound task mutation plus reminder cancellation/scheduling transactional, fence delivery by `taskVersion`, persist due-task timezone, and backfill existing future due tasks from Cron.
- [x] Run the focused tests and verify they pass.

## Chunk 4: Documentation and verification

### Task 8: Document behavior and operational boundaries

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `REVIEW.md`

- [x] Document the one-day default, at-time reminder, shared offsets, no-due behavior, LINE quota use, and Google-origin primary/timed/non-recurring contract.
- [x] State that the baseline imports future supported events, incremental updates/deletes reschedule/cancel, and all-day/recurrence/non-primary remain unsupported.
- [x] Update schema references from `0019` to `0020` and explain the one-time v3 cursor rebuild.
- [x] Record implementation status in the latest-only review without claiming production/manual acceptance.

### Task 9: Run the delivery gates

**Files:**
- Verify: all changed files

- [x] Run focused Jest suites.
- [x] Run `npx eslint .`.
- [x] Run `npm run test:module-load`.
- [x] Run `npm test -- --runInBand`.
- [x] Run `npm audit --audit-level=high`.
- [x] Self-review the diff for security, privacy, cancellation races, and documentation accuracy.
- [x] Verify the final change set before commit and push.
