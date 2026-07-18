import { withTransaction } from '../services/database.js';
import { decryptJson, encryptJson } from '../services/data-protection.js';

/**
 * 原子完成 webhook 冪等登記與 job 入列。
 * 如果是重複 event 回傳 null；任一寫入失敗會整筆 rollback，不會留下「已處理但沒有 job」。
 * @param {{ webhookEventId: string, kind: string, payload?: Object, maxAttempts?: number }} params
 * @returns {Promise<Object|null>}
 */
export const enqueueWebhookEventOnce = async ({
  webhookEventId, kind, payload = {}, maxAttempts = 5,
}) => withTransaction(async (client) => {
  const event = await client.query(
    `INSERT INTO processed_events (webhook_event_id)
     VALUES ($1)
     ON CONFLICT (webhook_event_id) DO NOTHING
     RETURNING webhook_event_id`,
    [webhookEventId],
  );
  if (event.rowCount === 0) return null;

  const job = await client.query(
    `INSERT INTO jobs (kind, payload, idempotency_key, max_attempts)
     VALUES ($1, $2::jsonb, $3, $4)
     RETURNING *`,
    [
      kind,
      JSON.stringify(encryptJson(payload ?? {})),
      `line-event:${webhookEventId}`,
      maxAttempts,
    ],
  );
  return { ...job.rows[0], payload: decryptJson(job.rows[0].payload) };
});

export default { enqueueWebhookEventOnce };
