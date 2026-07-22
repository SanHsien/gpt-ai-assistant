import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { decideCalendarInbound } from '../contracts/google-provider.js';
import { query, withTransaction } from '../services/database.js';
import { enqueueJob } from './jobs.js';
import {
  cancelPendingEventReminders,
  scheduleEventReminders,
} from '../services/reminder-scheduling.js';

// draft 已經過 schemas/event-draft.js 驗證與正規化。所有操作皆以 owner 界定範圍。
const draftParams = (draft) => [
  draft.title,
  draft.start,
  draft.end ?? null,
  draft.timezone ?? null,
  draft.allDay === true,
  draft.location ?? null,
  draft.notes ?? null,
  draft.recurrence ? JSON.stringify(draft.recurrence) : null,
];

/**
 * @param {string} ownerId
 * @param {Object} draft 已驗證的 event draft
 * @returns {Promise<Object>}
 */
export const createEvent = async (ownerId, draft, executor = query) => {
  const result = await executor(
    `INSERT INTO events
       (owner_id, title, start_at, end_at, timezone, all_day, location, notes, recurrence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [ownerId, ...draftParams(draft)],
  );
  return result.rows[0];
};

/**
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getEvent = async (ownerId, id, executor = query, forUpdate = false) => {
  const result = await executor(
    `SELECT * FROM events WHERE id = $1 AND owner_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, ownerId],
  );
  return result.rows[0] || null;
};

export const getEventByProviderId = async (ownerId, providerEventId) => {
  const result = await query(
    'SELECT * FROM events WHERE owner_id = $1 AND provider_event_id = $2',
    [ownerId, providerEventId],
  );
  return result.rows[0] || null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const getEventByReference = async (ownerId, reference) => {
  if (UUID_PATTERN.test(reference)) {
    const event = await getEvent(ownerId, reference);
    if (event) return event;
  }
  return getEventByProviderId(ownerId, reference);
};

/**
 * 完成／刪除與同步 worker 共用的列鎖入口。
 * @param {string} ownerId
 * @param {string} reference 本機 UUID 或 Google provider id
 * @param {Function} executor transaction client query
 * @returns {Promise<Object|null>}
 */
export const getEventByReferenceForUpdate = async (ownerId, reference, executor) => {
  const result = UUID_PATTERN.test(reference)
    ? await executor(
      'SELECT * FROM events WHERE owner_id = $1 AND id = $2 FOR UPDATE',
      [ownerId, reference],
    )
    : await executor(
      'SELECT * FROM events WHERE owner_id = $1 AND provider_event_id = $2 FOR UPDATE',
      [ownerId, reference],
    );
  return result.rows[0] || null;
};

/**
 * @param {string} ownerId
 * @param {{ from?: string|null, to?: string|null, limit?: number }} [range]
 * @returns {Promise<Array<Object>>}
 */
export const listEvents = async (ownerId, { from = null, to = null, limit = 50 } = {}) => {
  const result = await query(
    `SELECT * FROM events
     WHERE owner_id = $1
       AND status = 'confirmed'
       AND ($2::timestamptz IS NULL OR start_at >= $2)
       AND ($3::timestamptz IS NULL OR start_at <= $3)
     ORDER BY start_at
     LIMIT $4`,
    [ownerId, from, to, limit],
  );
  return result.rows;
};

export const listEventConflicts = async (
  ownerId,
  draft,
  { excludeEventId = null, limit = 3 } = {},
) => {
  const start = new Date(draft.start);
  const fallbackMs = draft.allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const end = draft.end || new Date(start.getTime() + fallbackMs).toISOString();
  const result = await query(
    `SELECT * FROM events
     WHERE owner_id = $1 AND status = 'confirmed'
       AND start_at < $3
       AND COALESCE(end_at, start_at + CASE WHEN all_day THEN interval '1 day' ELSE interval '1 hour' END) > $2
       AND ($4::uuid IS NULL OR id <> $4)
     ORDER BY start_at
     LIMIT $5`,
    [ownerId, draft.start, end, excludeEventId, limit],
  );
  return result.rows;
};

/**
 * 授權完成後回補尚未同步的未來行程。
 * @param {string} ownerId
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>}
 */
export const listUnsyncedEvents = async (ownerId, limit = 50) => {
  const result = await query(
    `SELECT * FROM events
     WHERE owner_id = $1 AND status = 'confirmed'
       AND sync_status = 'pending' AND start_at >= now()
     ORDER BY start_at
     LIMIT $2`,
    [ownerId, limit],
  );
  return result.rows;
};

/**
 * 列出該 owner 同步失敗但仍保留在本機的行程。
 * @param {string} ownerId
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>}
 */
export const listSyncFailedEvents = async (ownerId, limit = 6) => {
  const result = await query(
    `SELECT * FROM events
     WHERE owner_id = $1 AND status = 'confirmed' AND sync_status = 'error'
     ORDER BY updated_at DESC
     LIMIT $2`,
    [ownerId, limit],
  );
  return result.rows;
};

/**
 * 以單一 transaction 把失敗 event 轉為 pending 並排入新的重試週期。
 * `sync_status = 'error'` 是 compare-and-set 條件，併發重試只會有一個成功。
 * @param {{ ownerId: string, eventId: string, notificationTarget: string }} params
 * @returns {Promise<{ event: Object, job: Object|null }|null>}
 */
export const enqueueEventSyncRetry = async ({
  ownerId, eventId, notificationTarget,
}) => withTransaction(async (client) => {
  const updated = await client.query(
    `UPDATE events
     SET sync_status = 'pending', sync_error_code = null,
         version = version + 1, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND status = 'confirmed' AND sync_status = 'error'
     RETURNING *`,
    [eventId, ownerId],
  );
  const event = updated.rows[0];
  if (!event) return null;
  const job = await enqueueJob({
    kind: JOB_KINDS.GOOGLE_CALENDAR_SYNC,
    payload: { ownerId, eventId, notificationTarget },
    idempotencyKey: `google-calendar-sync:${eventId}:${event.version}:manual`,
    maxAttempts: config.WORKER_MAX_ATTEMPTS,
  }, client.query.bind(client));
  return { event, job };
});

export const markEventSynced = async (ownerId, id, providerEventId, executor = query) => {
  const result = await executor(
    `UPDATE events SET
       provider_event_id = $3, sync_status = 'synced', synced_at = now(),
       sync_error_code = null, updated_at = now()
     WHERE id = $1 AND owner_id = $2
     RETURNING *`,
    [id, ownerId, providerEventId],
  );
  return result.rows[0] || null;
};

export const markEventSyncError = async (ownerId, id, errorCode) => {
  const result = await query(
    `UPDATE events SET
       sync_status = 'error', sync_error_code = $3, updated_at = now()
     WHERE id = $1 AND owner_id = $2`,
    [id, ownerId, String(errorCode || 'unknown').slice(0, 100)],
  );
  return result.rowCount > 0;
};

const toMs = (value) => (value == null ? null : new Date(value).getTime());

// 反向 mapping 後的 draft 與本地事件列欄位是否一致（用來偵測「其實沒變」的自身 echo）。
const inboundFieldsEqual = (draft, event) => (
  draft.title === event.title
  && toMs(draft.start) === toMs(event.start_at)
  && toMs(draft.end ?? null) === toMs(event.end_at)
  && (draft.timezone ?? null) === (event.timezone ?? null)
  && (draft.allDay === true) === (event.all_day === true)
  && (draft.location ?? null) === (event.location ?? null)
  && (draft.notes ?? null) === (event.notes ?? null)
);

/**
 * Phase 5A inbound：套用 Google 端對「bot 建立的、非週期、有時刻」行程的外部修改。
 * 衝突政策（全在 FOR UPDATE 鎖內判斷）：
 *  - 找不到本地列／非 confirmed／有 recurrence → 不套用（本切片範圍外）。
 *  - 本地 sync_status ≠ 'synced'（使用者剛用 bot 改、outbound 未推）→ 不套用，讓 outbound 先贏。
 *  - Google updated ≤ 本地 provider_updated_at → 已吸收過（擋自身 echo 與重複輪詢）。
 *  - 欄位與本地相同 → 只推進 provider_updated_at，不重排提醒。
 * 套用時設 sync_status='synced'（不觸發 outbound，防迴圈），並取消舊提醒、依新開始時間重排。
 *
 * @param {{ ownerId: string, providerEventId: string, draft: Object,
 *   providerUpdatedAt: string|null, remindAt: Date|null, remindersEnabled: boolean }} params
 * @returns {Promise<{ applied: boolean, reason?: string, event?: Object }>}
 */
export const applyInboundEventUpdate = async ({
  ownerId, providerEventId, draft, providerUpdatedAt, remindAt, remindersEnabled,
}) => withTransaction(async (client) => {
  const current = await client.query(
    'SELECT * FROM events WHERE owner_id = $1 AND provider_event_id = $2 FOR UPDATE',
    [ownerId, providerEventId],
  );
  const event = current.rows[0];
  const decision = decideCalendarInbound({ event, providerUpdatedAt });
  if (decision !== 'apply') return { applied: false, reason: decision };

  // Google 對已有 offset 的 timed event 可能省略 start.timeZone；此時保留本機原時區，
  // 避免一次外部改名就把 Asia/Taipei 等顯示語意清空。
  const effectiveDraft = draft.timezone == null && event.timezone
    ? { ...draft, timezone: event.timezone }
    : draft;

  const incoming = toMs(providerUpdatedAt);

  if (inboundFieldsEqual(effectiveDraft, event)) {
    if (incoming != null) {
      await client.query(
        'UPDATE events SET provider_updated_at = $3, updated_at = now() WHERE owner_id = $1 AND id = $2',
        [ownerId, event.id, providerUpdatedAt],
      );
    }
    return { applied: false, reason: 'no_change' };
  }

  const updatedRow = await client.query(
    `UPDATE events SET
       title = $3, start_at = $4, end_at = $5, timezone = $6, all_day = $7,
       location = $8, notes = $9,
       sync_status = 'synced', synced_at = now(), sync_error_code = null,
       provider_updated_at = $10, version = version + 1, updated_at = now()
     WHERE owner_id = $1 AND id = $2
     RETURNING *`,
    [
      ownerId, event.id, effectiveDraft.title, effectiveDraft.start, effectiveDraft.end ?? null,
      effectiveDraft.timezone ?? null, effectiveDraft.allDay === true,
      effectiveDraft.location ?? null, effectiveDraft.notes ?? null, providerUpdatedAt ?? null,
    ],
  );
  const updated = updatedRow.rows[0];

  // 取消舊提醒（外部改了開始時間，舊排程失效）。
  await cancelPendingEventReminders(event.id, client.query.bind(client));

  // 依新開始時間重排提醒（沿用 outbound 相同的 idempotencyKey 版本粒度與 payload）。
  let reminderJobId = null;
  if (remindersEnabled && remindAt && remindAt.getTime() > Date.now()) {
    const target = await client.query(
      'SELECT channel_target FROM users WHERE id = $1',
      [ownerId],
    );
    if (target.rows[0]?.channel_target) {
      const scheduled = await scheduleEventReminders({
        ownerId,
        event: updated,
        channelTarget: target.rows[0].channel_target,
        remindAt,
        executor: client.query.bind(client),
      });
      reminderJobId = scheduled.startJobId;
    }
  }
  await client.query(
    'UPDATE events SET reminder_job_id = $3, updated_at = now() WHERE owner_id = $1 AND id = $2',
    [ownerId, event.id, reminderJobId],
  );
  updated.reminder_job_id = reminderJobId;
  return { applied: true, event: updated };
});

const completeEventScoped = async (ownerId, id, providerEventId, executor = query) => {
  const result = await executor(
    `WITH completed AS (
       UPDATE events
       SET status = 'completed', completed_at = now(), updated_at = now()
       WHERE owner_id = $1 AND status = 'confirmed'
         AND (($2::uuid IS NOT NULL AND id = $2) OR ($3::text IS NOT NULL AND provider_event_id = $3))
       RETURNING *
     ), cancelled_reminders AS (
       UPDATE jobs
       SET status = 'done', lease_until = null, lease_token = null, updated_at = now()
       WHERE status = 'pending'
         AND idempotency_key LIKE 'line-reminder:' || (SELECT id::text FROM completed) || ':%'
     )
     SELECT * FROM completed`,
    [ownerId, id, providerEventId],
  );
  return result.rows[0] || null;
};

export const completeEvent = (ownerId, id, executor = query) => (
  completeEventScoped(ownerId, id, null, executor)
);

export const completeEventByProviderId = (ownerId, providerEventId) => (
  completeEventScoped(ownerId, null, providerEventId)
);

/**
 * @param {string} ownerId
 * @param {string} id
 * @param {Object} draft 已驗證的 event draft
 * @param {{ expectedVersion?: number|null }} [options]
 * @returns {Promise<Object|null>}
 */
export const updateEvent = async (
  ownerId,
  id,
  draft,
  { expectedVersion = null, executor = query } = {},
) => {
  const result = await executor(
    `UPDATE events SET
       title = $3, start_at = $4, end_at = $5, timezone = $6, all_day = $7,
       location = $8, notes = $9, recurrence = $10::jsonb,
       sync_status = 'pending', synced_at = null, sync_error_code = null,
       reminder_job_id = null,
       version = version + 1, updated_at = now()
     WHERE id = $1 AND owner_id = $2
       AND ($11::integer IS NULL OR version = $11)
     RETURNING *`,
    [id, ownerId, ...draftParams(draft), expectedVersion],
  );
  return result.rows[0] || null;
};

/**
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} 是否有刪到（找不到或非本人回 false）
 */
const deleteEventScoped = async (ownerId, id, providerEventId, executor = query) => {
  const result = await executor(
    `WITH deleted AS (
       DELETE FROM events
       WHERE owner_id = $1
         AND (($2::uuid IS NOT NULL AND id = $2)
           OR ($3::text IS NOT NULL AND provider_event_id = $3))
       RETURNING id
     ), cancelled_reminders AS (
       UPDATE jobs
       SET status = 'done', lease_until = null, lease_token = null, updated_at = now()
       WHERE status = 'pending'
         AND EXISTS (
           SELECT 1 FROM deleted
           WHERE jobs.idempotency_key LIKE 'line-reminder:' || deleted.id::text || ':%'
         )
     )
     SELECT id FROM deleted`,
    [ownerId, id, providerEventId],
  );
  return result.rowCount > 0;
};

export const deleteEvent = (ownerId, id, executor = query) => (
  deleteEventScoped(ownerId, id, null, executor)
);

export const deleteEventByProviderId = (ownerId, providerEventId, executor = query) => (
  deleteEventScoped(ownerId, null, providerEventId, executor)
);

export default {
  applyInboundEventUpdate,
  createEvent,
  completeEvent,
  completeEventByProviderId,
  deleteEvent,
  deleteEventByProviderId,
  enqueueEventSyncRetry,
  getEvent,
  getEventByReference,
  getEventByReferenceForUpdate,
  getEventByProviderId,
  listEvents,
  listEventConflicts,
  listSyncFailedEvents,
  listUnsyncedEvents,
  markEventSynced,
  markEventSyncError,
  updateEvent,
};
