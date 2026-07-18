import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { enqueueJob } from '../repositories/jobs.js';
import {
  claimAccountsForTasksInbound,
  completeTasksInboundClaim,
  getCalendarAccount,
} from '../repositories/calendar-accounts.js';
import { applyInboundTaskUpdate } from '../repositories/tasks.js';
import { withTransaction } from './database.js';
import { authorizedRequest, GOOGLE_TASKS_SCOPE, isGoogleOAuthConfigured } from './google-calendar.js';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const listPath = () => encodeURIComponent(config.GOOGLE_TASKS_LIST_ID);

/**
 * 從 Google Tasks 拉增量變更（updatedMin 輪詢，Google Tasks 無 sync token）。
 * 只回收「bot 建立」（本地有 provider_task_id 對應）任務的：完成／重開、刪除、標題、備註；
 * 不同步 due（見 applyInboundTaskUpdate）。首拉（updatedMin 為 null）會過所有任務但只動有本地對應者。
 * @param {string} ownerId
 * @param {string|null} updatedMin RFC3339；上次輪詢時刻
 * @returns {Promise<{ changed: number }>}
 */
export const pullTaskChanges = async (ownerId, updatedMin = null) => {
  // 未連結或未授權 tasks scope 就跳過（避免無謂 API 呼叫與錯誤）。
  const account = await getCalendarAccount(ownerId);
  if (!account || !account.scopes?.includes(GOOGLE_TASKS_SCOPE)) return { changed: 0 };

  let pageToken;
  let changed = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const { response } = await authorizedRequest(ownerId, {
      method: 'GET',
      url: `${TASKS_API}/lists/${listPath()}/tasks`,
      params: {
        maxResults: 100,
        showCompleted: true,
        showHidden: true,
        showDeleted: true,
        ...(updatedMin ? { updatedMin } : {}),
        ...(pageToken ? { pageToken } : {}),
      },
    });
    const data = response.data || {};
    const items = (data.items || []).filter((item) => item.id);
    // eslint-disable-next-line no-await-in-loop
    const flags = await Promise.all(items.map((item) => applyInboundTaskUpdate({
      ownerId,
      providerTaskId: item.id,
      incoming: {
        deleted: item.deleted === true,
        status: item.status,
        title: item.title,
        notes: item.notes ?? null,
      },
    })));
    changed += flags.filter((r) => r.applied).length;
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { changed };
};

/**
 * cron 每分鐘呼叫：原子挑「該輪詢」的帳號（節流 TASKS_INBOUND_INTERVAL 秒），入列 inbound job。
 * claim 推進 tasks_last_pulled_at 並回傳前次水位當 updatedMin，放進 job payload 供失敗重試沿用同窗。
 * @param {{ now?: Date, limit?: number, intervalSeconds?: number }} [opts]
 * @returns {Promise<{ claimed: number, queued: number }>}
 */
export const enqueueDueTasksInbound = async ({
  now = new Date(),
  limit = config.TASKS_INBOUND_MAX_PER_RUN,
  intervalSeconds = config.TASKS_INBOUND_INTERVAL,
} = {}) => withTransaction(async (client) => {
  const cutoff = new Date(now.getTime() - intervalSeconds * 1000).toISOString();
  const claimedAt = now.toISOString();
  const accounts = await claimAccountsForTasksInbound(
    cutoff,
    limit,
    claimedAt,
    client.query.bind(client),
  );
  let queued = 0;
  await Promise.all(accounts.map(async ({ owner_id: ownerId, prev, claimed_at: claimTime }) => {
    const claim = new Date(claimTime || claimedAt).toISOString();
    const job = await enqueueJob({
      kind: JOB_KINDS.GOOGLE_TASKS_INBOUND,
      payload: {
        ownerId,
        updatedMin: prev ? new Date(prev).toISOString() : null,
        claimedAt: claim,
      },
      idempotencyKey: `google-tasks-inbound:${ownerId}:${claim}`,
      maxAttempts: config.WORKER_MAX_ATTEMPTS,
    }, client.query.bind(client));
    if (job) queued += 1;
  }));
  return { claimed: accounts.length, queued };
});

/**
 * GOOGLE_TASKS_INBOUND job handler：拉一次該帳號的 Google Tasks 變更。
 * @param {Object} job
 */
export const handleTasksInbound = async (job) => {
  if (!isGoogleOAuthConfigured()) return;
  const { ownerId, updatedMin, claimedAt } = job.payload || {};
  if (!ownerId) return;
  await pullTaskChanges(ownerId, updatedMin ?? null);
  if (claimedAt) await completeTasksInboundClaim(ownerId, claimedAt);
};

export default { pullTaskChanges, enqueueDueTasksInbound, handleTasksInbound };
