import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let authorizedRequest;
let getCalendarAccount;
let saveSyncToken;
let claimAccountsForInbound;
let deleteEventByProviderId;
let applyInboundEventUpdate;
let getDefaultReminderTime;
let enqueueJob;
let withTransaction;

const load = async () => {
  jest.resetModules();
  authorizedRequest = jest.fn();
  getCalendarAccount = jest.fn();
  saveSyncToken = jest.fn().mockResolvedValue(undefined);
  claimAccountsForInbound = jest.fn();
  deleteEventByProviderId = jest.fn();
  applyInboundEventUpdate = jest.fn().mockResolvedValue({ applied: true });
  getDefaultReminderTime = jest.fn().mockReturnValue(new Date('2030-01-01T00:00:00Z'));
  enqueueJob = jest.fn().mockResolvedValue({ id: 'j1' });
  const client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  jest.doMock('../../services/google-calendar.js', () => ({ authorizedRequest }));
  jest.doMock('../../repositories/calendar-accounts.js', () => ({
    getCalendarAccount, saveSyncToken, claimAccountsForInbound,
  }));
  jest.doMock('../../repositories/events.js', () => ({ deleteEventByProviderId, applyInboundEventUpdate }));
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
});

test('pullCalendarChanges returns changed:0 when no account is linked', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue(null);
  await expect(pullCalendarChanges('o1')).resolves.toEqual({ changed: 0 });
  expect(authorizedRequest).not.toHaveBeenCalled();
});

test('first pull with no sync_token only establishes a baseline, deleting nothing', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: null });
  authorizedRequest.mockResolvedValue({
    response: { data: { items: [{ id: 'e1', status: 'confirmed' }], nextSyncToken: 'tok-1' } },
  });
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 0, baseline: true });
  expect(deleteEventByProviderId).not.toHaveBeenCalled();
  expect(saveSyncToken).toHaveBeenCalledWith('o1', 'tok-1', 2);
  // 首拉不帶 syncToken，帶 timeMin 建立基線。
  const { params } = authorizedRequest.mock.calls[0][1];
  expect(params.syncToken).toBeUndefined();
  expect(params.timeMin).toBeDefined();
  expect(params.singleEvents).toBe(false);
  expect(params.maxResults).toBe(2500);
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
          { id: 'unrelated', status: 'cancelled' },
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
  expect(deleteEventByProviderId).not.toHaveBeenCalledWith('o1', 'unrelated');
  expect(saveSyncToken).toHaveBeenCalledWith('o1', 'tok-2', 2);
});

test('a 410 GONE clears the sync token so the next run rebuilds a baseline', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'stale' });
  authorizedRequest.mockRejectedValue(Object.assign(new Error('gone'), { response: { status: 410 } }));
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 0, reset: true });
  expect(saveSyncToken).toHaveBeenCalledWith('o1', null, 2);
});

test('incremental pull follows pageToken and saves the final nextSyncToken', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1' });
  authorizedRequest
    .mockResolvedValueOnce({
      response: { data: { items: [{ id: 'gptae1', status: 'cancelled' }], nextPageToken: 'p2' } },
    })
    .mockResolvedValueOnce({
      response: { data: { items: [{ id: 'gptae2', status: 'cancelled' }], nextSyncToken: 'tok-final' } },
    });
  deleteEventByProviderId.mockResolvedValue(true);
  const result = await pullCalendarChanges('o1');
  expect(result).toEqual({ changed: 2 });
  expect(authorizedRequest).toHaveBeenCalledTimes(2);
  expect(authorizedRequest.mock.calls[1][1].params.pageToken).toBe('p2');
  expect(saveSyncToken).toHaveBeenCalledWith('o1', 'tok-final', 2);
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

test('v1 expanded-instance cursor is cleared before rebuilding a series-mode baseline', async () => {
  const { pullCalendarChanges } = await load();
  getCalendarAccount.mockResolvedValue({
    owner_id: 'o1', calendar_id: 'primary', sync_token: 'v1-token', sync_query_version: 1,
  });
  await expect(pullCalendarChanges('o1')).resolves.toEqual({ changed: 0, reset: true });
  expect(saveSyncToken).toHaveBeenCalledWith('o1', null, 2);
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
  }));
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

test('handleCalendarInbound pulls changes for the job owner', async () => {
  const { handleCalendarInbound } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', calendar_id: 'primary', sync_token: 'tok-1' });
  authorizedRequest.mockResolvedValue({ response: { data: { items: [], nextSyncToken: 'tok-2' } } });
  await handleCalendarInbound({ payload: { ownerId: 'o1' } });
  expect(authorizedRequest).toHaveBeenCalled();
  expect(saveSyncToken).toHaveBeenCalledWith('o1', 'tok-2', 2);
});
