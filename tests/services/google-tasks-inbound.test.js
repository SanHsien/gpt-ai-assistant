import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let authorizedRequest;
let getCalendarAccount;
let claimAccountsForTasksInbound;
let completeTasksInboundClaim;
let applyInboundTaskUpdate;
let enqueueJob;
let withTransaction;

const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

const load = async () => {
  jest.resetModules();
  authorizedRequest = jest.fn();
  getCalendarAccount = jest.fn().mockResolvedValue({ owner_id: 'o1', scopes: [GOOGLE_TASKS_SCOPE] });
  claimAccountsForTasksInbound = jest.fn();
  completeTasksInboundClaim = jest.fn().mockResolvedValue(true);
  applyInboundTaskUpdate = jest.fn().mockResolvedValue({ applied: true });
  enqueueJob = jest.fn().mockResolvedValue({ id: 'j1' });
  const client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  jest.doMock('../../services/google-calendar.js', () => ({
    authorizedRequest, GOOGLE_TASKS_SCOPE, isGoogleOAuthConfigured: () => true,
  }));
  jest.doMock('../../repositories/calendar-accounts.js', () => ({
    getCalendarAccount, claimAccountsForTasksInbound, completeTasksInboundClaim,
  }));
  jest.doMock('../../repositories/tasks.js', () => ({ applyInboundTaskUpdate }));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  jest.doMock('../../services/database.js', () => ({ withTransaction }));
  return import('../../services/google-tasks-inbound.js');
};

afterEach(() => {
  ['../../services/google-calendar.js', '../../repositories/calendar-accounts.js',
    '../../repositories/tasks.js', '../../repositories/jobs.js', '../../services/database.js']
    .forEach((mod) => jest.dontMock(mod));
  jest.resetModules();
});

test('pullTaskChanges skips when the account lacks the tasks scope', async () => {
  const { pullTaskChanges } = await load();
  getCalendarAccount.mockResolvedValue({ owner_id: 'o1', scopes: ['calendar-only'] });
  await expect(pullTaskChanges('o1', null)).resolves.toEqual({ changed: 0 });
  expect(authorizedRequest).not.toHaveBeenCalled();
});

test('pullTaskChanges applies changes and counts only applied ones', async () => {
  const { pullTaskChanges } = await load();
  authorizedRequest.mockResolvedValue({
    response: {
      data: {
        items: [
          { id: 'g1', status: 'completed', title: 'a' },
          { id: 'g2', deleted: true },
          { id: 'g3', status: 'needsAction', title: 'c' },
        ],
      },
    },
  });
  applyInboundTaskUpdate
    .mockResolvedValueOnce({ applied: true })
    .mockResolvedValueOnce({ applied: true, action: 'deleted' })
    .mockResolvedValueOnce({ applied: false, reason: 'no_change' });
  const result = await pullTaskChanges('o1', '2026-07-17T00:00:00.000Z');
  expect(result).toEqual({ changed: 2 });
  expect(applyInboundTaskUpdate).toHaveBeenCalledTimes(3);
  // updatedMin 有帶進查詢參數。
  expect(authorizedRequest.mock.calls[0][1].params.updatedMin).toBe('2026-07-17T00:00:00.000Z');
  expect(authorizedRequest.mock.calls[0][1].params.showDeleted).toBe(true);
});

test('pullTaskChanges follows pageToken across pages', async () => {
  const { pullTaskChanges } = await load();
  authorizedRequest
    .mockResolvedValueOnce({ response: { data: { items: [{ id: 'g1', status: 'completed' }], nextPageToken: 'p2' } } })
    .mockResolvedValueOnce({ response: { data: { items: [{ id: 'g2', status: 'completed' }] } } });
  const result = await pullTaskChanges('o1', null);
  expect(result).toEqual({ changed: 2 });
  expect(authorizedRequest).toHaveBeenCalledTimes(2);
  expect(authorizedRequest.mock.calls[1][1].params.pageToken).toBe('p2');
});

test('enqueueDueTasksInbound claims accounts and enqueues with the prior watermark as updatedMin', async () => {
  const { enqueueDueTasksInbound } = await load();
  claimAccountsForTasksInbound.mockResolvedValue([
    { owner_id: 'o1', prev: '2026-07-17T00:00:00.000Z' },
    { owner_id: 'o2', prev: null },
  ]);
  const summary = await enqueueDueTasksInbound({ now: new Date('2026-07-17T05:00:00Z') });
  expect(summary).toEqual({ claimed: 2, queued: 2 });
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-tasks-inbound',
    payload: {
      ownerId: 'o1',
      updatedMin: '2026-07-17T00:00:00.000Z',
      claimedAt: '2026-07-17T05:00:00.000Z',
    },
    idempotencyKey: 'google-tasks-inbound:o1:2026-07-17T05:00:00.000Z',
  }), expect.any(Function));
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    payload: { ownerId: 'o2', updatedMin: null, claimedAt: '2026-07-17T05:00:00.000Z' },
  }), expect.any(Function));
});

test('handleTasksInbound advances the watermark only after a successful pull', async () => {
  const { handleTasksInbound } = await load();
  authorizedRequest.mockResolvedValue({ response: { data: { items: [] } } });
  await handleTasksInbound({
    payload: {
      ownerId: 'o1',
      updatedMin: '2026-07-17T00:00:00.000Z',
      claimedAt: '2026-07-17T05:00:00.000Z',
    },
  });
  expect(authorizedRequest).toHaveBeenCalled();
  expect(authorizedRequest.mock.calls[0][1].params.updatedMin).toBe('2026-07-17T00:00:00.000Z');
  expect(completeTasksInboundClaim).toHaveBeenCalledWith('o1', '2026-07-17T05:00:00.000Z');
});

test('handleTasksInbound does not advance the watermark when the API pull fails', async () => {
  const { handleTasksInbound } = await load();
  authorizedRequest.mockRejectedValue(new Error('temporary Google failure'));
  await expect(handleTasksInbound({
    payload: { ownerId: 'o1', updatedMin: null, claimedAt: '2026-07-17T05:00:00.000Z' },
  })).rejects.toThrow('temporary Google failure');
  expect(completeTasksInboundClaim).not.toHaveBeenCalled();
});
