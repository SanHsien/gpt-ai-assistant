import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;
let withTransaction;
let enqueueJob;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  withTransaction = jest.fn((fn) => fn({ query }));
  enqueueJob = jest.fn().mockResolvedValue({ id: 'job1' });
  jest.doMock('../../services/database.js', () => ({ query, withTransaction }));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  return import('../../repositories/events.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../repositories/jobs.js');
  jest.resetModules();
});

const draft = {
  title: '開會',
  start: '2026-07-20T07:00:00.000Z',
  end: '2026-07-20T09:00:00.000Z',
  allDay: false,
  location: '台北',
  recurrence: { freq: 'WEEKLY' },
};

test('createEvent inserts owner-scoped and returns the row', async () => {
  const { createEvent } = await load();
  query.mockResolvedValue({ rows: [{ id: 'ev1' }] });
  const ev = await createEvent('owner1', draft);
  expect(ev).toEqual({ id: 'ev1' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/insert into events/i);
  expect(params[0]).toBe('owner1');
  expect(params[1]).toBe('開會');
  expect(params[8]).toBe(JSON.stringify({ freq: 'WEEKLY' }));
});

test('getEvent scopes by owner and id, returns null when not found', async () => {
  const { getEvent } = await load();
  query.mockResolvedValueOnce({ rows: [{ id: 'ev1' }] });
  expect(await getEvent('owner1', 'ev1')).toEqual({ id: 'ev1' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/where id = \$1 and owner_id = \$2/i);
  expect(params).toEqual(['ev1', 'owner1']);
  query.mockResolvedValueOnce({ rows: [] });
  expect(await getEvent('owner1', 'missing')).toBeNull();
});

test('getEventByReference accepts local UUIDs and provider ids without unsafe UUID casts', async () => {
  const { getEventByReference } = await load();
  query
    .mockResolvedValueOnce({ rows: [{ id: '65e39296-9da6-46c2-8ae7-1874ce286b95' }] })
    .mockResolvedValueOnce({
      rows: [{
        id: 'local-1', provider_event_id: 'gpta5a7fc4c865a84f8dbf11e0de6269c597',
      }],
    });

  await expect(getEventByReference(
    'owner1',
    '65e39296-9da6-46c2-8ae7-1874ce286b95',
  )).resolves.toMatchObject({ id: '65e39296-9da6-46c2-8ae7-1874ce286b95' });
  await expect(getEventByReference(
    'owner1',
    'gpta5a7fc4c865a84f8dbf11e0de6269c597',
  )).resolves.toMatchObject({ provider_event_id: 'gpta5a7fc4c865a84f8dbf11e0de6269c597' });

  expect(query.mock.calls[0][0]).toMatch(/where id = \$1 and owner_id = \$2/i);
  expect(query.mock.calls[1][0]).toMatch(/provider_event_id = \$2/i);
});

test('getEventByReferenceForUpdate locks either local or provider references', async () => {
  const { getEventByReferenceForUpdate } = await load();
  query.mockResolvedValue({ rows: [{ id: 'ev1' }] });
  await getEventByReferenceForUpdate('owner1', '65e39296-9da6-46c2-8ae7-1874ce286b95', query);
  expect(query.mock.calls[0][0]).toMatch(/for update/i);
});

const inboundDraft = {
  title: '新標題',
  start: '2026-07-21T06:00:00.000Z',
  end: '2026-07-21T07:00:00.000Z',
  allDay: false,
  timezone: 'Asia/Taipei',
};

const syncedEvent = {
  id: 'ev1',
  status: 'confirmed',
  recurrence: null,
  sync_status: 'synced',
  provider_updated_at: null,
  title: '舊標題',
  start_at: '2026-07-20T06:00:00.000Z',
  end_at: '2026-07-20T07:00:00.000Z',
  timezone: 'Asia/Taipei',
  all_day: false,
  location: null,
  notes: null,
  reminder_job_id: 'oldjob',
};

const callInbound = async (fn, overrides = {}) => fn({
  ownerId: 'owner1',
  providerEventId: 'gpta1',
  draft: inboundDraft,
  providerUpdatedAt: '2026-07-18T00:00:00.000Z',
  remindAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  remindersEnabled: true,
  ...overrides,
});

test('applyInboundEventUpdate skips when local edit is still pending (bot edit wins)', async () => {
  const { applyInboundEventUpdate } = await load();
  query.mockResolvedValueOnce({ rows: [{ ...syncedEvent, sync_status: 'pending' }] });
  const result = await callInbound(applyInboundEventUpdate);
  expect(result).toEqual({ applied: false, reason: 'local_pending' });
  expect(query).toHaveBeenCalledTimes(1); // 只 SELECT，未寫入
});

test('applyInboundEventUpdate skips a stale Google update already absorbed', async () => {
  const { applyInboundEventUpdate } = await load();
  query.mockResolvedValueOnce({
    rows: [{ ...syncedEvent, provider_updated_at: '2026-07-19T00:00:00.000Z' }],
  });
  const result = await callInbound(applyInboundEventUpdate); // providerUpdatedAt 07-18 < 07-19
  expect(result).toEqual({ applied: false, reason: 'stale' });
  expect(query).toHaveBeenCalledTimes(1);
});

test('applyInboundEventUpdate skips recurring events (out of slice scope)', async () => {
  const { applyInboundEventUpdate } = await load();
  query.mockResolvedValueOnce({ rows: [{ ...syncedEvent, recurrence: { freq: 'WEEKLY' } }] });
  const result = await callInbound(applyInboundEventUpdate);
  expect(result).toEqual({ applied: false, reason: 'recurring' });
});

test('applyInboundEventUpdate only advances the watermark when fields are unchanged', async () => {
  const { applyInboundEventUpdate } = await load();
  const unchanged = {
    ...syncedEvent, title: '新標題', start_at: '2026-07-21T06:00:00.000Z', end_at: '2026-07-21T07:00:00.000Z',
  };
  query
    .mockResolvedValueOnce({ rows: [unchanged] }) // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [] }); // UPDATE provider_updated_at
  const result = await callInbound(applyInboundEventUpdate);
  expect(result).toEqual({ applied: false, reason: 'no_change' });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[1][0]).toMatch(/set provider_updated_at = \$3/i);
  expect(enqueueJob).not.toHaveBeenCalled();
});

test('applyInboundEventUpdate applies changes, cancels old reminder, reschedules a new one', async () => {
  const { applyInboundEventUpdate } = await load();
  query
    .mockResolvedValueOnce({ rows: [syncedEvent] }) // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [{ id: 'ev1', version: 2 }] }) // UPDATE fields RETURNING
    .mockResolvedValueOnce({ rows: [] }) // cancel old reminder job
    .mockResolvedValueOnce({ rows: [{ channel_target: { e: 1 } }] }) // SELECT channel_target
    .mockResolvedValueOnce({ rows: [] }); // UPDATE reminder_job_id
  const result = await callInbound(applyInboundEventUpdate);
  expect(result.applied).toBe(true);
  expect(result.event.reminder_job_id).toBe('job1');
  // 套用時設 sync_status='synced'，不觸發 outbound。
  expect(query.mock.calls[1][0]).toMatch(/sync_status = 'synced'/i);
  // 取消舊提醒 job。
  expect(query.mock.calls[2][1]).toEqual(['line-reminder:ev1:%']);
  // 重排提醒沿用版本粒度 idempotencyKey。
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'line-reminder',
    idempotencyKey: 'line-reminder:ev1:start:2',
  }), expect.any(Function));
});

test('applyInboundEventUpdate preserves the local timezone when Google omits it', async () => {
  const { applyInboundEventUpdate } = await load();
  query
    .mockResolvedValueOnce({ rows: [syncedEvent] })
    .mockResolvedValueOnce({ rows: [{ id: 'ev1', version: 2 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  const result = await callInbound(applyInboundEventUpdate, {
    draft: { ...inboundDraft, timezone: undefined },
    remindersEnabled: false,
  });
  expect(result.applied).toBe(true);
  expect(query.mock.calls[1][1][5]).toBe('Asia/Taipei');
});

test('listEvents filters by owner and range', async () => {
  const { listEvents } = await load();
  query.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }] });
  const rows = await listEvents('owner1', { from: '2026-07-01T00:00:00Z', limit: 10 });
  expect(rows).toHaveLength(2);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/order by start_at/i);
  expect(params).toEqual(['owner1', '2026-07-01T00:00:00Z', null, 10]);
});

test('updateEvent bumps version and scopes by owner', async () => {
  const { updateEvent } = await load();
  query.mockResolvedValue({ rows: [{ id: 'ev1', version: 2 }] });
  const ev = await updateEvent('owner1', 'ev1', draft);
  expect(ev).toEqual({ id: 'ev1', version: 2 });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/version = version \+ 1/i);
  expect(params[0]).toBe('ev1');
  expect(params[1]).toBe('owner1');
  expect(params[10]).toBeNull();
});

test('updateEvent can enforce optimistic version', async () => {
  const { updateEvent } = await load();
  query.mockResolvedValue({ rows: [] });
  expect(await updateEvent('owner1', 'ev1', draft, { expectedVersion: 3 })).toBeNull();
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/version = \$11/i);
  expect(params[10]).toBe(3);
});

test('updateEvent can run inside a transaction and marks Google sync pending', async () => {
  const { updateEvent } = await load();
  const executor = jest.fn().mockResolvedValue({ rows: [{ id: 'ev1', version: 4 }] });
  await expect(updateEvent('owner1', 'ev1', draft, {
    expectedVersion: 3,
    executor,
  })).resolves.toEqual({ id: 'ev1', version: 4 });
  expect(query).not.toHaveBeenCalled();
  const [sql] = executor.mock.calls[0];
  expect(sql).toMatch(/sync_status = 'pending'/i);
  expect(sql).toMatch(/synced_at = null/i);
  expect(sql).toMatch(/reminder_job_id = null/i);
});

test('listEventConflicts finds overlapping active events and excludes the edited event', async () => {
  const { listEventConflicts } = await load();
  query.mockResolvedValue({ rows: [{ id: 'other' }] });
  await expect(listEventConflicts('owner1', draft, { excludeEventId: 'ev1' }))
    .resolves.toEqual([{ id: 'other' }]);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'confirmed'/i);
  expect(sql).toMatch(/id <> \$4/i);
  expect(sql).toMatch(/start_at < \$3/i);
  expect(params).toEqual([
    'owner1',
    draft.start,
    draft.end,
    'ev1',
    3,
  ]);
});

test('deleteEvent returns whether a row was removed', async () => {
  const { deleteEvent } = await load();
  query.mockResolvedValueOnce({ rowCount: 1 });
  expect(await deleteEvent('owner1', 'ev1')).toBe(true);
  query.mockResolvedValueOnce({ rowCount: 0 });
  expect(await deleteEvent('owner1', 'missing')).toBe(false);
});

test('completeEvent atomically marks the event and cancels a pending reminder job', async () => {
  const { completeEvent } = await load();
  query.mockResolvedValue({ rows: [{ id: 'ev1', status: 'completed' }] });
  await expect(completeEvent('owner1', 'ev1'))
    .resolves.toEqual({ id: 'ev1', status: 'completed' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'completed'/i);
  expect(sql).toMatch(/update jobs/i);
  expect(params).toEqual(['owner1', 'ev1', null]);
});

test('listUnsyncedEvents selects future pending rows, including mapped edits', async () => {
  const { listUnsyncedEvents } = await load();
  query.mockResolvedValue({ rows: [{ id: 'ev1' }] });
  await expect(listUnsyncedEvents('owner1', 20)).resolves.toEqual([{ id: 'ev1' }]);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/sync_status = 'pending'/i);
  expect(sql).toMatch(/start_at >= now/i);
  expect(params).toEqual(['owner1', 20]);
});

test('listSyncFailedEvents returns owner-scoped failures newest first', async () => {
  const { listSyncFailedEvents } = await load();
  query.mockResolvedValue({ rows: [{ id: 'ev1', sync_status: 'error' }] });
  await expect(listSyncFailedEvents('owner1', 4))
    .resolves.toEqual([{ id: 'ev1', sync_status: 'error' }]);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/owner_id = \$1/i);
  expect(sql).toMatch(/sync_status = 'error'/i);
  expect(sql).toMatch(/order by updated_at desc/i);
  expect(params).toEqual(['owner1', 4]);
});

test('enqueueEventSyncRetry atomically marks pending and creates one versioned job', async () => {
  const { enqueueEventSyncRetry } = await load();
  query.mockResolvedValueOnce({ rows: [{ id: 'ev1', version: 2 }] });
  await expect(enqueueEventSyncRetry({
    ownerId: 'owner1', eventId: 'ev1', notificationTarget: 'U1',
  })).resolves.toMatchObject({ event: { id: 'ev1', version: 2 }, job: { id: 'job1' } });
  expect(query.mock.calls[0][0]).toMatch(/sync_status = 'pending'/i);
  expect(query.mock.calls[0][0]).toMatch(/sync_status = 'error'/i);
  expect(enqueueJob).toHaveBeenCalledWith({
    kind: 'google-calendar-sync',
    payload: { ownerId: 'owner1', eventId: 'ev1', notificationTarget: 'U1' },
    idempotencyKey: 'google-calendar-sync:ev1:2:manual',
    maxAttempts: 3,
  }, expect.any(Function));
});

test('markEventSynced records the provider id and clears sync errors', async () => {
  const { markEventSynced } = await load();
  query.mockResolvedValue({ rows: [{ id: 'ev1', provider_event_id: 'google1' }] });
  await markEventSynced('owner1', 'ev1', 'google1');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/sync_status = 'synced'/i);
  expect(sql).toMatch(/sync_error_code = null/i);
  expect(params).toEqual(['ev1', 'owner1', 'google1']);
});
