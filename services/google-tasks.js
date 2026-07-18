import config from '../config/index.js';
import { getCalendarAccount } from '../repositories/calendar-accounts.js';
import {
  getTaskForUpdate, markTaskSynced, markTaskSyncError,
} from '../repositories/tasks.js';
import { withTransaction } from './database.js';
import { enqueuePendingGoogleTasks } from './google-tasks-queue.js';
import {
  authorizedRequest, GOOGLE_TASKS_SCOPE, isGoogleOAuthConfigured,
} from './google-calendar.js';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

export const isGoogleTasksEnabled = () => Boolean(config.ENABLE_GOOGLE_TASKS && isGoogleOAuthConfigured());

/**
 * 帳號是否已授權 tasks scope。現有僅授權 Calendar 的使用者重新連結後才會有。
 * @param {string} ownerId
 * @returns {Promise<boolean>}
 */
export const hasTasksScope = async (ownerId) => {
  const account = await getCalendarAccount(ownerId);
  return Boolean(account?.scopes?.includes(GOOGLE_TASKS_SCOPE));
};

// Google Tasks 的 due 只保留日期（時間會被忽略）；精確時間仍由本機 task.due_at 保存。
const dueDate = (dueAt, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || config.SCHEDULE_DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(dueAt));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T00:00:00.000Z`;
};

const syncMarker = (taskId) => `[gpt-ai-assistant:${taskId}]`;

const taskBody = (task) => ({
  title: task.title,
  notes: [task.notes, syncMarker(task.id)].filter(Boolean).join('\n\n'),
  ...(task.due_at ? { due: dueDate(task.due_at, task.timezone) } : {}),
  status: task.status === 'done' ? 'completed' : 'needsAction',
});

const listPath = () => encodeURIComponent(config.GOOGLE_TASKS_LIST_ID);

// Tasks insert 不接受 client-specified id。以 notes 內的穩定標記找回「遠端已建立、
// 本機尚未寫入 provider id」的結果，避免結果不明確的 POST 重試建立重複任務。
const findTaskBySyncMarker = async (ownerId, task) => {
  const marker = syncMarker(task.id);
  const findPage = async (pageToken) => {
    const params = {
      maxResults: 100,
      showCompleted: true,
      showHidden: true,
      ...(task.created_at ? { updatedMin: new Date(task.created_at).toISOString() } : {}),
      ...(pageToken ? { pageToken } : {}),
    };
    const { response } = await authorizedRequest(ownerId, {
      method: 'GET',
      url: `${TASKS_API}/lists/${listPath()}/tasks`,
      params,
    });
    const match = (response.data?.items || []).find((item) => item.notes?.includes(marker));
    if (match) return match;
    return response.data?.nextPageToken ? findPage(response.data.nextPageToken) : null;
  };
  return findPage();
};

/**
 * upsert：無 provider id → insert 存 id；有 → patch（同步 title/due/status）。
 * @param {{ ownerId: string, taskId: string }} params
 * @returns {Promise<Object|null>}
 */
export const syncTaskToGoogle = async ({ ownerId, taskId }) => {
  let task;
  try {
    return await withTransaction(async (client) => {
      const executor = client.query.bind(client);
      task = await getTaskForUpdate(ownerId, taskId, executor);
      if (!task) return null;
      if (task.provider_task_id) {
        await authorizedRequest(ownerId, {
          method: 'PATCH',
          url: `${TASKS_API}/lists/${listPath()}/tasks/${encodeURIComponent(task.provider_task_id)}`,
          data: taskBody(task),
        });
        return markTaskSynced(ownerId, task.id, task.provider_task_id, executor);
      }
      const existing = await findTaskBySyncMarker(ownerId, task);
      if (existing?.id) {
        await authorizedRequest(ownerId, {
          method: 'PATCH',
          url: `${TASKS_API}/lists/${listPath()}/tasks/${encodeURIComponent(existing.id)}`,
          data: taskBody(task),
        });
        return markTaskSynced(ownerId, task.id, existing.id, executor);
      }
      const { response } = await authorizedRequest(ownerId, {
        method: 'POST',
        url: `${TASKS_API}/lists/${listPath()}/tasks`,
        data: taskBody(task),
      });
      return markTaskSynced(ownerId, task.id, response.data?.id ?? null, executor);
    });
  } catch (err) {
    const status = err.response?.status;
    const code = err.code || (status ? `google_${status}` : 'google_unavailable');
    if (task) await markTaskSyncError(ownerId, task.id, code);
    // 4xx（非 429）與未連結／未設定不重試；本機任務一律保留、不刪除。
    if (status && status < 500 && status !== 429) err.retryable = false;
    if (code === 'not_connected' || code === 'not_configured') err.retryable = false;
    throw err;
  }
};

/**
 * 刪除 Google Tasks 端的任務。404/410 視為已不存在。
 * @param {string} ownerId
 * @param {string} providerTaskId
 * @returns {Promise<boolean>}
 */
export const deleteGoogleTask = async (ownerId, providerTaskId) => {
  try {
    await authorizedRequest(ownerId, {
      method: 'DELETE',
      url: `${TASKS_API}/lists/${listPath()}/tasks/${encodeURIComponent(providerTaskId)}`,
    });
    return true;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 410) return false;
    throw err;
  }
};

export { enqueuePendingGoogleTasks } from './google-tasks-queue.js';

export default {
  isGoogleTasksEnabled,
  hasTasksScope,
  syncTaskToGoogle,
  deleteGoogleTask,
  enqueuePendingGoogleTasks,
};
