import { createEvent, updateEvent } from './events.js';
import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { enqueueJob } from './jobs.js';
import { query, withTransaction } from '../services/database.js';
import { CONFIRMATION_ACTIONS, CONFIRMATION_STATES } from '../services/confirmation.js';
import { getDefaultReminderTime } from '../services/reminders.js';
import {
  cancelPendingEventReminders,
  scheduleEventReminders,
} from '../services/reminder-scheduling.js';

/**
 * @param {{ ownerId: string, token: string, draft: Object, expiresAt: string|Date }} params
 * @returns {Promise<Object>}
 */
export const createConfirmation = async ({
  ownerId,
  token,
  draft,
  expiresAt,
  operation = 'create',
  targetEventId = null,
  expectedVersion = null,
  missingFields = [],
}) => (
  withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO confirmations
         (owner_id, token, draft, expires_at, operation, target_event_id,
          expected_version, missing_fields)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::text[])
       RETURNING *`,
      [
        ownerId,
        token,
        JSON.stringify(draft),
        expiresAt,
        operation,
        targetEventId,
        expectedVersion,
        missingFields,
      ],
    );
    return result.rows[0];
  })
);

export const updateConfirmationDraft = async ({
  ownerId, token, draft, missingFields,
}) => (
  withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE confirmations
       SET draft = $3::jsonb, missing_fields = $4::text[], updated_at = now()
       WHERE owner_id = $1 AND token = $2 AND state = 'draft' AND expires_at > now()
       RETURNING *`,
      [ownerId, token, JSON.stringify(draft), missingFields],
    );
    return result.rows[0] || null;
  })
);

/**
 * 取得該 owner 最新一筆尚未確認且未過期的草稿；沒有則回傳 null。
 * 使用者直接回「確認」時，用這筆決定要 settle 哪個 token。
 * @param {string} ownerId
 * @returns {Promise<Object|null>}
 */
export const getLatestPendingConfirmation = async (ownerId) => {
  const result = await query(
    `SELECT * FROM confirmations
     WHERE owner_id = $1 AND state = 'draft' AND expires_at > now()
       AND cardinality(missing_fields) = 0
     ORDER BY created_at DESC
     LIMIT 1`,
    [ownerId],
  );
  return result.rows[0] || null;
};

export const getLatestPendingWorkflow = async (ownerId) => {
  const result = await query(
    `SELECT * FROM confirmations
     WHERE owner_id = $1 AND state = 'draft' AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [ownerId],
  );
  return result.rows[0] || null;
};

export const getLatestPendingClarification = async (ownerId) => {
  const result = await query(
    `SELECT * FROM confirmations
     WHERE owner_id = $1 AND state = 'draft' AND expires_at > now()
       AND cardinality(missing_fields) > 0
     ORDER BY created_at DESC
     LIMIT 1`,
    [ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 以 row lock 串行化同一 token 的併發確認；event 建立與狀態轉移在同一 transaction。
 * @param {{ ownerId: string, token: string, action: string, notificationTarget?: string|null }} params
 * @returns {Promise<{ state: string, changed: boolean, event: Object|null, syncQueued?: boolean, reminderQueued?: boolean }|null>}
 */
export const settleConfirmation = async ({
  ownerId, token, action, notificationTarget = null,
}) => (
  withTransaction(async (client) => {
    const selected = await client.query(
      `SELECT * FROM confirmations
       WHERE owner_id = $1 AND token = $2
       FOR UPDATE`,
      [ownerId, token],
    );
    const confirmation = selected.rows[0];
    if (!confirmation) return null;
    if (confirmation.state !== CONFIRMATION_STATES.DRAFT) {
      return { state: confirmation.state, changed: false, event: null };
    }

    if (new Date(confirmation.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE confirmations
         SET state = 'cancelled', updated_at = now()
         WHERE id = $1`,
        [confirmation.id],
      );
      return { state: CONFIRMATION_STATES.CANCELLED, changed: true, event: null };
    }

    if (action === CONFIRMATION_ACTIONS.CANCEL) {
      await client.query(
        `UPDATE confirmations
         SET state = 'cancelled', updated_at = now()
         WHERE id = $1`,
        [confirmation.id],
      );
      return { state: CONFIRMATION_STATES.CANCELLED, changed: true, event: null };
    }
    if (action !== CONFIRMATION_ACTIONS.CONFIRM) {
      return { state: CONFIRMATION_STATES.DRAFT, changed: false, event: null };
    }

    if ((confirmation.missing_fields || []).length > 0) {
      return { state: CONFIRMATION_STATES.DRAFT, changed: false, event: null };
    }

    const operation = confirmation.operation || 'create';
    let event;
    if (operation === 'update') {
      const selectedEvent = await client.query(
        `SELECT * FROM events
         WHERE id = $1 AND owner_id = $2 AND status = 'confirmed'
         FOR UPDATE`,
        [confirmation.target_event_id, ownerId],
      );
      const previousEvent = selectedEvent.rows[0] || null;
      if (!previousEvent || previousEvent.version !== confirmation.expected_version) {
        await client.query(
          `UPDATE confirmations SET state = 'cancelled', updated_at = now()
           WHERE id = $1`,
          [confirmation.id],
        );
        return {
          state: 'conflict', changed: false, event: null, operation,
        };
      }
      event = await updateEvent(ownerId, confirmation.target_event_id, confirmation.draft, {
        expectedVersion: confirmation.expected_version,
        executor: client.query.bind(client),
      });
      if (!event) {
        throw new Error('event version changed while applying confirmation');
      }
    } else {
      event = await createEvent(
        ownerId,
        confirmation.draft,
        client.query.bind(client),
      );
    }
    let syncQueued = false;
    if (config.ENABLE_GOOGLE_CALENDAR) {
      const account = await client.query(
        'SELECT 1 FROM calendar_accounts WHERE owner_id = $1',
        [ownerId],
      );
      if (account.rowCount > 0) {
        const job = await enqueueJob({
          kind: JOB_KINDS.GOOGLE_CALENDAR_SYNC,
          payload: { ownerId, eventId: event.id, notificationTarget },
          idempotencyKey: `google-calendar-sync:${event.id}:${event.version}`,
          maxAttempts: config.WORKER_MAX_ATTEMPTS,
        }, client.query.bind(client));
        syncQueued = Boolean(job);
      }
    }
    let reminderQueued = false;
    // 取消本事件所有既有的 pending 提醒 job（到點／lead／週期 occurrence 鏈），避免修改後殘留
    // 舊時刻或與新排程重複。idempotency_key 明文可比對；event.id 是 UUID，無 LIKE 特殊字元。
    await cancelPendingEventReminders(event.id, client.query.bind(client));
    const remindAt = getDefaultReminderTime(event);
    if (config.ENABLE_REMINDERS && remindAt && remindAt.getTime() > Date.now()) {
      const target = await client.query(
        'SELECT channel_target FROM users WHERE id = $1',
        [ownerId],
      );
      if (target.rows[0]?.channel_target) {
        const scheduled = await scheduleEventReminders({
          ownerId,
          event,
          channelTarget: target.rows[0].channel_target,
          remindAt,
          executor: client.query.bind(client),
        });
        if (scheduled.startJobId) {
          await client.query(
            'UPDATE events SET reminder_job_id = $2, updated_at = now() WHERE id = $1',
            [event.id, scheduled.startJobId],
          );
          event.reminder_job_id = scheduled.startJobId;
        }
        reminderQueued = scheduled.queued > 0;
      }
    }
    await client.query(
      `UPDATE confirmations
       SET state = 'confirmed', result_event_id = $2, updated_at = now()
       WHERE id = $1`,
      [confirmation.id, event.id],
    );
    const response = {
      state: CONFIRMATION_STATES.CONFIRMED,
      changed: true,
      event,
      syncQueued,
      reminderQueued,
    };
    if (operation === 'update') response.operation = operation;
    return response;
  })
);

export default {
  createConfirmation,
  getLatestPendingClarification,
  getLatestPendingConfirmation,
  getLatestPendingWorkflow,
  settleConfirmation,
  updateConfirmationDraft,
};
