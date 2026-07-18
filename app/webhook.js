import config from '../config/index.js';
import { enqueueWebhookEventOnce } from '../repositories/webhook-events.js';
import { JOB_KINDS } from '../services/worker.js';

/**
 * 登記並入列事件。6.0 durable-only runtime 不提供同步 fail-open：
 * 缺少 event id 或 DB 故障時拋錯，讓 webhook 回非 2xx 由 LINE 重送。
 * @param {Array<Object>} events
 * @returns {Promise<Array<never>>} always empty; no event may bypass the durable queue
 */
export const enqueueEvents = async (events = []) => {
  await Promise.all(events.map(async (event) => {
    if (!event.webhookEventId) throw new Error('webhookEventId is required for durable processing');
    await enqueueWebhookEventOnce({
      webhookEventId: event.webhookEventId,
      kind: JOB_KINDS.LINE_EVENT,
      payload: { event },
      // 重試現在是安全的：付費的 AI 工作由 services/worker.js 的 checkpoint 保證至多執行
      // 一次，重試只會重送——而重送同一個 reply token 不會產生重複訊息。
      // 「不重複付費」由 checkpoint 保證，不再靠 max_attempts=1。
      maxAttempts: config.WORKER_MAX_ATTEMPTS,
    });
  }));
  return [];
};

export default { enqueueEvents };
