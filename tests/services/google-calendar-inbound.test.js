import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let authorizedRequest;
let getCalendarAccount;
let saveSyncToken;
let claimAccountsForInbound;
let claimCalendarInboundSync;
let checkpointCalendarInboundPage;
let resetCalendarInboundSync;
let deleteEventByProviderId;
let deleteInboundEventByProviderId;
let deleteCalendarInboundEventByProviderId;
let deleteMissingInboundEvents;
let finalizeCalendarInboundSync;
let reconcileInboundEventReminders;
let applyInboundEventUpdate;
let getDefaultReminderTime;
let enqueueJob;
let withTransaction;

const load = async ({ remindersEnabled = false } = {}) => {
  jest.resetModules();
  process.env.ENABLE_REMINDERS = remindersEnabled ? 'true' : 'false';
  authorizedRequest = jest.fn();
  getCalendarAccount = jest.fn();
  saveSyncToken = jest.fn().mockResolvedValue(undefined);
  claimAccountsForInbound = jest.fn();
  claimCalendarInboundSync = jest.fn(async (params) => {
    const account = await getCalendarAccount(params.ownerId);
    if (!account) return null;
    return {
      ...account,
      inbound_claim_token: params.claimToken,
      inbound_baseline_generation: account.sync_token ? null : params.baselineGeneration,
      inbound_baseline_time_min: account.sync_token ? null : params.baselineTimeMin,
      inbound_page_token: null,
    };
  });
  checkpointCalendarInboundPage = jest.fn().mockResolvedValue(true);
  resetCalendarInboundSync = jest.fn().mockResolvedValue(true);
  deleteEventByProviderId = jest.fn();
  deleteInboundEventByProviderId = jest.fn().mockResolvedValue(false);
  deleteCalendarInboundEventByProviderId = jest.fn(async ({
    ownerId, providerEventId, inboundOnly,
  }) => ({
    deleted: inboundOnly
      ? await deleteInboundEventByProviderId(ownerId, providerEventId)
      : await deleteEventByProviderId(ownerId, providerEventId),
    staleClaim: false,
  }));
  deleteMissingInboundEvents = jest.fn().mockResolvedValue(0);
  finalizeCalendarInboundSync = jest.fn(async (params) => ({
    completed: true,
    removed: params.baselineGeneration
      ? await deleteMissingInboundEvents(params.ownerId, params.baselineGeneration)
      : 0,
  }));
  reconcileInboundEventReminders = jest.fn().mockResolvedValue({ scheduled: 0 });
  applyInboundEventUpdate = jest.fn().mockResolvedValue({ applied: true });
  getDefaultReminderTime = jest.fn().mockReturnValue(new Date('2030-01-01T00:00:00Z'));
  enqueueJob = jest.fn().mockResolvedValue({ id: 'j1' });
  const client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  jest.doMock('../../services/google-calendar.js', () => ({ authorizedRequest }));
  jest.doMock('../../repositories/calendar-accounts.js', () => ({
    getCalendarAccount,
    saveSyncToken,
    claimAccountsForInbound,
    claimCalendarInboundSync,
    checkpointCalendarInboundPage,
    resetCalendarInboundSync,
  }));
  jest.doMock('../../repositories/events.js', () => ({
    deleteEventByProviderId,
    deleteInboundEventByProviderId,
    deleteCalendarInboundEventByProviderId,
    deleteMissingInboundEvents,
    finalizeCalendarInboundSync,
    reconcileInboundEventReminders,
    applyInboundEventUpdate,
  }));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  jest.doMock('../../services/database.js', () => ({ withTransaction }));
  jest.doMock('../../services/reminders.js', () => ({ getDefaultReminderTime }));
  return import('../../services/google-calendar-inbound.js');
};

afterEach(() => {
  ['../../services/google-calendar.js', '../../repositories/calendar-accounts.js',
    '../../repositories/events.js', '../../repositories/jobs.js', '../../services/database.js',
    '../../services/reminders.js']
    .forEach((mod) => jest.dontMock(mod));
  jest.resetModules();
  delete process.env.ENABLE_REMINDERS;
});

test('pullCalendarChanges returns changed:0 when no account is linked', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue(null);
  await expect(pullCalendarChanges('o1')).resolves.toEqual({ changed: 0 });
  expect(authorizedRequest).not.toHaveBeenCalled();
});

test('a stale continuation claim is a no-op before calling Google', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: null, sync_query_version: 3,
  });
  claimCalendarInboundSync.mockResolvedValue(null);
  await expect(pullCalendarChanges('o1', { claimToken: 'stale-claim' }))
    .resolves.toEqual({ changed: 0, staleClaim: true });
  expect(authorizedRequest).not.toHaveBeenCalled();
});

test('baseline continuation uses its persisted timeMin and pageToken snapshot', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: null, sync_query_version: 3,
  });
  claimCalendarInboundSync.mockResolvedValue({
    owner_id: 'o1',
    calendar_id: 'primary',
    sync_token: null,
    inbound_claim_token: 'claim-1',
    inbound_baseline_generation: '11111111-1111-4111-8111-111111111111',
    inbound_baseline_time_min: '2026-07-28T00:00:00.000Z',
    inbound_page_token: 'page-2',
  });
  authorizedRequest.mockResolvedValue({
    response: { data: { items: [], nextSyncToken: 'tok-final' } },
  });
  await pullCalendarChanges('o1', { claimToken: 'claim-1' });
  expect(authorizedRequest.mock.calls[0][1].params).toEqual(expect.objectContaining({
    timeMin: '2026-07-28T00:00:00.000Z',
    pageToken: 'page-2',
  }));
});

test('first pull imports supported existing Google-origin events before establishing a baseline', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: null });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [{
          id: 'google-origin-1',
          status: 'confirmed',
          summary: '既有會議',
          updated: '2026-07-18T00:00:00Z',
          start: { dateTime: '2099-07-20T06:00:00Z', timeZone: 'Asia/Taipei' },
          end: { dateTime: '2099-07-20T07:00:00Z', timeZone: 'Asia/Taipei' },
        }],
        nextSyncToken: 'tok-1',
      },
    },
  });
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 1, baseline: true });
  expect(deleteEventByProviderId).not.toHaveBeenCalled();
  expect(applyInboundEventUpdate).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'o1',
    providerEventId: 'google-origin-1',
    allowCreate: true,
    baselineGeneration: expect.any(String),
    draft: expect.objectContaining({ title: '既有會議' }),
  }));
  expect(finalizeCalendarInboundSync).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'o1', nextSyncToken: 'tok-1',
  }));
  expect(deleteMissingInboundEvents).toHaveBeenCalledWith('o1', expect.any(String));
  // 首拉不帶 syncToken，帶 timeMin 建立基線。
  const { params } = authorizedRequest.mock.calls[0][1];
  expect(params.syncToken).toBeUndefined();
  expect(params.timeMin).toBeDefined();
  expect(params.singleEvents).toBe(false);
  expect(params.maxResults).toBe(50);
});

test('incremental pull reclaims Google-side deletions and counts only removed rows', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1' });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [
          { id: 'gptae1', status: 'cancelled' },
          { id: 'gptae2', status: 'cancelled' },
          { id: 'gptae3', status: 'confirmed' },
          { id: 'gpta-series_20260720', recurringEventId: 'gpta-series', status: 'cancelled' },
          { id: 'google-origin-deleted', status: 'cancelled' },
        ],
        nextSyncToken: 'tok-2',
      },
    },
  });
  // gptae1 存在本地被刪到，gptae2 本地沒有 → 只算 1。
  deleteEventByProviderId.mockImplementation((_o, id) => Promise.resolve(id === 'gptae1'));
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 1 });
  expect(authorizedRequest.mock.calls[0][1].params.singleEvents).toBe(false);
  expect(deleteEventByProviderId).toHaveBeenCalledWith('o1', 'gptae1');
  expect(deleteEventByProviderId).toHaveBeenCalledWith('o1', 'gptae2');
  expect(deleteEventByProviderId).not.toHaveBeenCalledWith('o1', 'gptae3');
  expect(deleteEventByProviderId).not.toHaveBeenCalledWith('o1', 'gpta-series_20260720');
  expect(deleteInboundEventByProviderId).toHaveBeenCalledWith('o1', 'google-origin-deleted');
  expect(finalizeCalendarInboundSync).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'o1', nextSyncToken: 'tok-2',
  }));
});

test('a 410 GONE clears the sync token so the next run rebuilds a baseline', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'stale' });
  authorizedRequest.mockRejectedValue(Object.assign(new Error('gone'), { response: { status: 410 } }));
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 0, reset: true });
  expect(resetCalendarInboundSync).toHaveBeenCalledWith('o1', expect.any(String), 3);
});

test('incremental pull checkpoints one page and queues a durable continuation', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1' });
  authorizedRequest.mockResolvedValue({
    response: { data: { items: [{ id: 'gptae1', status: 'cancelled' }], nextPageToken: 'p2' } },
  });
  deleteEventByProviderId.mockResolvedValue(true);
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 1, continued: true });
  expect(authorizedRequest).toHaveBeenCalledTimes(1);
  expect(checkpointCalendarInboundPage).toHaveBeenCalledWith(
    'o1', expect.any(String), 'p2', expect.any(String), expect.any(Function),
  );
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-calendar-inbound',
    payload: { ownerId: 'o1', claimToken: expect.any(String) },
  }), expect.any(Function));
  expect(finalizeCalendarInboundSync).not.toHaveBeenCalled();
});

test('fromGoogleEvent maps a timed event and skips all-day / recurring / cancelled / bare', async () => {
  const { fromGoogleEvent } = await load();
  const mapped = fromGoogleEvent({
    id: 'gpta1',
    status: 'confirmed',
    summary: '  客戶會議  ',
    start: { dateTime: '2026-07-20T06:00:00.000Z', timeZone: 'Asia/Taipei' },
    end: { dateTime: '2026-07-20T07:00:00.000Z', timeZone: 'Asia/Taipei' },
    location: '台北',
    description: '季度檢討',
  });
  expect(mapped).toEqual({
    title: '客戶會議',
    start: '2026-07-20T06:00:00.000Z',
    allDay: false,
    end: '2026-07-20T07:00:00.000Z',
    timezone: 'Asia/Taipei',
    location: '台北',
    notes: '季度檢討',
  });
  expect(fromGoogleEvent({
    id: 'a', status: 'cancelled', summary: 'x', start: { dateTime: '2026-07-20T06:00:00Z' },
  })).toBeNull();
  expect(fromGoogleEvent({
    id: 'b', status: 'confirmed', summary: 'x', start: { date: '2026-07-20' },
  })).toBeNull();
  expect(fromGoogleEvent({
    id: 'c', status: 'confirmed', summary: 'x', start: { dateTime: '2026-07-20T06:00:00Z' }, recurrence: ['RRULE:FREQ=WEEKLY'],
  })).toBeNull();
  expect(fromGoogleEvent({ id: 'd', status: 'confirmed', start: { dateTime: '2026-07-20T06:00:00Z' } })).toBeNull();
  expect(fromGoogleEvent({
    id: 'gpta1_20260720T060000Z',
    recurringEventId: 'gpta1',
    status: 'confirmed',
    summary: '週期實例',
    start: { dateTime: '2026-07-20T06:00:00Z' },
  })).toBeNull();
});

test('older cursor versions are cleared before rebuilding the Google-origin baseline', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: 'v2-token', sync_query_version: 2,
  });
  await expect(pullCalendarChanges('o1')).resolves.toEqual({ changed: 0, reset: true });
  expect(saveSyncToken).toHaveBeenCalledWith('o1', null, 3);
  expect(authorizedRequest).not.toHaveBeenCalled();
});

test('incremental pull applies external modifications and counts applied ones', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1' });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [
          {
            id: 'gpta1',
            status: 'confirmed',
            summary: '改期會議',
            updated: '2026-07-18T00:00:00Z',
            start: { dateTime: '2026-07-21T06:00:00Z', timeZone: 'Asia/Taipei' },
          },
          { id: 'gpta2', status: 'confirmed', start: { date: '2026-07-22' } }, // all-day → 跳過
        ],
        nextSyncToken: 'tok-2',
      },
    },
  });
  applyInboundEventUpdate.mockResolvedValue({ applied: true });
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 1 });
  expect(applyInboundEventUpdate).toHaveBeenCalledTimes(1);
  expect(applyInboundEventUpdate).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'o1',
    providerEventId: 'gpta1',
    providerUpdatedAt: '2026-07-18T00:00:00Z',
    draft: expect.objectContaining({ title: '改期會議' }),
    allowCreate: false,
  }));
});

test('incremental pull imports a new future Google-origin event', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1', sync_query_version: 3,
  });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [{
          id: 'external-1',
          status: 'confirmed',
          summary: '外部新增',
          updated: '2026-07-18T00:00:00Z',
          start: { dateTime: '2099-07-21T06:00:00Z', timeZone: 'Asia/Taipei' },
        }],
        nextSyncToken: 'tok-2',
      },
    },
  });
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 1 });
  expect(applyInboundEventUpdate).toHaveBeenCalledWith(expect.objectContaining({
    providerEventId: 'external-1',
    allowCreate: true,
  }));
});

test('does not import Google-origin events outside the safe slice', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'secondary', sync_token: null, sync_query_version: 3,
  });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [
          {
            id: 'external-secondary',
            status: 'confirmed',
            summary: 'secondary',
            start: { dateTime: '2099-07-21T06:00:00Z' },
          },
          {
            id: 'external-all-day',
            status: 'confirmed',
            summary: 'all day',
            start: { date: '2099-07-21' },
          },
          {
            id: 'external-recurring',
            status: 'confirmed',
            summary: 'weekly',
            start: { dateTime: '2099-07-21T06:00:00Z' },
            recurrence: ['RRULE:FREQ=WEEKLY'],
          },
          {
            id: 'gptaunknown',
            status: 'confirmed',
            summary: 'managed without local mapping',
            start: { dateTime: '2099-07-21T06:00:00Z' },
          },
        ],
        nextSyncToken: 'tok-2',
      },
    },
  });
  applyInboundEventUpdate.mockResolvedValue({ applied: false, reason: 'not_found' });
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 0, baseline: true });
  expect(applyInboundEventUpdate).toHaveBeenCalledTimes(1);
  expect(applyInboundEventUpdate).toHaveBeenCalledWith(expect.objectContaining({
    providerEventId: 'gptaunknown',
    allowCreate: false,
  }));
});

test('unsupported Google-origin modifications remove only inbound mappings', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1', sync_query_version: 3,
  });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [{
          id: 'external-1', status: 'confirmed', summary: '改為全天',
          start: { date: '2099-07-21' },
        }, {
          id: 'gpta1', status: 'confirmed', summary: 'bot recurring',
          start: { dateTime: '2099-07-21T06:00:00Z' }, recurrence: ['RRULE:FREQ=WEEKLY'],
        }],
        nextSyncToken: 'tok-2',
      },
    },
  });
  deleteInboundEventByProviderId.mockResolvedValue(true);
  await expect(pullCalendarChanges('o1')).resolves.toEqual({ changed: 1 });
  expect(deleteInboundEventByProviderId).toHaveBeenCalledWith('o1', 'external-1');
  expect(deleteInboundEventByProviderId).not.toHaveBeenCalledWith('o1', 'gpta1');
  expect(deleteEventByProviderId).not.toHaveBeenCalledWith('o1', 'gpta1');
});

test('does not save a baseline cursor when local apply fails', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: null, sync_query_version: 3,
  });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [{
          id: 'external-1', status: 'confirmed', summary: 'x',
          start: { dateTime: '2099-07-21T06:00:00Z' },
        }],
        nextSyncToken: 'tok-2',
      },
    },
  });
  applyInboundEventUpdate.mockRejectedValue(new Error('local transaction failed'));
  await expect(pullCalendarChanges('o1')).rejects.toThrow('local transaction failed');
  expect(saveSyncToken).not.toHaveBeenCalled();
  expect(deleteMissingInboundEvents).not.toHaveBeenCalled();
});

test('a failed continuation retries the same persisted page without advancing', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1', sync_query_version: 3,
  });
  claimCalendarInboundSync.mockResolvedValue({
    owner_id: 'o1',
    calendar_id: 'primary',
    sync_token: 'tok-1',
    inbound_claim_token: 'claim-1',
    inbound_page_token: 'p2',
  });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [{
          id: 'external-2', status: 'confirmed', summary: 'two',
          start: { dateTime: '2099-07-22T06:00:00Z' },
        }],
        nextSyncToken: 'tok-2',
      },
    },
  });
  applyInboundEventUpdate.mockRejectedValue(new Error('page two failed'));
  await expect(pullCalendarChanges('o1', { claimToken: 'claim-1' }))
    .rejects.toThrow('page two failed');
  expect(authorizedRequest.mock.calls[0][1].params.pageToken).toBe('p2');
  expect(checkpointCalendarInboundPage).not.toHaveBeenCalled();
  expect(finalizeCalendarInboundSync).not.toHaveBeenCalled();
});

test('a later inbound poll backfills imported events after reminders become enabled', async () => {
  const { pullCalendarChanges } = await load({ remindersEnabled: true });
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1', sync_query_version: 3,
  });
  authorizedRequest.mockResolvedValue({
    response: { data: { items: [], nextSyncToken: 'tok-2' } },
  });
  await pullCalendarChanges('o1');
  expect(reconcileInboundEventReminders).toHaveBeenCalledWith('o1', {
    claimToken: expect.any(String),
  });
});

test('baseline cleanup failure does not advance the cursor', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: null, sync_query_version: 3,
  });
  authorizedRequest.mockResolvedValue({
    response: { data: { items: [], nextSyncToken: 'tok-2' } },
  });
  deleteMissingInboundEvents.mockRejectedValue(new Error('cleanup failed'));
  await expect(pullCalendarChanges('o1')).rejects.toThrow('cleanup failed');
  expect(saveSyncToken).not.toHaveBeenCalled();
});

test('mapWithConcurrency never exceeds the configured worker count', async () => {
  const { mapWithConcurrency } = await load();
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    active -= 1;
    return value * 2;
  }, 3);
  expect(peak).toBe(3);
  expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
});

test('incremental pull does not count a modification the policy rejected', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1' });
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [{
          id: 'gpta1', status: 'confirmed', summary: 'x', updated: '2026-07-18T00:00:00Z', start: { dateTime: '2026-07-21T06:00:00Z' },
        }],
        nextSyncToken: 'tok-2',
      },
    },
  });
  applyInboundEventUpdate.mockResolvedValue({ applied: false, reason: 'local_pending' });
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 0 });
});

test('enqueueDueCalendarInbound claims due accounts and enqueues one job each', async () => {
  const { enqueueDueCalendarInbound } = await load();
  claimAccountsForInbound.mockResolvedValue([{ owner_id: 'o1' }, { owner_id: 'o2' }]);
  const summary = await enqueueDueCalendarInbound({ now: new Date('2026-07-17T00:00:00Z') });
  expect(summary).toEqual({ claimed: 2, queued: 2 });
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-calendar-inbound',
    idempotencyKey: 'calendar-inbound:o1:2026-07-17T00:00',
  }), expect.any(Function));
});

test('enqueueDueCalendarInbound never overlaps queries on one transaction client', async () => {
  const { enqueueDueCalendarInbound } = await load();
  claimAccountsForInbound.mockResolvedValue([{ owner_id: 'o1' }, { owner_id: 'o2' }]);
  let releaseFirst;
  enqueueJob
    .mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ id: 'j1' });
    }))
    .mockResolvedValueOnce({ id: 'j2' });

  const pending = enqueueDueCalendarInbound({ now: new Date('2026-07-17T00:00:00Z') });
  await Promise.resolve();
  await Promise.resolve();
  expect(enqueueJob).toHaveBeenCalledTimes(1);
  releaseFirst();
  await expect(pending).resolves.toEqual({ claimed: 2, queued: 2 });
  expect(enqueueJob).toHaveBeenCalledTimes(2);
});

test('handleCalendarInbound pulls changes for the job owner', async () => {
  const { handleCalendarInbound } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1' });
  authorizedRequest.mockResolvedValue({ response: { data: { items: [], nextSyncToken: 'tok-2' } } });
  await handleCalendarInbound({ payload: { ownerId: 'o1' } });
  expect(authorizedRequest).toHaveBeenCalled();
  expect(finalizeCalendarInboundSync).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'o1', nextSyncToken: 'tok-2',
  }));
});
