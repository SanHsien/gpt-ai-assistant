import { prepareEvents } from '../app/app.js';
import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import {
  claimNextJob, enqueueJob, markJobDelivered, saveJobResult,
} from '../repositories/jobs.js';
import { replyMessage } from '../utils/index.js';
import { runJob } from './jobs.js';
import { syncGoogleCalendarEvent } from './google-calendar.js';
import { sendGoogleCalendarStatus } from './google-calendar-status.js';
import { sendLineReminder } from './reminders.js';
import { sendDailyWeather } from './weather-subscription.js';
import { deleteGoogleTask, syncTaskToGoogle } from './google-tasks.js';
import { handleCalendarInbound } from './google-calendar-inbound.js';
import { handleTasksInbound } from './google-tasks-inbound.js';

export { JOB_KINDS };

const handleGoogleTasksSync = async (job) => {
  const {
    ownerId, taskId, action, providerTaskId,
  } = job.payload;
  if (action === 'delete') {
    await deleteGoogleTask(ownerId, providerTaskId);
    return;
  }
  await syncTaskToGoogle({ ownerId, taskId });
};

/**
 * 標記成「重試也沒有意義，或重試會重複付費」——直接進 dead-letter。
 */
const doNotRetry = (err) => Object.assign(err, { retryable: false });

/**
 * 兩個 durable checkpoint 把付費工作與送達拆開：
 *
 * - `job.result`（checkpoint A）有值 = AI 已完成。重試只需重送，不再花錢。
 * - `job.delivered_at`（checkpoint B）有值 = 已送達。重試不再送。
 *
 * 由此得到的語意是 **AI 至多執行一次、送達可重試多次**：
 *
 * - 送達可安全重試，是因為 LINE 的 reply token 只能用一次——用同一個 token 重送不會
 *   產生重複訊息（LINE 會直接拒絕）。所以我們一律不改用計額度的 push。
 * - AI 不可重跑：函式被砍在 AI 階段時不會拋錯，job 會在租約過期後被重新領取；此時
 *   `attempts > 1` 而 `result` 仍是空的，就代表上一次死在 AI 階段——重跑會再付一次錢，
 *   因此直接進 dead-letter。
 */
const handleLineEvent = async (job) => {
  let { result } = job;

  if (!result) {
    if (job.attempts > 1) {
      throw doNotRetry(new Error('AI phase was already attempted; refusing to repeat paid work'));
    }
    let context;
    try {
      [context] = await prepareEvents([job.payload.event]);
    } catch (err) {
      throw doNotRetry(err);
    }
    result = context
      ? { id: context.id, replyToken: context.replyToken, messages: context.messages }
      : null;
    // 先 checkpoint 再送出。反過來的話，送出後才崩潰就得重跑一次 AI。
    // null = DB 還沒套用 migration 0003；此時沒有 checkpoint 可存，但 AI 至多執行一次
    // 仍由上面的 attempts 守門，所以照常送出即可。
    const saved = await saveJobResult(job.id, job.lease_token, result);
    if (saved === false) {
      throw doNotRetry(new Error('lease lost before the AI result could be checkpointed'));
    }
  }

  if (!result) return; // 這個事件沒有要回的話（例如 follow、非訊息事件）
  if (job.delivered_at) return; // checkpoint B：已送達

  try {
    await replyMessage(result, { allowPushFallback: false });
  } catch (err) {
    // reply token 失效／已使用會回 4xx，重送同一個 token 不會成功；429（限流）才值得重試。
    const status = err.response?.status;
    if (status >= 400 && status < 500 && status !== 429) throw doNotRetry(err);
    throw err;
  }
  await markJobDelivered(job.id, job.lease_token);
};

const enqueueGoogleCalendarStatus = (job, status) => enqueueJob({
  kind: JOB_KINDS.GOOGLE_CALENDAR_STATUS,
  payload: {
    ownerId: job.payload.ownerId,
    eventId: job.payload.eventId,
    notificationTarget: job.payload.notificationTarget,
    status,
  },
  idempotencyKey: `google-calendar-status:${job.id}:${status}`,
  maxAttempts: config.WORKER_MAX_ATTEMPTS,
});

const handleGoogleCalendarSync = async (job) => {
  try {
    const event = await syncGoogleCalendarEvent(job.payload);
    if (event && job.payload.notificationTarget) {
      await enqueueGoogleCalendarStatus(job, 'success');
    }
  } catch (err) {
    const finalAttempt = job.attempts >= job.max_attempts;
    if (job.payload.notificationTarget && (finalAttempt || err?.retryable === false)) {
      await enqueueGoogleCalendarStatus(job, 'failure');
    }
    throw err;
  }
};

const jobHandlers = Object.freeze({
  [JOB_KINDS.LINE_EVENT]: handleLineEvent,
  [JOB_KINDS.GOOGLE_CALENDAR_SYNC]: handleGoogleCalendarSync,
  [JOB_KINDS.GOOGLE_CALENDAR_STATUS]: sendGoogleCalendarStatus,
  [JOB_KINDS.LINE_REMINDER]: sendLineReminder,
  [JOB_KINDS.WEATHER_DAILY]: sendDailyWeather,
  [JOB_KINDS.GOOGLE_TASKS_SYNC]: handleGoogleTasksSync,
  [JOB_KINDS.GOOGLE_CALENDAR_INBOUND]: handleCalendarInbound,
  [JOB_KINDS.GOOGLE_TASKS_INBOUND]: handleTasksInbound,
});

/**
 * @param {Object} job 已領取的 job
 * @returns {Promise<*>}
 */
export const handleJob = async (job) => {
  const handler = jobHandlers[job.kind];
  if (!handler) throw doNotRetry(new Error(`unknown job kind: ${job.kind}`));
  return handler(job);
};

/**
 * 逐一領取並執行到期的 job，直到沒得領或達 maxJobs。
 * 任一 job 失敗都由 runJob 收斂成重試／dead-letter，不會中斷整個 drain。
 * @param {{ maxJobs?: number, leaseSeconds?: number, kinds?: string[]|null }} [opts]
 * @returns {Promise<{ claimed: number, done: number, retried: number, dead: number, stale: number }>}
 */
export const drainQueue = async ({
  maxJobs = config.WORKER_MAX_JOBS,
  leaseSeconds = config.WORKER_LEASE_SECONDS,
  kinds = null,
} = {}) => {
  const summary = {
    claimed: 0, done: 0, retried: 0, dead: 0, stale: 0,
  };
  for (let i = 0; i < maxJobs; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const job = await claimNextJob({ leaseSeconds, kinds });
    if (!job) break;
    summary.claimed += 1;
    // eslint-disable-next-line no-await-in-loop
    const status = await runJob(job, handleJob);
    if (status === 'done') summary.done += 1;
    else if (status === 'pending') summary.retried += 1;
    else if (status === 'dead') summary.dead += 1;
    else summary.stale += 1;
  }
  return summary;
};

export default { JOB_KINDS, handleJob, drainQueue };
