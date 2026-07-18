import * as rruleModule from 'rrule';
import config from '../config/index.js';
import { decryptJson } from './data-protection.js';
import { push } from './line.js';
import { getEvent } from '../repositories/events.js';
import { markJobDelivered, rescheduleJob } from '../repositories/jobs.js';
import { getUserById } from '../repositories/users.js';
import { scheduleEventReminders } from './reminder-scheduling.js';

const { RRule } = rruleModule.default ?? rruleModule;
const ALL_DAY_REMINDER_HOUR = 9;

/**
 * 依 recurrence 規則算出「currentIndex 那次 occurrence」的下一次開始時刻；超過 count／until 回 null。
 * 使用 rrule 的 RFC 5545 日曆規則，月底與閏年不會被 JavaScript Date overflow 推到錯誤日期。
 * 目前 event schema 未保存 TZID，故有 DST 的時區仍以 UTC wall-clock 展開；Google 端 RRULE 不受影響。
 * @param {{ freq: string, interval?: number|null, count?: number|null, until?: string|null }} recurrence
 * @param {string|Date} currentStart 目前這次 occurrence 的開始時刻
 * @param {number} currentIndex 目前 occurrence 的序號（0 起）
 * @returns {Date|null}
 */
export const nextOccurrence = (recurrence, currentStart, currentIndex = 0) => {
  if (!recurrence || !recurrence.freq) return null;
  if (recurrence.count != null && currentIndex + 1 >= recurrence.count) return null;
  const start = new Date(currentStart);
  if (Number.isNaN(start.getTime())) return null;
  const frequencies = {
    DAILY: RRule.DAILY,
    WEEKLY: RRule.WEEKLY,
    MONTHLY: RRule.MONTHLY,
    YEARLY: RRule.YEARLY,
  };
  const freq = frequencies[recurrence.freq];
  if (freq == null) return null;
  const until = recurrence.until == null ? null : new Date(recurrence.until);
  if (until && Number.isNaN(until.getTime())) return null;
  const rule = new RRule({
    freq,
    interval: recurrence.interval || 1,
    dtstart: start,
    ...(until ? { until } : {}),
  });
  return rule.after(start, false);
};

const timezoneParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
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

const timezoneOffset = (date, timezone) => {
  const parts = timezoneParts(date, timezone);
  const values = [
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
  ];
  const asUtc = Date.UTC(...values);
  return asUtc - date.getTime();
};

const localHourOnDate = (date, timezone, hour, plusDays = 0) => {
  const { year, month, day } = timezoneParts(date, timezone);
  const wallClock = Date.UTC(year, month - 1, day + plusDays, hour);
  let instant = new Date(wallClock - timezoneOffset(new Date(wallClock), timezone));
  instant = new Date(wallClock - timezoneOffset(instant, timezone));
  return instant;
};

/**
 * 若「現在」落在使用者的安靜時段內，回傳時段結束的 UTC 瞬間；否則回傳 null。
 * quietHours = { start, end }（當地整點小時 0–23），支援跨午夜（如 22–8）。
 * @returns {Date|null}
 */
export const quietHoursEnd = (now, timezone, quietHours) => {
  if (!quietHours) return null;
  const { start, end } = quietHours;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) return null;
  if (start < 0 || start > 23 || end < 0 || end > 23) return null;
  const { hour } = timezoneParts(now, timezone);
  const inQuiet = start < end
    ? (hour >= start && hour < end)
    : (hour >= start || hour < end); // 跨午夜
  if (!inQuiet) return null;
  // 跨午夜且現在在「入夜側」（hour >= start）時，時段結束落在隔天。
  const plusDays = start > end && hour >= start ? 1 : 0;
  return localHourOnDate(now, timezone, end, plusDays);
};

export const getDefaultReminderTime = (event) => {
  const start = new Date(event.start_at ?? event.start);
  if (Number.isNaN(start.getTime())) return null;
  if (event.all_day ?? event.allDay) {
    return localHourOnDate(
      start,
      event.timezone || 'Asia/Taipei',
      ALL_DAY_REMINDER_HOUR,
    );
  }
  return start;
};

const formatReminderTime = (event) => {
  const timezone = event.timezone || 'Asia/Taipei';
  const allDay = event.all_day === true;
  const formatted = new Intl.DateTimeFormat('zh-TW', {
    timeZone: timezone,
    dateStyle: 'medium',
    ...(allDay ? {} : { timeStyle: 'short' }),
  }).format(new Date(event.start_at));
  return `${formatted}${allDay ? '（整天）' : ''}`;
};

// 多重提醒的提前量標示：1440 的倍數→天、60 的倍數→小時，其餘→分鐘。
const formatLead = (minutes) => {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天前`;
  if (minutes % 60 === 0) return `${minutes / 60} 小時前`;
  return `${minutes} 分鐘前`;
};

const reminderMessage = (event, leadMinutes = null) => ({
  type: 'text',
  text: `行程提醒${leadMinutes ? `（${formatLead(leadMinutes)}）` : ''}\n${event.title}\n${formatReminderTime(event)}`,
  quickReply: {
    items: [{
      type: 'action',
      action: {
        type: 'postback',
        label: '標記完成',
        data: `完成行程 ${event.id}`,
        displayText: '完成行程',
      },
    }],
  },
});

const doNotRetry = (err) => Object.assign(err, { retryable: false });

export const sendLineReminder = async (job) => {
  if (job.delivered_at) return;
  const {
    ownerId, eventId, channelTarget, leadMinutes = null,
    occurrenceStart = null, occurrenceIndex = 0,
  } = job.payload;
  const event = await getEvent(ownerId, eventId);
  if (!event || event.status !== 'confirmed') return;

  // 週期行程：這次 occurrence 一領到就先把「下一個未來的 occurrence」排好（idempotencyKey 去重，
  // 重複執行安全）。放在 pause／過期／安靜時段之前，確保這次被跳過或延後也不會中斷整個系列；
  // 若因 worker 短暫中斷有數次 occurrence 已過期，向前追上排第一個未來的（上限 500 次防呆）。
  if (event.recurrence) {
    let cursor = occurrenceStart || event.start_at;
    let index = occurrenceIndex;
    let target = null;
    for (let i = 0; i < 500; i += 1) {
      const nextStart = nextOccurrence(event.recurrence, cursor, index);
      if (!nextStart) break;
      index += 1;
      cursor = nextStart.toISOString();
      const remindAt = getDefaultReminderTime({ ...event, start_at: cursor });
      if (remindAt && remindAt.getTime() > Date.now()) {
        target = { start: cursor, index, remindAt };
        break;
      }
    }
    if (target) {
      await scheduleEventReminders({
        ownerId,
        event,
        channelTarget,
        remindAt: target.remindAt,
        occurrenceStart: target.start,
        occurrenceIndex: target.index,
      });
    }
  }

  const user = await getUserById(ownerId);

  // 暫停：使用者主動關閉提醒——此次到點提醒直接跳過（不補發），job 標記完成。
  if (user?.reminders_paused) return;

  // 過期策略：worker 停機恢復後，晚太久的提醒已無意義，跳過不送。
  // 註：安靜時段延後會更新 run_at，因此延後過的提醒不會被誤判過期。
  const scheduledAt = new Date(job.run_at).getTime();
  if (Number.isFinite(scheduledAt)
    && Date.now() - scheduledAt > config.REMINDER_STALE_MINUTES * 60 * 1000) {
    return;
  }

  // 安靜時段：延後到時段結束再送（提醒有價值，只是此刻不打擾）。
  const timezone = event.timezone || user?.timezone || 'Asia/Taipei';
  const quietEnd = quietHoursEnd(new Date(), timezone, user?.quiet_hours);
  if (quietEnd) {
    await rescheduleJob(job.id, job.lease_token, quietEnd);
    return;
  }

  let target;
  try {
    target = decryptJson(channelTarget)?.id;
  } catch (err) {
    throw doNotRetry(err);
  }
  if (!target) throw doNotRetry(new Error('reminder delivery target is missing'));

  try {
    // 週期行程顯示「這次 occurrence」的時間，而非第一次的 start_at。
    const shown = occurrenceStart ? { ...event, start_at: occurrenceStart } : event;
    await push({
      to: target,
      messages: [reminderMessage(shown, leadMinutes)],
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
};

export default { getDefaultReminderTime, quietHoursEnd, sendLineReminder };
