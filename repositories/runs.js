import { query } from '../services/database.js';

/**
 * 開始一筆 run trace，回傳 run id。
 * @param {{ webhookEventId?: string|null, capability?: string|null, model?: string|null }} [params]
 * @returns {Promise<string>}
 */
export const startRun = async ({ webhookEventId = null, capability = null, model = null } = {}) => {
  const result = await query(
    `INSERT INTO runs (webhook_event_id, capability, model, status)
     VALUES ($1, $2, $3, 'started')
     RETURNING id`,
    [webhookEventId, capability, model],
  );
  return result.rows[0].id;
};

/**
 * 結束一筆 run trace，記錄狀態、耗時、模型與 token/成本。預設不保存完整對話內容或憑證。
 * @param {string} id
 * @param {{ status?: string, durationMs?: number|null, model?: string|null, promptTokens?: number|null, completionTokens?: number|null, costUsd?: number|null, error?: string|null }} [params]
 * @returns {Promise<void>}
 */
export const finishRun = async (id, {
  status = 'done',
  durationMs = null,
  model = null,
  promptTokens = null,
  completionTokens = null,
  costUsd = null,
  error = null,
} = {}) => {
  await query(
    `UPDATE runs
     SET status = $2,
         duration_ms = $3,
         model = COALESCE($4, model),
         prompt_tokens = $5,
         completion_tokens = $6,
         cost_usd = $7,
         error = $8
     WHERE id = $1`,
    [id, status, durationMs, model, promptTokens, completionTokens, costUsd, error],
  );
};

/**
 * 一次寫入一筆已完成的 run trace（給同步取得結果的 completion 用，省去 start+finish 兩次寫入）。
 * 只記 metadata：能力、模型、耗時、token、成本、狀態、錯誤訊息；不含對話內容或憑證。
 * @param {{ webhookEventId?: string|null, capability?: string|null, model?: string|null,
 *   durationMs?: number|null, promptTokens?: number|null, completionTokens?: number|null,
 *   costUsd?: number|null, status?: string, error?: string|null }} params
 * @returns {Promise<void>}
 */
export const insertCompletedRun = async ({
  webhookEventId = null,
  capability = null,
  model = null,
  durationMs = null,
  promptTokens = null,
  completionTokens = null,
  costUsd = null,
  status = 'done',
  error = null,
} = {}) => {
  await query(
    `INSERT INTO runs
       (webhook_event_id, capability, model, duration_ms,
        prompt_tokens, completion_tokens, cost_usd, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [webhookEventId, capability, model, durationMs, promptTokens, completionTokens, costUsd, status, error],
  );
};

export default { startRun, finishRun, insertCompletedRun };
