import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { decryptJson } from './data-protection.js';
import { enqueueJob, markJobDelivered } from '../repositories/jobs.js';
import {
  claimDueWeatherSubscriptions,
  getSubscription,
  markSubscriptionDelivered,
} from '../repositories/subscriptions.js';
import { withTransaction } from './database.js';
import { push } from './line.js';
import { formatWeather, getWeatherByPlace } from './weather/index.js';

/**
 * 使用者時區下一個 hour:00 的 UTC 時刻；若今天該時刻已過則取明天。
 * 以目標日期重新求 offset，跨 DST 切換日仍維持相同當地鐘點。
 * @param {Date} now
 * @param {string} timezone
 * @param {number} hour
 * @returns {Date}
 */
export const nextWeatherRun = (now, timezone, hour) => {
  const zone = timezone || 'Asia/Taipei';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const toParts = (date) => {
    const parts = formatter.formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  };
  const local = toParts(now);
  const makeRun = (plusDays) => {
    const target = Date.UTC(local.year, local.month - 1, local.day + plusDays, hour, 0, 0);
    let instant = new Date(target);
    for (let i = 0; i < 3; i += 1) {
      const actual = toParts(instant);
      const actualWallClock = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
      instant = new Date(instant.getTime() + target - actualWallClock);
    }
    return instant;
  };
  const today = makeRun(0);
  return today > now ? today : makeRun(1);
};

const doNotRetry = (err) => Object.assign(err, { retryable: false });

/**
 * cron 每分鐘呼叫：原子挑出到期訂閱（推進 next_run_at）並入列 weather job。
 * claim 與 enqueue 在同一交易，job 入列成功才算推進；重用既有 queue／delivery，不另建 cron。
 * @param {{ now?: Date, limit?: number }} [opts]
 * @returns {Promise<{ claimed: number, queued: number }>}
 */
export const enqueueDueWeatherReminders = async ({
  now = new Date(), limit = config.WEATHER_DAILY_MAX_PER_RUN,
} = {}) => withTransaction(async (client) => {
  const due = await claimDueWeatherSubscriptions(now.toISOString(), limit, client.query.bind(client));
  const runDate = now.toISOString().slice(0, 10);
  let queued = 0;
  await Promise.all(due.map(async (sub) => {
    const user = await client.query('SELECT channel_target FROM users WHERE id = $1', [sub.owner_id]);
    const channelTarget = user.rows[0]?.channel_target;
    if (!channelTarget) return; // 沒有推送目標就跳過這次
    const job = await enqueueJob({
      kind: JOB_KINDS.WEATHER_DAILY,
      payload: { subscriptionId: sub.id, channelTarget },
      idempotencyKey: `weather-daily:${sub.id}:${runDate}`,
      maxAttempts: config.WORKER_MAX_ATTEMPTS,
    }, client.query.bind(client));
    if (job) queued += 1;
  }));
  return { claimed: due.length, queued };
});

/**
 * WEATHER_DAILY job handler：查訂閱地點天氣並 Push 給使用者。
 * 訂閱已停用則跳過（取消競態安全）；Push 冪等沿用 X-Line-Retry-Key。
 * @param {Object} job
 */
export const sendDailyWeather = async (job) => {
  if (job.delivered_at) return;
  const { subscriptionId, channelTarget } = job.payload;
  const sub = await getSubscription(subscriptionId);
  if (!sub || !sub.enabled) return; // 取消／停用：不推播、不重試

  let target;
  try {
    target = decryptJson(channelTarget)?.id;
  } catch (err) {
    throw doNotRetry(err);
  }
  if (!target) throw doNotRetry(new Error('weather push target is missing'));

  const value = await getWeatherByPlace({
    latitude: sub.latitude,
    longitude: sub.longitude,
    timezone: sub.timezone || 'auto',
    name: sub.location_label,
  });

  try {
    await push({
      to: target,
      messages: [{ type: 'text', text: `每日天氣\n${formatWeather(value)}` }],
      retryKey: job.id,
    });
  } catch (err) {
    const status = err.response?.status;
    if (status >= 400 && status < 500 && status !== 409 && status !== 429) {
      throw doNotRetry(err);
    }
    if (status !== 409) throw err;
  }
  await markJobDelivered(job.id, job.lease_token);
  await markSubscriptionDelivered(subscriptionId);
};

export default { nextWeatherRun, enqueueDueWeatherReminders, sendDailyWeather };
