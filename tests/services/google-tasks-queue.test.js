import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let enqueueJob;
let reviveDeadJob;
let listUnsyncedTasks;

const load = async () => {
  jest.resetModules();
  enqueueJob = jest.fn();
  reviveDeadJob = jest.fn();
  listUnsyncedTasks = jest.fn();
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob, reviveDeadJob }));
  jest.doMock('../../repositories/tasks.js', () => ({ listUnsyncedTasks }));
  jest.doMock('../../config/index.js', () => ({
    __esModule: true,
    default: { WORKER_MAX_ATTEMPTS: 3 },
  }));
  return import('../../services/google-tasks-queue.js');
};

afterEach(() => {
  jest.dontMock('../../repositories/jobs.js');
  jest.dontMock('../../repositories/tasks.js');
  jest.dontMock('../../config/index.js');
  jest.resetModules();
});

test('backfill enqueues each unsynced task without reviving a new job', async () => {
  const { enqueuePendingGoogleTasks } = await load();
  listUnsyncedTasks.mockResolvedValue([{ id: 't1', version: 2 }]);
  enqueueJob.mockResolvedValue({ id: 'j1' });

  await expect(enqueuePendingGoogleTasks('owner-1')).resolves.toBe(1);

  expect(enqueueJob).toHaveBeenCalledWith({
    kind: 'google-tasks-sync',
    payload: { ownerId: 'owner-1', taskId: 't1', action: 'upsert' },
    idempotencyKey: 'google-tasks-sync:t1:2:upsert',
    maxAttempts: 3,
  });
  expect(reviveDeadJob).not.toHaveBeenCalled();
});

test('backfill safely revives the same dead sync job after a permanent setup error is fixed', async () => {
  const { enqueuePendingGoogleTasks } = await load();
  listUnsyncedTasks.mockResolvedValue([{ id: 't1', version: 1 }]);
  enqueueJob.mockResolvedValue(null);
  reviveDeadJob.mockResolvedValue({ id: 'j-dead', status: 'pending' });

  await expect(enqueuePendingGoogleTasks('owner-1')).resolves.toBe(1);

  expect(reviveDeadJob).toHaveBeenCalledWith('google-tasks-sync:t1:1:upsert');
});
