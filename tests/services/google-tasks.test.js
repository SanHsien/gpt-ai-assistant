import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let authorizedRequest;
let getTaskForUpdate;
let markTaskSynced;
let markTaskSyncError;
let getCalendarAccount;
let enqueueJob;
let listUnsyncedTasks;
let withTransaction;

const TASK = {
  id: 't1', owner_id: 'o1', title: '買牛奶', status: 'open', due_at: '2026-07-20T15:00:00+08:00', timezone: 'Asia/Taipei', version: 1, provider_task_id: null, notes: null, created_at: '2026-07-17T00:00:00.000Z',
};

const load = async () => {
  jest.resetModules();
  process.env.ENABLE_GOOGLE_TASKS = 'true';
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://x/cb';
  authorizedRequest = jest.fn(async (ownerId, request) => ({
    response: {
      data: request.method === 'GET' ? { items: [] } : { id: 'g-task-1' },
    },
  }));
  getTaskForUpdate = jest.fn().mockResolvedValue(TASK);
  markTaskSynced = jest.fn(async (o, id, pid) => ({ id, provider_task_id: pid, sync_status: 'synced' }));
  markTaskSyncError = jest.fn().mockResolvedValue({});
  getCalendarAccount = jest.fn().mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/tasks'] });
  enqueueJob = jest.fn().mockResolvedValue({ id: 'j1' });
  listUnsyncedTasks = jest.fn().mockResolvedValue([TASK]);
  const client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  jest.doMock('../../services/google-calendar.js', () => ({
    authorizedRequest,
    GOOGLE_TASKS_SCOPE: 'https://www.googleapis.com/auth/tasks',
    isGoogleOAuthConfigured: () => true,
  }));
  jest.doMock('../../repositories/tasks.js', () => ({
    getTaskForUpdate, markTaskSynced, markTaskSyncError, listUnsyncedTasks,
  }));
  jest.doMock('../../repositories/calendar-accounts.js', () => ({ getCalendarAccount }));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  jest.doMock('../../services/database.js', () => ({ withTransaction }));
  return import('../../services/google-tasks.js');
};

afterEach(() => {
  delete process.env.ENABLE_GOOGLE_TASKS;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  ['../../services/google-calendar.js', '../../repositories/tasks.js',
    '../../repositories/calendar-accounts.js', '../../repositories/jobs.js', '../../services/database.js']
    .forEach((mod) => jest.dontMock(mod));
  jest.resetModules();
});

test('inserts a new task and stores the returned Google id; due keeps date only', async () => {
  const { syncTaskToGoogle } = await load();
  await syncTaskToGoogle({ ownerId: 'o1', taskId: 't1' });
  const [, request] = authorizedRequest.mock.calls.find(([, call]) => call.method === 'POST');
  expect(request.method).toBe('POST');
  expect(request.data.title).toBe('買牛奶');
  expect(request.data.notes).toContain('[gpt-ai-assistant:t1]');
  expect(request.data.due).toBe('2026-07-20T00:00:00.000Z'); // date only, time dropped
  expect(request.data.status).toBe('needsAction');
  expect(markTaskSynced).toHaveBeenCalledWith('o1', 't1', 'g-task-1', expect.any(Function));
});

test('patches an already-synced task instead of inserting', async () => {
  const { syncTaskToGoogle } = await load();
  getTaskForUpdate.mockResolvedValue({ ...TASK, provider_task_id: 'g-task-1', status: 'done' });
  await syncTaskToGoogle({ ownerId: 'o1', taskId: 't1' });
  const [, request] = authorizedRequest.mock.calls[0];
  expect(request.method).toBe('PATCH');
  expect(request.data.status).toBe('completed');
  expect(request.url).toContain('g-task-1');
});

test('a 4xx sync error is recorded, not retried, and keeps the local task', async () => {
  const { syncTaskToGoogle } = await load();
  authorizedRequest.mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 400 } }));
  await expect(syncTaskToGoogle({ ownerId: 'o1', taskId: 't1' })).rejects.toMatchObject({ retryable: false });
  expect(markTaskSyncError).toHaveBeenCalledWith('o1', 't1', 'google_400');
});

test('uses the task timezone when the UTC date is the previous day', async () => {
  const { syncTaskToGoogle } = await load();
  getTaskForUpdate.mockResolvedValue({
    ...TASK,
    due_at: '2026-07-19T16:30:00.000Z', // 2026-07-20 00:30 in Taipei
  });
  await syncTaskToGoogle({ ownerId: 'o1', taskId: 't1' });
  const [, request] = authorizedRequest.mock.calls.find(([, call]) => call.method === 'POST');
  expect(request.data.due).toBe('2026-07-20T00:00:00.000Z');
});

test('recovers an ambiguous prior insert by marker instead of creating a duplicate', async () => {
  const { syncTaskToGoogle } = await load();
  authorizedRequest.mockImplementation(async (ownerId, request) => ({
    response: {
      data: request.method === 'GET'
        ? { items: [{ id: 'existing-google-task', notes: '[gpt-ai-assistant:t1]' }] }
        : { id: 'existing-google-task' },
    },
  }));
  await syncTaskToGoogle({ ownerId: 'o1', taskId: 't1' });
  expect(authorizedRequest.mock.calls.some(([, request]) => request.method === 'POST')).toBe(false);
  expect(authorizedRequest.mock.calls.some(([, request]) => request.method === 'PATCH')).toBe(true);
  expect(markTaskSynced).toHaveBeenCalledWith('o1', 't1', 'existing-google-task', expect.any(Function));
});

test('serializes each remote upsert inside a row-lock transaction', async () => {
  const { syncTaskToGoogle } = await load();
  await syncTaskToGoogle({ ownerId: 'o1', taskId: 't1' });
  expect(withTransaction).toHaveBeenCalledTimes(1);
  expect(getTaskForUpdate).toHaveBeenCalledWith('o1', 't1', expect.any(Function));
  expect(markTaskSynced).toHaveBeenCalledWith('o1', 't1', 'g-task-1', expect.any(Function));
});

test('deleteGoogleTask treats 404/410 as already gone', async () => {
  const { deleteGoogleTask } = await load();
  authorizedRequest.mockRejectedValue(Object.assign(new Error('gone'), { response: { status: 410 } }));
  expect(await deleteGoogleTask('o1', 'g-task-1')).toBe(false);
});

test('hasTasksScope reflects the granted scopes', async () => {
  const { hasTasksScope } = await load();
  expect(await hasTasksScope('o1')).toBe(true);
  getCalendarAccount.mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/calendar.events.owned'] });
  expect(await hasTasksScope('o1')).toBe(false);
});

test('enqueuePendingGoogleTasks queues an upsert per unsynced task', async () => {
  const { enqueuePendingGoogleTasks } = await load();
  const count = await enqueuePendingGoogleTasks('o1');
  expect(count).toBe(1);
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-tasks-sync',
    idempotencyKey: 'google-tasks-sync:t1:1:upsert',
  }));
});
