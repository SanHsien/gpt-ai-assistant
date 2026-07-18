import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { enqueueJob } from '../repositories/jobs.js';
import { listUnsyncedTasks } from '../repositories/tasks.js';

/**
 * 授權後回補既有未同步任務；與 OAuth callback 分離，避免 Calendar／Tasks 循環依賴。
 * @param {string} ownerId
 * @returns {Promise<number>}
 */
export const enqueuePendingGoogleTasks = async (ownerId) => {
  const tasks = await listUnsyncedTasks(ownerId);
  await Promise.all(tasks.map((task) => enqueueJob({
    kind: JOB_KINDS.GOOGLE_TASKS_SYNC,
    payload: { ownerId, taskId: task.id, action: 'upsert' },
    idempotencyKey: `google-tasks-sync:${task.id}:${task.version}:upsert`,
    maxAttempts: config.WORKER_MAX_ATTEMPTS,
  })));
  return tasks.length;
};

export default { enqueuePendingGoogleTasks };
