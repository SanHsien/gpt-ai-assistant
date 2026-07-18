import { completeJob, retryOrFailJob } from '../repositories/jobs.js';

/**
 * 指數退避（含上限）。attempts 為「已嘗試次數」。
 * @param {number} attempts
 * @param {{ baseSeconds?: number, maxSeconds?: number }} [opts]
 * @returns {number}
 */
export const computeBackoffSeconds = (attempts, { baseSeconds = 5, maxSeconds = 3600 } = {}) => {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(baseSeconds * (2 ** exponent), maxSeconds);
};

/**
 * 執行單一 job：成功則標記完成；失敗則依 backoff 重試或進 dead-letter。
 * handler 丟錯不會外拋——worker 迴圈可持續處理下一個 job。
 * @param {Object} job 已領取的 job（含 id、attempts）
 * @param {(job: Object) => Promise<*>} handler
 * @returns {Promise<'done'|'pending'|'dead'|'stale'|null>}
 */
export const runJob = async (job, handler) => {
  try {
    await handler(job);
    return await completeJob(job.id, job.lease_token) ? 'done' : 'stale';
  } catch (err) {
    const backoffSeconds = computeBackoffSeconds(job.attempts);
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const status = await retryOrFailJob(job.id, {
      leaseToken: job.lease_token,
      error,
      backoffSeconds,
      // handler 可標記 `retryable = false`，代表重試沒有意義或會重複付費。
      retryable: err?.retryable !== false,
    });
    return status || 'stale';
  }
};

export default { computeBackoffSeconds, runJob };
