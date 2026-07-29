import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let enqueueJob;
let query;
let withTransaction;

const load = async () => {
  jest.resetModules();
  process.env.REMINDER_OFFSETS = '60,1440';
  enqueueJob = jest.fn()
    .mockResolvedValueOnce({ id: 'due-job' })
    .mockResolvedValueOnce({ id: 'lead-60-job' })
    .mockResolvedValueOnce({ id: 'lead-1440-job' });
  query = jest.fn().mockResolvedValue({ rowCount: 2 });
  withTransaction = jest.fn((fn) => fn({ query }));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  jest.doMock('../../services/database.js', () => ({ query, withTransaction }));
  return import('../../services/task-reminder-scheduling.js');
};

afterEach(() => {
  delete process.env.REMINDER_OFFSETS;
  jest.dontMock('../../repositories/jobs.js');
  jest.dontMock('../../services/database.js');
  jest.useRealTimers();
  jest.resetModules();
});

test('schedules due-time and configured lead reminders with versioned keys', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:00:00Z'));
  const { scheduleTaskReminders } = await load();
  const task = {
    id: 'task-1', version: 2, due_at: '2026-07-20T08:00:00.000Z',
  };

  const result = await scheduleTaskReminders({
    ownerId: 'owner-1',
    task,
    channelTarget: { encrypted: 'target' },
  });

  expect(result).toEqual({ queued: 3 });
  expect(enqueueJob.mock.calls.map(([job]) => job.idempotencyKey)).toEqual([
    'task-reminder:task-1:due:2',
    'task-reminder:task-1:lead60:2',
    'task-reminder:task-1:lead1440:2',
  ]);
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'task-reminder',
    payload: expect.objectContaining({
      ownerId: 'owner-1', taskId: 'task-1', taskVersion: 2, leadMinutes: 1440,
    }),
    runAt: new Date('2026-07-19T08:00:00.000Z'),
  }), undefined);
});

test('scheduleTaskReminders never overlaps enqueue calls on one transaction executor', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:00:00Z'));
  const { scheduleTaskReminders } = await load();
  let releaseFirst;
  enqueueJob.mockReset();
  enqueueJob
    .mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ id: 'due-job' });
    }))
    .mockResolvedValue({ id: 'lead-job' });

  const pending = scheduleTaskReminders({
    ownerId: 'owner-1',
    task: { id: 'task-1', version: 2, due_at: '2026-07-20T08:00:00.000Z' },
    channelTarget: { encrypted: 'target' },
    executor: query,
  });
  await Promise.resolve();
  expect(enqueueJob).toHaveBeenCalledTimes(1);
  releaseFirst();
  await expect(pending).resolves.toEqual({ queued: 3 });
  expect(enqueueJob).toHaveBeenCalledTimes(3);
});

test('does not schedule tasks without a future due candidate', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-20T09:00:00Z'));
  const { scheduleTaskReminders } = await load();
  await expect(scheduleTaskReminders({
    ownerId: 'owner-1',
    task: { id: 'task-1', version: 1, due_at: null },
    channelTarget: { encrypted: 'target' },
  })).resolves.toEqual({ queued: 0 });
  await expect(scheduleTaskReminders({
    ownerId: 'owner-1',
    task: { id: 'task-2', version: 1, due_at: '2026-07-20T08:00:00Z' },
    channelTarget: { encrypted: 'target' },
  })).resolves.toEqual({ queued: 0 });
  expect(enqueueJob).not.toHaveBeenCalled();
});

test('cancels every pending reminder for one task prefix', async () => {
  const { cancelPendingTaskReminders } = await load();
  await cancelPendingTaskReminders('task-1');
  expect(query).toHaveBeenCalledWith(expect.stringMatching(/status = 'pending'/), [
    'task-reminder:task-1:%',
  ]);
});

test('backfills owner-scoped future due tasks that have no current-version due job', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:00:00Z'));
  const { backfillTaskReminders } = await load();
  query.mockResolvedValueOnce({
    rows: [{
      id: 'task-1',
      owner_id: 'owner-1',
      version: 2,
      status: 'open',
      due_at: '2026-07-20T08:00:00.000Z',
      channel_target: { encrypted: 'target' },
    }],
  });
  enqueueJob.mockReset();
  enqueueJob.mockResolvedValue({ id: 'job' });
  await expect(backfillTaskReminders({ limit: 10 })).resolves.toEqual({ scheduled: 1 });
  expect(query.mock.calls[0][0]).toMatch(/join users u on u.id = t.owner_id/i);
  expect(query.mock.calls[0][0]).toMatch(/not exists/i);
  expect(query.mock.calls[0][0]).toMatch(/task-reminder:.*:due:/is);
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    payload: expect.objectContaining({
      ownerId: 'owner-1', taskId: 'task-1', taskVersion: 2,
    }),
  }), expect.any(Function));
});
