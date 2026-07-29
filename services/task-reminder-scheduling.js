import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { enqueueJob } from '../repositories/jobs.js';
import { query, withTransaction } from './database.js';

const jobKey = (taskId, suffix, version) => (
  `task-reminder:${taskId}:${suffix}:${version}`
);

/**
 * Cancel every pending reminder for a task.
 * @param {string} taskId
 * @param {Function} [executor]
 */
export const cancelPendingTaskReminders = async (taskId, executor = query) => {
  await executor(
    `UPDATE jobs SET status = 'done', lease_until = null, lease_token = null, updated_at = now()
     WHERE status = 'pending' AND idempotency_key LIKE $1`,
    [`task-reminder:${taskId}:%`],
  );
};

/**
 * Schedule the due-time and configured lead reminders for an open task.
 * @param {{ ownerId: string, task: Object, channelTarget: Object, executor?: Function }} params
 * @returns {Promise<{ queued: number }>}
 */
export const scheduleTaskReminders = async ({
  ownerId, task, channelTarget, executor,
}) => {
  const dueAt = new Date(task.due_at ?? task.dueAt);
  if (task.status === 'done' || !Number.isFinite(dueAt.getTime())) return { queued: 0 };

  const candidates = [
    { leadMinutes: null, runAt: dueAt, suffix: 'due' },
    ...config.REMINDER_OFFSETS.map((leadMinutes) => ({
      leadMinutes,
      runAt: new Date(dueAt.getTime() - leadMinutes * 60 * 1000),
      suffix: `lead${leadMinutes}`,
    })),
  ].filter(({ runAt }) => runAt.getTime() > Date.now());

  const results = await Promise.all(candidates.map((candidate) => enqueueJob({
    kind: JOB_KINDS.TASK_REMINDER,
    payload: {
      ownerId,
      taskId: task.id,
      taskVersion: task.version,
      channelTarget,
      ...(candidate.leadMinutes == null ? {} : { leadMinutes: candidate.leadMinutes }),
    },
    runAt: candidate.runAt,
    idempotencyKey: jobKey(task.id, candidate.suffix, task.version),
    maxAttempts: config.WORKER_MAX_ATTEMPTS,
  }, executor)));

  return { queued: results.filter(Boolean).length };
};

export const backfillTaskReminders = async ({
  limit = Math.max(1, config.DATABASE_POOL_MAX * 20),
} = {}) => withTransaction(async (client) => {
  const rows = await client.query(
    `SELECT t.*, u.channel_target
     FROM tasks t
     JOIN users u ON u.id = t.owner_id
     WHERE t.status = 'open' AND t.due_at > now() AND u.channel_target IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.idempotency_key = 'task-reminder:' || t.id::text || ':due:' || t.version::text
       )
     ORDER BY t.due_at
     LIMIT $1
     FOR UPDATE OF t SKIP LOCKED`,
    [limit],
  );
  let scheduled = 0;
  for (const task of rows.rows) {
    // eslint-disable-next-line no-await-in-loop
    const result = await scheduleTaskReminders({
      ownerId: task.owner_id,
      task,
      channelTarget: task.channel_target,
      executor: client.query.bind(client),
    });
    if (result.queued > 0) scheduled += 1;
  }
  return { scheduled };
});

export default {
  backfillTaskReminders,
  cancelPendingTaskReminders,
  scheduleTaskReminders,
};
