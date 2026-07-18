import { t } from '../locales/index.js';
import { getEvent } from '../repositories/events.js';
import { markJobDelivered } from '../repositories/jobs.js';
import { push } from './line.js';

const formatEventTime = (event) => {
  const timezone = event.timezone || 'Asia/Taipei';
  const allDay = event.all_day === true;
  const formatted = new Intl.DateTimeFormat('zh-TW', {
    timeZone: timezone,
    dateStyle: 'medium',
    ...(allDay ? {} : { timeStyle: 'short' }),
  }).format(new Date(event.start_at));
  return `${formatted}${allDay ? `（${t('__TEXT_SCHEDULE_ALL_DAY')}）` : ''}`;
};

const quickReplyItem = (label, data) => ({
  type: 'action',
  action: {
    type: 'postback', label, data, displayText: label,
  },
});

const statusMessage = (event, status) => {
  const header = status === 'success'
    ? t('__TEXT_GOOGLE_CALENDAR_SYNCED')
    : t('__TEXT_GOOGLE_CALENDAR_SYNC_FAILED');
  const message = {
    type: 'text',
    text: `${header}\n${event.title}\n${formatEventTime(event)}`,
  };
  if (status === 'failure') {
    message.text += `\n${t('__TEXT_SCHEDULE_SYNC_DISMISSED')}`;
    message.quickReply = {
      items: [
        quickReplyItem(
          t('__COMMAND_BOT_SCHEDULE_SYNC_RETRY_LABEL'),
          `${t('__COMMAND_BOT_SCHEDULE_SYNC_RETRY_TEXT')} ${event.id}`,
        ),
        quickReplyItem(
          t('__COMMAND_BOT_SCHEDULE_SYNC_DISMISS_LABEL'),
          `${t('__COMMAND_BOT_SCHEDULE_SYNC_DISMISS_TEXT')} ${event.id}`,
        ),
        quickReplyItem(
          t('__LABEL_SCHEDULE_DELETE_EVENT'),
          `${t('__COMMAND_BOT_SCHEDULE_DELETE_TEXT')} ${event.id}`,
        ),
      ],
    };
  }
  return message;
};

const doNotRetry = (err) => Object.assign(err, { retryable: false });

/**
 * 用 LINE Push 送出 Google Calendar 同步最終結果。X-Line-Retry-Key 與
 * delivered_at checkpoint 共同防止 worker 重試造成重複通知。
 * @param {Object} job
 * @returns {Promise<void>}
 */
export const sendGoogleCalendarStatus = async (job) => {
  if (job.delivered_at) return;
  const {
    ownerId, eventId, notificationTarget, status,
  } = job.payload;
  if (!notificationTarget) return;
  if (!['success', 'failure'].includes(status)) {
    throw doNotRetry(new Error('invalid Google Calendar status payload'));
  }
  const event = await getEvent(ownerId, eventId);
  if (!event) return;
  // 過時的失敗通知不得覆蓋後來已成功的手動重試。
  if (status === 'failure' && event.sync_status === 'synced') return;

  try {
    await push({
      to: notificationTarget,
      messages: [statusMessage(event, status)],
      retryKey: job.id,
    });
  } catch (err) {
    const httpStatus = err.response?.status;
    if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 409 && httpStatus !== 429) {
      throw doNotRetry(err);
    }
    if (httpStatus !== 409) throw err;
  }
  await markJobDelivered(job.id, job.lease_token);
};

export default { sendGoogleCalendarStatus };
