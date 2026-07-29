import crypto from 'node:crypto';
import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { enqueueJob } from '../repositories/jobs.js';
import {
  checkpointCalendarInboundPage,
  claimCalendarInboundSync,
  claimAccountsForInbound,
  getCalendarAccount,
  resetCalendarInboundSync,
  saveSyncToken,
} from '../repositories/calendar-accounts.js';
import {
  applyInboundEventUpdate,
  deleteCalendarInboundEventByProviderId,
  finalizeCalendarInboundSync,
  reconcileInboundEventReminders,
} from '../repositories/events.js';
import { validateEventDraft } from '../schemas/event-draft.js';
import { withTransaction } from './database.js';
import { authorizedRequest } from './google-calendar.js';
import { getDefaultReminderTime } from './reminders.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SYNC_QUERY_VERSION = 3;
const isManagedEvent = (item) => item?.id?.startsWith('gpta') && !item.recurringEventId;
const isPrimaryCalendar = (account) => (
  (account.calendar_id || config.GOOGLE_CALENDAR_ID) === 'primary'
);
const isFutureDraft = (draft) => new Date(draft.start).getTime() > Date.now();

export const mapWithConcurrency = async (
  items,
  worker,
  concurrency = Math.max(1, config.DATABASE_POOL_MAX),
) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runNext = async () => {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await runNext();
  };
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, () => runNext()),
  );
  return results;
};

/**
 * Google Calendar event → 本地 event draft（反向 toGoogleEvent）。
 * 本切片只吃「非週期、有時刻（timed）」行程；all-day、週期、缺 summary／dateTime 一律回 null 跳過
 * （回收由刪除切片負責，all-day／週期 round-trip 留待後續）。
 * @param {Object} item Google events.list 項目
 * @returns {Object|null} 已通過 validateEventDraft 的 draft，或 null（不處理）
 */
export const fromGoogleEvent = (item) => {
  if (!item || item.status === 'cancelled') return null;
  if (item.recurringEventId || (Array.isArray(item.recurrence) && item.recurrence.length > 0)) {
    return null;
  }
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
 * 從 Google Calendar 拉增量變更（sync token 輪詢）：外部刪除回收，吸收 bot 所建
 * 非週期 timed 行程的外部修改，並匯入 primary calendar 上安全範圍內的 Google-origin
 * 未來行程。提醒 job 由事件存在性／版本檢查安全收斂。
 *
 * - 首次（無 sync_token）：匯入既存的未來、timed、non-recurring Google-origin 行程，
 *   同時吸收已有 mapping 的修改，全部成功後才存 nextSyncToken。
 * - 增量（有 sync_token）：處理 cancelled、修改與新建。
 * - 410 GONE：sync token 失效 → 清掉 token，下次重新建立基線。
 *
 * @param {string} ownerId
 * @returns {Promise<{ changed: number, reset?: boolean, baseline?: boolean }>}
 */
export const pullCalendarChanges = async (
  ownerId,
  { claimToken: requestedClaimToken = null, now = new Date() } = {},
) => {
  const account = await getCalendarAccount(ownerId);
  if (!account) return { changed: 0 };

  // v1 使用 singleEvents=true，無截止日的週期行程會展開成大量 occurrence。
  // v3 新增 Google-origin baseline import；舊游標先清除，下一輪以系列模式重建。
  if ((account.sync_query_version ?? SYNC_QUERY_VERSION) !== SYNC_QUERY_VERSION) {
    await saveSyncToken(ownerId, null, SYNC_QUERY_VERSION);
    return { changed: 0, reset: true };
  }

  const claimedAt = now.toISOString();
  const claim = await claimCalendarInboundSync({
    ownerId,
    requestedClaimToken,
    claimToken: crypto.randomUUID(),
    baselineGeneration: crypto.randomUUID(),
    baselineTimeMin: claimedAt,
    staleBefore: new Date(
      now.getTime() - Math.max(30, config.WORKER_LEASE_SECONDS) * 1000,
    ).toISOString(),
    claimedAt,
  });
  if (!claim) {
    return requestedClaimToken
      ? { changed: 0, staleClaim: true }
      : { changed: 0, busy: true };
  }

  const activeClaimToken = claim.inbound_claim_token;
  const calendarId = encodeURIComponent(claim.calendar_id || config.GOOGLE_CALENDAR_ID);
  const incremental = Boolean(claim.sync_token);
  const primary = isPrimaryCalendar(claim);
  const baselineGeneration = !incremental && primary
    ? claim.inbound_baseline_generation
    : null;
  const baseParams = incremental
    ? { syncToken: claim.sync_token, singleEvents: false }
    : {
      timeMin: new Date(claim.inbound_baseline_time_min).toISOString(),
      singleEvents: false,
    };
  let changed = 0;

  try {
    const { response } = await authorizedRequest(ownerId, {
      method: 'GET',
      url: `${CALENDAR_API}/calendars/${calendarId}/events`,
      params: {
        ...baseParams,
        showDeleted: true,
        maxResults: config.CALENDAR_INBOUND_PAGE_SIZE,
        ...(claim.inbound_page_token ? { pageToken: claim.inbound_page_token } : {}),
      },
    });
    const data = response.data || {};
    const items = data.items || [];
    const cancelled = incremental
      ? items.filter((item) => (
        item.status === 'cancelled'
        && !item.recurringEventId
        && (primary || isManagedEvent(item))
      ))
      : [];
    const removedResults = await mapWithConcurrency(cancelled, (item) => (
      deleteCalendarInboundEventByProviderId({
        ownerId,
        providerEventId: item.id,
        claimToken: activeClaimToken,
        inboundOnly: !isManagedEvent(item),
      })
    ));
    if (removedResults.some((result) => result.staleClaim)) {
      return { changed: 0, staleClaim: true };
    }
    changed += removedResults.filter((result) => result.deleted).length;

    const modified = items.filter((item) => (
      item.status !== 'cancelled'
      && (primary || isManagedEvent(item))
    ));
    const appliedResults = await mapWithConcurrency(modified, async (item) => {
      const draft = fromGoogleEvent(item);
      if (!draft) {
        if (primary && !isManagedEvent(item)) {
          return deleteCalendarInboundEventByProviderId({
            ownerId,
            providerEventId: item.id,
            claimToken: activeClaimToken,
            inboundOnly: true,
          });
        }
        return { applied: false };
      }
      const allowCreate = primary && !isManagedEvent(item) && isFutureDraft(draft);
      return applyInboundEventUpdate({
        ownerId,
        providerEventId: item.id,
        draft,
        providerUpdatedAt: item.updated || null,
        remindAt: getDefaultReminderTime(draft),
        remindersEnabled: config.ENABLE_REMINDERS,
        allowCreate,
        createTimezone: data.timeZone || config.SCHEDULE_DEFAULT_TIMEZONE,
        baselineGeneration: !isManagedEvent(item) ? baselineGeneration : null,
        claimToken: activeClaimToken,
      });
    });
    if (appliedResults.some((result) => result.staleClaim || result.reason === 'stale_claim')) {
      return { changed: 0, staleClaim: true };
    }
    changed += appliedResults.filter((result) => result.applied || result.deleted).length;

    if (data.nextPageToken) {
      const queued = await withTransaction(async (client) => {
        const executor = client.query.bind(client);
        const checkpointed = await checkpointCalendarInboundPage(
          ownerId,
          activeClaimToken,
          data.nextPageToken,
          new Date().toISOString(),
          executor,
        );
        if (!checkpointed) return false;
        const pageHash = crypto.createHash('sha256')
          .update(data.nextPageToken)
          .digest('hex')
          .slice(0, 20);
        await enqueueJob({
          kind: JOB_KINDS.GOOGLE_CALENDAR_INBOUND,
          payload: { ownerId, claimToken: activeClaimToken },
          idempotencyKey: `calendar-inbound-page:${ownerId}:${activeClaimToken}:${pageHash}`,
          maxAttempts: config.WORKER_MAX_ATTEMPTS,
        }, executor);
        return true;
      });
      if (!queued) return { changed: 0, staleClaim: true };
      return incremental
        ? { changed, continued: true }
        : { changed, baseline: true, continued: true };
    }

    if (primary && config.ENABLE_REMINDERS) {
      const reconciled = await reconcileInboundEventReminders(ownerId, {
        claimToken: activeClaimToken,
      });
      if (reconciled.staleClaim) return { changed: 0, staleClaim: true };
    }
    if (!data.nextSyncToken) {
      throw new Error('Google Calendar final page did not return nextSyncToken');
    }
    const finalized = await finalizeCalendarInboundSync({
      ownerId,
      claimToken: activeClaimToken,
      nextSyncToken: data.nextSyncToken,
      baselineGeneration,
      queryVersion: SYNC_QUERY_VERSION,
    });
    if (!finalized.completed) return { changed: 0, staleClaim: true };
    changed += finalized.removed;
    return incremental ? { changed } : { changed, baseline: true };
  } catch (err) {
    if (err.response?.status === 410) {
      const reset = await resetCalendarInboundSync(
        ownerId,
        activeClaimToken,
        SYNC_QUERY_VERSION,
      );
      return reset
        ? { changed, reset: true }
        : { changed: 0, staleClaim: true };
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
  // node-postgres does not support overlapping query() calls on one transaction client.
  for (const { owner_id: ownerId } of accounts) {
    // eslint-disable-next-line no-await-in-loop
    const job = await enqueueJob({
      kind: JOB_KINDS.GOOGLE_CALENDAR_INBOUND,
      payload: { ownerId },
      idempotencyKey: `calendar-inbound:${ownerId}:${minuteKey}`,
      maxAttempts: config.WORKER_MAX_ATTEMPTS,
    }, client.query.bind(client));
    if (job) queued += 1;
  }
  return { claimed: accounts.length, queued };
});

/**
 * GOOGLE_CALENDAR_INBOUND job handler：拉一次該帳號的 Google 端變更。
 * @param {Object} job
 */
export const handleCalendarInbound = async (job) => {
  const { ownerId, claimToken } = job.payload || {};
  if (!ownerId) return;
  await pullCalendarChanges(ownerId, { claimToken });
};

export default { pullCalendarChanges, enqueueDueCalendarInbound, handleCalendarInbound };
