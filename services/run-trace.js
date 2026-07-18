import config from '../config/index.js';
import { isDatabaseConfigured } from './database.js';
import { finishRun, insertCompletedRun, startRun } from '../repositories/runs.js';

/**
 * 包一次能力執行並記錄 run trace（耗時、狀態、錯誤）。成功回傳結果；失敗記錄後原樣拋出。
 * 只記錄 metadata，不保存對話內容或憑證。
 * @param {{ webhookEventId?: string|null, capability?: string|null, model?: string|null }} meta
 * @param {() => Promise<*>} fn
 * @returns {Promise<*>}
 */
export const traceRun = async (meta, fn) => {
  const id = await startRun(meta);
  const startedAt = Date.now();
  try {
    const result = await fn();
    await finishRun(id, { status: 'done', durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    await finishRun(id, { status: 'error', durationMs: Date.now() - startedAt, error: err.message });
    throw err;
  }
};

/**
 * 依設定的每 1K token 單價估算成本；未設定價格或缺 usage 時回 null（只留 token 數）。
 * @param {{ prompt_tokens?: number, completion_tokens?: number }|null} usage
 * @returns {number|null}
 */
export const computeCostUsd = (usage) => {
  const promptPrice = config.OPENAI_PRICE_PER_1K_PROMPT;
  const completionPrice = config.OPENAI_PRICE_PER_1K_COMPLETION;
  if (promptPrice == null || completionPrice == null || !usage) return null;
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const cost = (prompt / 1000) * promptPrice + (completion / 1000) * completionPrice;
  return Math.round(cost * 1e6) / 1e6; // 對齊 numeric(12,6)
};

/**
 * 記錄一次 chat completion 的 run trace（能力／模型／token／成本／耗時／狀態）。
 * 觀測用途，絕不影響主流程：無 DB 時跳過，寫入失敗只記 log 不拋出。
 * 只記 metadata＋結構化 log，不含對話內容或憑證。
 * @param {{ webhookEventId?: string|null, capability?: string|null, model?: string|null,
 *   usage?: Object|null, durationMs?: number|null, status?: string, error?: string|null }} params
 * @returns {Promise<void>}
 */
export const recordCompletionRun = async ({
  webhookEventId = null,
  capability = null,
  model = null,
  usage = null,
  durationMs = null,
  status = 'done',
  error = null,
} = {}) => {
  const promptTokens = usage?.prompt_tokens ?? null;
  const completionTokens = usage?.completion_tokens ?? null;
  const costUsd = computeCostUsd(usage);
  // 結構化 log（單行 JSON，不含對話內容／憑證）。
  console.log(JSON.stringify({
    evt: 'run',
    capability,
    model,
    promptTokens,
    completionTokens,
    costUsd,
    durationMs,
    status,
  }));
  if (!isDatabaseConfigured()) return;
  try {
    await insertCompletedRun({
      webhookEventId,
      capability,
      model,
      durationMs,
      promptTokens,
      completionTokens,
      costUsd,
      status,
      error,
    });
  } catch (err) {
    console.error('run-trace insert failed:', err.message);
  }
};

export default { traceRun, computeCostUsd, recordCompletionRun };
