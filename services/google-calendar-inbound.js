import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { enqueueJob } from '../repositories/jobs.js';
import {
  claimAccountsForInbound,
  getCalendarAccount,
  saveSyncToken,
} from '../repositories/calendar-accounts.js';
import { applyInboundEventUpdate, deleteEventByProviderId } from '../repositories/events.js';
import { validateEventDraft } from '../schemas/event-draft.js';
import { withTransaction } from './database.js';
import { authorizedRequest } from './google-calendar.js';
import { getDefaultReminderTime } from './reminders.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * Google Calendar event → 本地 event draft（反向 toGoogleEvent）。
 * 本切片只吃「非週期、有時刻（timed）」行程；all-day、週期、缺 summary／dateTime 一律回 null 跳過
 * （回收由刪除切片負責，all-day／週期 round-trip 留待後續）。
 * @param {Object} item Google events.list 項目
 * @returns {Object|null} 已通過 validateEventDraft 的 draft，或 null（不處理）
 */
export const fromGoogleEvent = (item) => {
  if (!item || item.status === 'cancelled') return null;
  if (Array.isArray(item.recurrence) && item.recurrence.length > 0) return null;
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  if (!summary) return null;
  const startDateTime = item.start?.dateTime;
  if (!startDateTime) return null; // all-day（只有 date）或無起始 → 跳過
  const raw = {
    title: summary,
    start: startDateTime,
    ...(item.end?.dateTime ? { end: item.end.dateTime } : {}),
    ...(item.start?.timeZone ? { timezone: item.start.timeZone } : {}),
    ...(item.location ? { location: item.location } : {}),
    ...(item.description ? { notes: item.description } : {}),
  };
  const { valid, value } = validateEventDraft(raw);
  return valid ? value : null;
};

/**
 * 從 Google Calendar 拉增量變更（sync token 輪詢）：外部刪除回收，並吸收 bot 所建
 * 非週期 timed 行程的外部修改。提醒 job 由事件存在性／版本檢查安全收斂。
 *
 * - 首次（無 sync_token）：只走一次 list 建立基線、存 nextSyncToken，不處理任何項目
 *   （首拉會回傳所有既存事件，都不是「刪除」，本地已有，無需動作）。
 * - 增量（有 sync_token）：處理 cancelled 與既有本機映射行程的修改。
 * - 410 GONE：sync token 失效 → 清掉 token，下次重新建立基線。
 *
 * @param {string} ownerId
 * @returns {Promise<{ changed: number, reset?: boolean, baseline?: boolean }>}
 */
export const pullCalendarChanges = async (ownerId) => {
  const account = await getCalendarAccount(ownerId);
  if (!account) return { changed: 0 };

  const calendarId = encodeURIComponent(account.calendar_id || config.GOOGLE_CALENDAR_ID);
  const incremental = Boolean(account.sync_token);
  const baseParams = incremental
    ? { syncToken: account.sync_token, singleEvents: true }
    // 首拉：限縮到「現在起」，避免拉整段歷史；showDeleted 對增量才有意義。
    : { timeMin: new Date().toISOString(), singleEvents: true };

  let pageToken;
  let nextSyncToken;
  let changed = 0;

  try {
    do {
      // eslint-disable-next-line no-await-in-loop
      const { response } = await authorizedRequest(ownerId, {
        method: 'GET',
        url: `${CALENDAR_API}/calendars/${calendarId}/events`,
        params: {
          ...baseParams,
          showDeleted: true,
          maxResults: 250,
          ...(pageToken ? { pageToken } : {}),
        },
      });
      const data = response.data || {};

      if (incremental) {
        const items = (data.items || []).filter((item) => item.id);
        // 外部刪除／取消 → 回收本地事件列。
        const cancelled = items.filter((item) => item.status === 'cancelled');
        // eslint-disable-next-line no-await-in-loop
        const removedFlags = await Promise.all(
          cancelled.map((item) => deleteEventByProviderId(ownerId, item.id)),
        );
        changed += removedFlags.filter(Boolean).length;

        // 外部修改 → 套用到本地（限非週期 timed 行程；衝突政策見 applyInboundEventUpdate）。
        const modified = items.filter((item) => item.status !== 'cancelled');
        // eslint-disable-next-line no-await-in-loop
        const appliedFlags = await Promise.all(modified.map(async (item) => {
          const draft = fromGoogleEvent(item);
          if (!draft) return false;
          const result = await applyInboundEventUpdate({
            ownerId,
            providerEventId: item.id,
            draft,
            providerUpdatedAt: item.updated || null,
            remindAt: getDefaultReminderTime(draft),
            remindersEnabled: config.ENABLE_REMINDERS,
          });
          return result.applied;
        }));
        changed += appliedFlags.filter(Boolean).length;
      }

      pageToken = data.nextPageToken;
      nextSyncToken = data.nextSyncToken || nextSyncToken;
    } while (pageToken);

    if (nextSyncToken) await saveSyncToken(ownerId, nextSyncToken);
    return incremental ? { changed } : { changed, baseline: true };
  } catch (err) {
    if (err.response?.status === 410) {
      await saveSyncToken(ownerId, null);
      return { changed, reset: true };
    }
    throw err;
  }
};

/**
 * cron 每分鐘呼叫：原子挑出「該輪詢」的帳號（節流 CALENDAR_INBOUND_INTERVAL 秒）並入列 inbound job。
 * claim 推進 last_pulled_at 與 enqueue 在同一交易；idempotencyKey 以分鐘為粒度避免同分鐘重入。
 * @param {{ now?: Date, limit?: number, intervalSeconds?: number }} [opts]
 * @returns {Promise<{ claimed: number, queued: number }>}
 */
export const enqueueDueCalendarInbound = async ({
  now = new Date(),
  limit = config.CALENDAR_INBOUND_MAX_PER_RUN,
  intervalSeconds = config.CALENDAR_INBOUND_INTERVAL,
} = {}) => withTransaction(async (client) => {
  const cutoff = new Date(now.getTime() - intervalSeconds * 1000).toISOString();
  const accounts = await claimAccountsForInbound(cutoff, limit, client.query.bind(client));
  const minuteKey = now.toISOString().slice(0, 16);
  let queued = 0;
  await Promise.all(accounts.map(async ({ owner_id: ownerId }) => {
    const job = await enqueueJob({
      kind: JOB_KINDS.GOOGLE_CALENDAR_INBOUND,
      payload: { ownerId },
      idempotencyKey: `calendar-inbound:${ownerId}:${minuteKey}`,
      maxAttempts: config.WORKER_MAX_ATTEMPTS,
    }, client.query.bind(client));
    if (job) queued += 1;
  }));
  return { claimed: accounts.length, queued };
});

/**
 * GOOGLE_CALENDAR_INBOUND job handler：拉一次該帳號的 Google 端變更。
 * @param {Object} job
 */
export const handleCalendarInbound = async (job) => {
  const { ownerId } = job.payload || {};
  if (!ownerId) return;
  await pullCalendarChanges(ownerId);
};

export default { pullCalendarChanges, enqueueDueCalendarInbound, handleCalendarInbound };
