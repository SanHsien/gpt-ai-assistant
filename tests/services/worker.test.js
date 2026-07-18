import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let claimNextJob;
let runJob;
let prepareEvents;
let replyMessage;
let saveJobResult;
let markJobDelivered;
let enqueueJob;
let syncGoogleCalendarEvent;
let sendLineReminder;
let sendGoogleCalendarStatus;

const EVENT = { webhookEventId: 'w1', type: 'message' };
const MESSAGES = [{ type: 'text', text: 'hi' }];
const CONTEXT = { id: 'U1', replyToken: 'r1', messages: MESSAGES };
const RESULT = { id: 'U1', replyToken: 'r1', messages: MESSAGES };

const load = async () => {
  jest.resetModules();
  claimNextJob = jest.fn();
  runJob = jest.fn().mockResolvedValue('done');
  prepareEvents = jest.fn().mockResolvedValue([CONTEXT]);
  replyMessage = jest.fn().mockResolvedValue(undefined);
  saveJobResult = jest.fn().mockResolvedValue(true);
  markJobDelivered = jest.fn().mockResolvedValue(true);
  enqueueJob = jest.fn().mockResolvedValue({ id: 'status-job-1' });
  syncGoogleCalendarEvent = jest.fn().mockResolvedValue({ id: 'e1', sync_status: 'synced' });
  sendLineReminder = jest.fn().mockResolvedValue(undefined);
  sendGoogleCalendarStatus = jest.fn().mockResolvedValue(undefined);
  jest.doMock('../../repositories/jobs.js', () => ({
    claimNextJob, saveJobResult, markJobDelivered, enqueueJob,
  }));
  jest.doMock('../../services/jobs.js', () => ({ runJob }));
  jest.doMock('../../app/app.js', () => ({ prepareEvents }));
  jest.doMock('../../utils/index.js', () => ({ replyMessage }));
  jest.doMock('../../services/google-calendar.js', () => ({ syncGoogleCalendarEvent }));
  jest.doMock('../../services/reminders.js', () => ({ sendLineReminder }));
  jest.doMock('../../services/google-calendar-status.js', () => ({ sendGoogleCalendarStatus }));
  return import('../../services/worker.js');
};

const lineJob = (overrides = {}) => ({
  id: 'j1',
  kind: 'line-event',
  attempts: 1,
  lease_token: 'lease1',
  payload: { event: EVENT },
  result: null,
  delivered_at: null,
  ...overrides,
});

afterEach(() => {
  jest.dontMock('../../repositories/jobs.js');
  jest.dontMock('../../services/jobs.js');
  jest.dontMock('../../app/app.js');
  jest.dontMock('../../utils/index.js');
  jest.dontMock('../../services/google-calendar.js');
  jest.dontMock('../../services/reminders.js');
  jest.dontMock('../../services/google-calendar-status.js');
  jest.resetModules();
});

test('a first attempt runs the AI, checkpoints the result, then delivers', async () => {
  const { handleJob } = await load();
  await handleJob(lineJob());

  expect(prepareEvents).toHaveBeenCalledWith([EVENT]);
  expect(saveJobResult).toHaveBeenCalledWith('j1', 'lease1', RESULT);
  expect(replyMessage).toHaveBeenCalledWith(RESULT, { allowPushFallback: false });
  expect(markJobDelivered).toHaveBeenCalledWith('j1', 'lease1');
  // checkpoint 必須早於送出，否則送出後崩潰就得重跑一次 AI。
  expect(saveJobResult.mock.invocationCallOrder[0])
    .toBeLessThan(replyMessage.mock.invocationCallOrder[0]);
});

test('a retry with a checkpointed result redelivers without paying for the AI again', async () => {
  const { handleJob } = await load();
  await handleJob(lineJob({ attempts: 2, result: RESULT }));

  expect(prepareEvents).not.toHaveBeenCalled();
  expect(saveJobResult).not.toHaveBeenCalled();
  expect(replyMessage).toHaveBeenCalledWith(RESULT, { allowPushFallback: false });
});

test('a reclaimed job that died during the AI phase refuses to repeat the paid work', async () => {
  const { handleJob } = await load();
  // 函式在 AI 階段被砍：沒有拋錯，租約過期後被重新領取，attempts 已加到 2 而 result 仍是空的。
  await expect(handleJob(lineJob({ attempts: 2, result: null })))
    .rejects.toMatchObject({ retryable: false });

  expect(prepareEvents).not.toHaveBeenCalled();
  expect(replyMessage).not.toHaveBeenCalled();
});

test('an already delivered job is never delivered twice', async () => {
  const { handleJob } = await load();
  await handleJob(lineJob({ attempts: 2, result: RESULT, delivered_at: '2026-07-14T00:00:00Z' }));

  expect(replyMessage).not.toHaveBeenCalled();
  expect(markJobDelivered).not.toHaveBeenCalled();
});

test('an AI failure is never retried, because a retry would pay twice', async () => {
  const { handleJob } = await load();
  prepareEvents.mockRejectedValue(new Error('openai exploded'));
  await expect(handleJob(lineJob())).rejects.toMatchObject({
    message: 'openai exploded', retryable: false,
  });
  expect(replyMessage).not.toHaveBeenCalled();
});

test('a transient delivery failure stays retryable', async () => {
  const { handleJob } = await load();
  replyMessage.mockRejectedValue(Object.assign(new Error('line 500'), {
    response: { status: 500 },
  }));
  const err = await handleJob(lineJob()).catch((caught) => caught);
  expect(err.retryable).toBeUndefined();
  expect(markJobDelivered).not.toHaveBeenCalled();
});

test('an expired reply token is not retried and never falls back to push', async () => {
  const { handleJob } = await load();
  replyMessage.mockRejectedValue(Object.assign(new Error('invalid reply token'), {
    response: { status: 400 },
  }));
  await expect(handleJob(lineJob())).rejects.toMatchObject({ retryable: false });
  expect(replyMessage).toHaveBeenCalledWith(RESULT, { allowPushFallback: false });
});

test('rate limiting stays retryable', async () => {
  const { handleJob } = await load();
  replyMessage.mockRejectedValue(Object.assign(new Error('too many requests'), {
    response: { status: 429 },
  }));
  const err = await handleJob(lineJob()).catch((caught) => caught);
  expect(err.retryable).toBeUndefined();
});

test('an event with nothing to say is checkpointed and delivers nothing', async () => {
  const { handleJob } = await load();
  prepareEvents.mockResolvedValue([]);
  await handleJob(lineJob());

  expect(saveJobResult).toHaveBeenCalledWith('j1', 'lease1', null);
  expect(replyMessage).not.toHaveBeenCalled();
});

test('losing the lease before the checkpoint lands is not retried', async () => {
  const { handleJob } = await load();
  saveJobResult.mockResolvedValue(false);
  await expect(handleJob(lineJob())).rejects.toMatchObject({ retryable: false });
  expect(replyMessage).not.toHaveBeenCalled();
});

test('still delivers on a database that has not run migration 0003 yet', async () => {
  const { handleJob } = await load();
  // null = checkpoint 欄位還不存在（部署與 migration 之間的空窗期）。
  saveJobResult.mockResolvedValue(null);
  markJobDelivered.mockResolvedValue(null);
  await handleJob(lineJob());
  expect(replyMessage).toHaveBeenCalledWith(RESULT, { allowPushFallback: false });
});

test('handleJob rejects an unknown job kind without retrying', async () => {
  const { handleJob } = await load();
  await expect(handleJob({ id: 'j1', kind: 'nope', payload: {} }))
    .rejects.toMatchObject({ retryable: false });
});

test('a successful Google Calendar sync enqueues one final status delivery', async () => {
  const { handleJob } = await load();
  const payload = { ownerId: 'u1', eventId: 'e1', notificationTarget: 'U1' };
  await handleJob({
    id: 'j2', kind: 'google-calendar-sync', attempts: 1, max_attempts: 3, payload,
  });
  expect(syncGoogleCalendarEvent).toHaveBeenCalledWith(payload);
  expect(enqueueJob).toHaveBeenCalledWith({
    kind: 'google-calendar-status',
    payload: {
      ownerId: 'u1', eventId: 'e1', notificationTarget: 'U1', status: 'success',
    },
    idempotencyKey: 'google-calendar-status:j2:success',
    maxAttempts: 3,
  });
  expect(prepareEvents).not.toHaveBeenCalled();
  expect(replyMessage).not.toHaveBeenCalled();
});

test('a transient Google sync failure stays silent until the final attempt', async () => {
  const { handleJob } = await load();
  syncGoogleCalendarEvent.mockRejectedValue(new Error('temporary'));
  const job = {
    id: 'j2',
    kind: 'google-calendar-sync',
    attempts: 1,
    max_attempts: 3,
    payload: { ownerId: 'u1', eventId: 'e1', notificationTarget: 'U1' },
  };
  await expect(handleJob(job)).rejects.toThrow('temporary');
  expect(enqueueJob).not.toHaveBeenCalled();
});

test('the final Google sync failure enqueues one actionable failure status', async () => {
  const { handleJob } = await load();
  syncGoogleCalendarEvent.mockRejectedValue(new Error('still unavailable'));
  const job = {
    id: 'j2',
    kind: 'google-calendar-sync',
    attempts: 3,
    max_attempts: 3,
    payload: { ownerId: 'u1', eventId: 'e1', notificationTarget: 'U1' },
  };
  await expect(handleJob(job)).rejects.toThrow('still unavailable');
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-calendar-status',
    payload: expect.objectContaining({ status: 'failure' }),
    idempotencyKey: 'google-calendar-status:j2:failure',
  }));
});

test('Google Calendar status jobs run the idempotent LINE sender', async () => {
  const { handleJob } = await load();
  const job = { id: 'j4', kind: 'google-calendar-status', payload: { eventId: 'e1' } };
  await handleJob(job);
  expect(sendGoogleCalendarStatus).toHaveBeenCalledWith(job);
});

test('LINE reminder jobs run the reminder sender', async () => {
  const { handleJob } = await load();
  const job = { id: 'j3', kind: 'line-reminder', payload: { eventId: 'e1' } };
  await handleJob(job);
  expect(sendLineReminder).toHaveBeenCalledWith(job);
  expect(prepareEvents).not.toHaveBeenCalled();
});

test('drainQueue claims jobs until the queue is empty', async () => {
  const { drainQueue } = await load();
  claimNextJob
    .mockResolvedValueOnce({ id: 'j1' })
    .mockResolvedValueOnce({ id: 'j2' })
    .mockResolvedValueOnce(null);
  const summary = await drainQueue({ leaseSeconds: 30 });
  expect(summary).toEqual({
    claimed: 2, done: 2, retried: 0, dead: 0, stale: 0,
  });
  expect(claimNextJob).toHaveBeenCalledWith({ leaseSeconds: 30, kinds: null });
});

test('drainQueue forwards a kind allowlist to the database claim', async () => {
  const { drainQueue } = await load();
  claimNextJob.mockResolvedValue(null);
  await drainQueue({ kinds: ['line-reminder'] });
  expect(claimNextJob).toHaveBeenCalledWith(expect.objectContaining({
    kinds: ['line-reminder'],
  }));
});

test('drainQueue stops at maxJobs even when more work is due', async () => {
  const { drainQueue } = await load();
  claimNextJob.mockResolvedValue({ id: 'j1' });
  const summary = await drainQueue({ maxJobs: 2 });
  expect(summary.claimed).toBe(2);
  expect(claimNextJob).toHaveBeenCalledTimes(2);
});

test('drainQueue tallies retried, dead and stale jobs without throwing', async () => {
  const { drainQueue } = await load();
  claimNextJob
    .mockResolvedValueOnce({ id: 'j1' })
    .mockResolvedValueOnce({ id: 'j2' })
    .mockResolvedValueOnce({ id: 'j3' })
    .mockResolvedValueOnce(null);
  runJob
    .mockResolvedValueOnce('pending')
    .mockResolvedValueOnce('dead')
    .mockResolvedValueOnce('stale');
  const summary = await drainQueue();
  expect(summary).toEqual({
    claimed: 3, done: 0, retried: 1, dead: 1, stale: 1,
  });
});
