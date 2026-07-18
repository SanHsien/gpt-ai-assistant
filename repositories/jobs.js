import { query } from '../services/database.js';
import { decryptJson, encryptJson } from '../services/data-protection.js';

const decryptJob = (job) => (job ? {
  ...job,
  payload: decryptJson(job.payload),
  // checkpoint A：null 代表付費的 AI 工作還沒完成過。
  result: job.result ? decryptJson(job.result) : null,
} : null);

/**
 * 入列一個 job；有 idempotencyKey 時以唯一約束去重。
 * 回傳新建的 job；若因重複 idempotencyKey 未插入則回傳 null。
 * @param {{ kind: string, payload?: Object, runAt?: string|Date|null, idempotencyKey?: string|null, maxAttempts?: number|null }} params
 * @returns {Promise<Object|null>}
 */
export const enqueueJob = async ({
  kind, payload = {}, runAt = null, idempotencyKey = null, maxAttempts = null,
}, executor = query) => {
  const result = await executor(
    `INSERT INTO jobs (kind, payload, run_at, idempotency_key, max_attempts)
     VALUES ($1, $2::jsonb, COALESCE($3, now()), $4, COALESCE($5, 5))
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [kind, JSON.stringify(encryptJson(payload ?? {})), runAt, idempotencyKey, maxAttempts],
  );
  return decryptJob(result.rows[0]);
};

/**
 * 原子領取一個到期的 pending job，或租約已過期的 processing job；
 * `FOR UPDATE SKIP LOCKED` 確保多 worker 併發時同一 job 只被一個領走。
 * 領取即 attempts+1 並設定租約。回傳領到的 job，或 null（無可領）。
 * @param {{ leaseSeconds?: number, kinds?: string[]|null }} [opts]
 * @returns {Promise<Object|null>}
 */
export const claimNextJob = async ({ leaseSeconds = 60, kinds = null } = {}) => {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new Error('leaseSeconds must be a positive integer');
  }
  if (kinds !== null && (!Array.isArray(kinds) || kinds.length === 0)) {
    throw new Error('kinds must be null or a non-empty array');
  }
  const result = await query(
    `WITH exhausted AS (
       UPDATE jobs
       SET status = 'dead', lease_until = null, lease_token = null, updated_at = now()
       WHERE status = 'processing'
         AND lease_until <= now()
         AND attempts >= max_attempts
     )
     UPDATE jobs
     SET status = 'processing',
         lease_until = now() + make_interval(secs => $1::int),
         lease_token = gen_random_uuid(),
         attempts = attempts + 1,
         updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE ((status = 'pending' AND run_at <= now())
          OR (status = 'processing' AND lease_until <= now() AND attempts < max_attempts))
         AND ($2::text[] IS NULL OR kind = ANY($2::text[]))
       ORDER BY run_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [leaseSeconds, kinds],
  );
  return decryptJob(result.rows[0]);
};

/**
 * 標記 job 完成。
 * leaseToken 是 fencing token：舊 worker 租約過期後，不得覆寫新 worker 狀態。
 * @param {string} id
 * @param {string} leaseToken
 * @returns {Promise<boolean>}
 */
export const completeJob = async (id, leaseToken) => {
  const result = await query(
    `UPDATE jobs
     SET status = 'done', lease_until = null, lease_token = null, updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2`,
    [id, leaseToken],
  );
  return result.rowCount > 0;
};

// 部署與 migration 不會同時發生（Vercel 一 push 就部署）。新程式碼必須能在 0003 尚未套用的
// 資料庫上運作，否則空窗期內每則訊息都會失敗。缺欄位時回傳 null＝「這次沒有 checkpoint」，
// 呼叫端退回無 checkpoint 的行為，而不是把 job 打成失敗。
const UNDEFINED_COLUMN = '42703';

const withoutCheckpointColumns = (err) => {
  if (err?.code !== UNDEFINED_COLUMN) return false;
  console.warn('job checkpoint columns are missing; run migration 0003');
  return true;
};

/**
 * checkpoint A：記下 AI 產出的結果。有了它，重試就不會再跑一次付費工作。
 * 與 payload 同樣加密後才落庫。
 * @param {string} id
 * @param {string} leaseToken
 * @param {Object} result
 * @returns {Promise<boolean|null>} true=已寫入；false=租約已失效；null=DB 尚未有 checkpoint 欄位
 */
export const saveJobResult = async (id, leaseToken, result) => {
  try {
    const saved = await query(
      `UPDATE jobs
       SET result = $3::jsonb, updated_at = now()
       WHERE id = $1 AND status = 'processing' AND lease_token = $2`,
      [id, leaseToken, JSON.stringify(encryptJson(result ?? null))],
    );
    return saved.rowCount > 0;
  } catch (err) {
    if (withoutCheckpointColumns(err)) return null;
    throw err;
  }
};

/**
 * checkpoint B：記下已送達 LINE，重試不必也不該再送一次。
 * @param {string} id
 * @param {string} leaseToken
 * @returns {Promise<boolean|null>} null=DB 尚未有 checkpoint 欄位
 */
export const markJobDelivered = async (id, leaseToken) => {
  try {
    const delivered = await query(
      `UPDATE jobs
       SET delivered_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'processing' AND lease_token = $2 AND delivered_at IS NULL`,
      [id, leaseToken],
    );
    return delivered.rowCount > 0;
  } catch (err) {
    if (withoutCheckpointColumns(err)) return null;
    throw err;
  }
};

/**
 * 把 job 改回 pending 並延後到 runAt（非失敗路徑，attempts 不變）。
 * 安靜時段延後提醒用；租約失效時回 false（不覆寫他人狀態）。
 * @param {string} id
 * @param {string} leaseToken
 * @param {string|Date} runAt
 * @returns {Promise<boolean>}
 */
export const rescheduleJob = async (id, leaseToken, runAt) => {
  const result = await query(
    `UPDATE jobs
     SET status = 'pending', run_at = $3, lease_until = null, lease_token = null, updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $2`,
    [id, leaseToken, runAt],
  );
  return result.rowCount > 0;
};

/**
 * 失敗處理：未達 max_attempts 則排入 backoff 後重試（pending）；達上限則進 dead-letter（dead）。
 * `retryable=false` 代表這個失敗重試也沒有意義、或重試會重複付費，直接進 dead-letter。
 * 回傳結果狀態（'pending' 或 'dead'）。
 * @param {string} id
 * @param {{ leaseToken: string, error?: string, backoffSeconds?: number, retryable?: boolean }} opts
 * @returns {Promise<string|null>}
 */
export const retryOrFailJob = async (id, {
  leaseToken, error = null, backoffSeconds = 5, retryable = true,
}) => {
  const result = await query(
    `UPDATE jobs
     SET status = CASE WHEN NOT $5 OR attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
         run_at = CASE WHEN NOT $5 OR attempts >= max_attempts THEN run_at ELSE now() + make_interval(secs => $2) END,
         lease_until = null,
         lease_token = null,
         last_error = $3,
         updated_at = now()
     WHERE id = $1 AND status = 'processing' AND lease_token = $4
     RETURNING status`,
    [id, backoffSeconds, error, leaseToken, retryable],
  );
  return result.rows[0] ? result.rows[0].status : null;
};

export default {
  enqueueJob,
  claimNextJob,
  completeJob,
  retryOrFailJob,
  rescheduleJob,
  saveJobResult,
  markJobDelivered,
};
