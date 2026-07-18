import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let client;
let createEvent;
let updateEvent;
let enqueueJob;

const load = async ({ googleEnabled = false, remindersEnabled = false, reminderOffsets = [] } = {}) => {
  jest.resetModules();
  client = { query: jest.fn() };
  jest.doMock('../../config/index.js', () => ({
    __esModule: true,
    default: {
      ENABLE_GOOGLE_CALENDAR: googleEnabled,
      ENABLE_REMINDERS: remindersEnabled,
      REMINDER_OFFSETS: reminderOffsets,
      WORKER_MAX_ATTEMPTS: 3,
    },
  }));
  jest.doMock('../../services/database.js', () => ({
    query: (...args) => client.query(...args),
    withTransaction: jest.fn((fn) => fn(client)),
  }));
  createEvent = jest.fn().mockResolvedValue({
    id: 'event1', version: 1, start_at: '2099-07-20T07:00:00.000Z', all_day: false,
  });
  updateEvent = jest.fn().mockResolvedValue({
    id: 'event1', version: 2, start_at: '2099-07-20T08:00:00.000Z', all_day: false,
  });
  enqueueJob = jest.fn().mockResolvedValue({ id: 'job1' });
  jest.doMock('../../repositories/events.js', () => ({ createEvent, updateEvent }));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  return import('../../repositories/confirmations.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../config/index.js');
  jest.dontMock('../../repositories/events.js');
  jest.dontMock('../../repositories/jobs.js');
  jest.resetModules();
});

const pending = {
  id: 'confirmation1',
  state: 'draft',
  draft: { title: '開會', start: '2026-07-20T07:00:00.000Z', allDay: false },
  expires_at: '2099-01-01T00:00:00.000Z',
};

test('creates a durable clarification workflow without raw conversation text', async () => {
  const { createConfirmation } = await load();
  client.query.mockResolvedValueOnce({ rows: [{ id: 'confirmation1' }] });
  const draft = { title: '看診', start: null, allDay: false };
  await createConfirmation({
    ownerId: 'owner1',
    token: 'token1',
    draft,
    expiresAt: '2099-01-01T00:00:00Z',
    operation: 'create',
    missingFields: ['time'],
  });
  const [sql, params] = client.query.mock.calls[0];
  expect(sql).toMatch(/missing_fields/i);
  expect(params).toEqual([
    'owner1', 'token1', JSON.stringify(draft), '2099-01-01T00:00:00Z',
    'create', null, null, ['time'],
  ]);
});

test('refines the structured draft and clears missing fields', async () => {
  const { updateConfirmationDraft } = await load();
  client.query.mockResolvedValueOnce({ rows: [{ id: 'confirmation1', missing_fields: [] }] });
  const draft = { title: '看診', start: '2099-07-20T07:00:00Z', allDay: false };
  await expect(updateConfirmationDraft({
    ownerId: 'owner1', token: 'token1', draft, missingFields: [],
  })).resolves.toMatchObject({ id: 'confirmation1' });
  expect(client.query.mock.calls[0][0]).toMatch(/state = 'draft'/i);
});

test('finds the latest draft workflow even while clarification is incomplete', async () => {
  const { getLatestPendingWorkflow } = await load();
  client.query.mockResolvedValueOnce({ rows: [{ id: 'confirmation1', missing_fields: ['time'] }] });
  await expect(getLatestPendingWorkflow('owner1')).resolves.toMatchObject({ id: 'confirmation1' });
  const [sql, params] = client.query.mock.calls[0];
  expect(sql).not.toMatch(/cardinality/i);
  expect(params).toEqual(['owner1']);
});

test('confirm locks the row, creates one event, and records the result', async () => {
  const { settleConfirmation } = await load();
  client.query
    .mockResolvedValueOnce({ rows: [pending] })
    .mockResolvedValueOnce({ rowCount: 1 });
  const result = await settleConfirmation({ ownerId: 'owner1', token: 'token1', action: 'confirm' });
  expect(result).toEqual({
    state: 'confirmed',
    changed: true,
    event: {
      id: 'event1', version: 1, start_at: '2099-07-20T07:00:00.000Z', all_day: false,
    },
    syncQueued: false,
    reminderQueued: false,
  });
  expect(client.query.mock.calls[0][0]).toMatch(/for update/i);
  expect(createEvent).toHaveBeenCalledTimes(1);
  expect(client.query.mock.calls.some(([sql]) => /result_event_id/i.test(sql))).toBe(true);
});

test('confirm enqueues Google sync in the same transaction when connected', async () => {
  const { settleConfirmation } = await load({ googleEnabled: true });
  client.query
    .mockResolvedValueOnce({ rows: [pending] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rowCount: 1 });
  const result = await settleConfirmation({
    ownerId: 'owner1', token: 'token1', action: 'confirm', notificationTarget: 'U-line-1',
  });
  expect(enqueueJob).toHaveBeenCalledWith({
    kind: 'google-calendar-sync',
    payload: { ownerId: 'owner1', eventId: 'event1', notificationTarget: 'U-line-1' },
    idempotencyKey: 'google-calendar-sync:event1:1',
    maxAttempts: 3,
  }, expect.any(Function));
  expect(result.syncQueued).toBe(true);
  expect(client.query.mock.calls[1][0]).toMatch(/calendar_accounts/i);
});

test('confirm schedules one encrypted LINE reminder in the same transaction', async () => {
  const { settleConfirmation } = await load({ remindersEnabled: true });
  client.query
    .mockResolvedValueOnce({ rows: [pending] })
    .mockResolvedValueOnce({ rowCount: 0 }) // 取消本事件既有提醒 job（pattern）
    .mockResolvedValueOnce({ rows: [{ channel_target: { encrypted: 'U1' } }] })
    .mockResolvedValueOnce({ rowCount: 1 })
    .mockResolvedValueOnce({ rowCount: 1 });
  const result = await settleConfirmation({ ownerId: 'owner1', token: 'token1', action: 'confirm' });
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'line-reminder',
    payload: {
      ownerId: 'owner1',
      eventId: 'event1',
      channelTarget: { encrypted: 'U1' },
    },
    idempotencyKey: 'line-reminder:event1:start:1',
    maxAttempts: 3,
  }), expect.any(Function));
  expect(result.reminderQueued).toBe(true);
  expect(result.event.reminder_job_id).toBe('job1');
});

test('confirm schedules lead reminders at each configured offset besides the at-start one', async () => {
  const { settleConfirmation } = await load({ remindersEnabled: true, reminderOffsets: [60, 1440] });
  client.query
    .mockResolvedValue({ rows: [{ channel_target: { encrypted: 'U1' } }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [pending] });
  await settleConfirmation({ ownerId: 'owner1', token: 'token1', action: 'confirm' });
  const keys = enqueueJob.mock.calls.map(([job]) => job.idempotencyKey);
  expect(keys).toContain('line-reminder:event1:start:1'); // 到點
  expect(keys).toContain('line-reminder:event1:lead60:1'); // 提前 1 小時
  expect(keys).toContain('line-reminder:event1:lead1440:1'); // 提前 1 天
  const lead = enqueueJob.mock.calls.find(([job]) => job.idempotencyKey.includes('lead60'))[0];
  expect(lead.payload.leadMinutes).toBe(60);
  // 取消依 durable job key prefix，不另維護容易漂移的第二份索引表。
  expect(client.query.mock.calls.some(([sql]) => /idempotency_key LIKE/i.test(sql))).toBe(true);
});

test('re-confirming terminal state is a no-op', async () => {
  const { settleConfirmation } = await load();
  client.query.mockResolvedValueOnce({ rows: [{ ...pending, state: 'confirmed' }] });
  await expect(settleConfirmation({ ownerId: 'owner1', token: 'token1', action: 'confirm' }))
    .resolves.toEqual({ state: 'confirmed', changed: false, event: null });
  expect(createEvent).not.toHaveBeenCalled();
  expect(client.query).toHaveBeenCalledTimes(1);
});

test('cancel updates state without creating an event', async () => {
  const { settleConfirmation } = await load();
  client.query
    .mockResolvedValueOnce({ rows: [pending] })
    .mockResolvedValueOnce({ rowCount: 1 });
  await expect(settleConfirmation({ ownerId: 'owner1', token: 'token1', action: 'cancel' }))
    .resolves.toEqual({ state: 'cancelled', changed: true, event: null });
  expect(createEvent).not.toHaveBeenCalled();
});

test('confirming an edit applies optimistic locking and requeues provider sync', async () => {
  const { settleConfirmation } = await load({ googleEnabled: true });
  const edit = {
    ...pending,
    operation: 'update',
    target_event_id: 'event1',
    expected_version: 1,
    missing_fields: [],
  };
  client.query
    .mockResolvedValueOnce({ rows: [edit] })
    .mockResolvedValueOnce({ rows: [{ id: 'event1', version: 1, reminder_job_id: null }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rowCount: 1 });
  const result = await settleConfirmation({
    ownerId: 'owner1', token: 'token1', action: 'confirm', notificationTarget: 'U1',
  });
  expect(createEvent).not.toHaveBeenCalled();
  expect(updateEvent).toHaveBeenCalledWith('owner1', 'event1', edit.draft, {
    expectedVersion: 1,
    executor: expect.any(Function),
  });
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-calendar-sync',
    idempotencyKey: 'google-calendar-sync:event1:2',
  }), expect.any(Function));
  expect(result).toMatchObject({ state: 'confirmed', operation: 'update', syncQueued: true });
});

test('a stale edit is cancelled without overwriting a newer event version', async () => {
  const { settleConfirmation } = await load();
  const edit = {
    ...pending,
    operation: 'update',
    target_event_id: 'event1',
    expected_version: 1,
    missing_fields: [],
  };
  client.query
    .mockResolvedValueOnce({ rows: [edit] })
    .mockResolvedValueOnce({ rows: [{ id: 'event1', version: 2 }] })
    .mockResolvedValueOnce({ rowCount: 1 });
  await expect(settleConfirmation({
    ownerId: 'owner1', token: 'token1', action: 'confirm',
  })).resolves.toEqual({
    state: 'conflict', changed: false, event: null, operation: 'update',
  });
  expect(updateEvent).not.toHaveBeenCalled();
});
