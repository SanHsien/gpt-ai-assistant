import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;
let withTransaction;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  withTransaction = jest.fn((fn) => fn({ query }));
  jest.doMock('../../services/database.js', () => ({ query, withTransaction }));
  return import('../../repositories/tasks.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.resetModules();
});

test('createTask inserts owner-scoped and returns the row', async () => {
  const { createTask } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1', title: '買牛奶' }] });
  const task = await createTask('owner1', { title: '買牛奶' });
  expect(task).toEqual({ id: 't1', title: '買牛奶' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/insert into tasks/i);
  expect(params[0]).toBe('owner1');
  expect(params[1]).toBe('買牛奶');
  expect(params[3]).toBeNull();
});

test('listTasks filters by owner and status', async () => {
  const { listTasks } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1' }] });
  await listTasks('owner1', { status: 'open', limit: 5 });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/where owner_id = \$1/i);
  expect(sql).toMatch(/status = \$2/i);
  expect(params).toEqual(['owner1', 'open', null, null, null, 5, 0]);
});

test('completeTask only acts on open tasks (idempotent)', async () => {
  const { completeTask } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1', status: 'done' }] });
  expect(await completeTask('owner1', 't1')).toEqual({ id: 't1', status: 'done' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'done'/i);
  expect(sql).toMatch(/and status = 'open'/i);
  expect(sql).toMatch(/sync_status = 'pending'/i);
  expect(params).toEqual(['t1', 'owner1']);
});

test('completeTask returns null when nothing was open to complete', async () => {
  const { completeTask } = await load();
  query.mockResolvedValue({ rows: [] });
  expect(await completeTask('owner1', 't1')).toBeNull();
});

test('reopenTask only acts on done tasks', async () => {
  const { reopenTask } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1', status: 'open' }] });
  await reopenTask('owner1', 't1');
  const [sql] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'open', completed_at = null/i);
  expect(sql).toMatch(/and status = 'done'/i);
  expect(sql).toMatch(/sync_status = 'pending'/i);
});

test('deleteTask reports whether a row was removed', async () => {
  const { deleteTask } = await load();
  query.mockResolvedValueOnce({ rowCount: 1 });
  expect(await deleteTask('owner1', 't1')).toBe(true);
  query.mockResolvedValueOnce({ rowCount: 0 });
  expect(await deleteTask('owner1', 'missing')).toBe(false);
});

test('deleteTaskAndReturn returns the latest row for an atomic sync-aware delete', async () => {
  const { deleteTaskAndReturn } = await load();
  const executor = jest.fn().mockResolvedValue({ rows: [{ id: 't1', provider_task_id: 'g1' }] });
  await expect(deleteTaskAndReturn('owner1', 't1', executor))
    .resolves.toEqual({ id: 't1', provider_task_id: 'g1' });
  expect(executor.mock.calls[0][0]).toMatch(/delete from tasks.*returning \*/i);
});

test('getTaskForUpdate locks the row inside the caller transaction', async () => {
  const { getTaskForUpdate } = await load();
  const executor = jest.fn().mockResolvedValue({ rows: [{ id: 't1' }] });
  await getTaskForUpdate('owner1', 't1', executor);
  expect(executor.mock.calls[0][0]).toMatch(/for update/i);
});

test('createTask stores priority and tags', async () => {
  const { createTask } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1' }] });
  await createTask('owner1', { title: 'x', priority: 'high', tags: ['工作'] });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/priority, tags/i);
  expect(params[5]).toBe('high');
  expect(params[6]).toEqual(['工作']);
});

test('listTasks supports tag filter and offset for pagination', async () => {
  const { listTasks } = await load();
  query.mockResolvedValue({ rows: [] });
  await listTasks('owner1', {
    status: 'open', tag: '購物', limit: 7, offset: 6,
  });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/unnest\(tags\)/i);
  expect(sql).toMatch(/btrim\(stored_tag/i);
  expect(sql).toMatch(/LIMIT \$6 OFFSET \$7/i);
  expect(sql).toMatch(/CASE priority WHEN 'high'/i);
  expect(params).toEqual(['owner1', 'open', null, null, '購物', 7, 6]);
});

test('listTasks applies both boundaries for today and this-week views', async () => {
  const { listTasks } = await load();
  query.mockResolvedValue({ rows: [] });
  const dueAfter = new Date('2026-07-12T16:00:00Z');
  const dueBefore = new Date('2026-07-19T16:00:00Z');
  await listTasks('owner1', { dueAfter, dueBefore });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/due_at >= \$3/i);
  expect(sql).toMatch(/due_at < \$4/i);
  expect(params.slice(2, 4)).toEqual([dueAfter, dueBefore]);
});

test('setTaskPriority only acts on open tasks', async () => {
  const { setTaskPriority } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1', priority: 'high' }] });
  expect(await setTaskPriority('owner1', 't1', 'high')).toEqual({ id: 't1', priority: 'high' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/set priority = \$3/i);
  expect(sql).toMatch(/and status = 'open'/i);
  expect(sql).toMatch(/sync_status = 'pending'/i);
  expect(params).toEqual(['t1', 'owner1', 'high']);
});

test('markTaskSynced stores provider id and synced status', async () => {
  const { markTaskSynced } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1', sync_status: 'synced' }] });
  await markTaskSynced('owner1', 't1', 'g-task-1');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/sync_status = 'synced'/i);
  expect(sql).toMatch(/provider_task_id = \$3/i);
  expect(params).toEqual(['t1', 'owner1', 'g-task-1']);
});

test('markTaskSyncError sets error status but keeps the row', async () => {
  const { markTaskSyncError } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1', sync_status: 'error' }] });
  await markTaskSyncError('owner1', 't1', 'google_500');
  const [sql] = query.mock.calls[0];
  expect(sql).toMatch(/sync_status = 'error'/i);
  expect(sql).not.toMatch(/delete/i);
});

test('listUnsyncedTasks returns open tasks not yet synced', async () => {
  const { listUnsyncedTasks } = await load();
  query.mockResolvedValue({ rows: [{ id: 't1' }] });
  await listUnsyncedTasks('owner1');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'open' and sync_status <> 'synced'/i);
  expect(params[0]).toBe('owner1');
});

const SYNCED_TASK = {
  id: 't1',
  owner_id: 'owner1',
  title: '買牛奶',
  notes: null,
  status: 'open',
  completed_at: null,
  provider_task_id: 'g1',
  sync_status: 'synced',
  version: 3,
};

test('applyInboundTaskUpdate skips when no local task matches the provider id', async () => {
  const { applyInboundTaskUpdate } = await load();
  query.mockResolvedValueOnce({ rows: [] });
  const r = await applyInboundTaskUpdate({ ownerId: 'owner1', providerTaskId: 'g1', incoming: { status: 'completed' } });
  expect(r).toEqual({ applied: false, reason: 'not_found' });
});

test('applyInboundTaskUpdate defers to a pending local edit (bot wins)', async () => {
  const { applyInboundTaskUpdate } = await load();
  query.mockResolvedValueOnce({ rows: [{ ...SYNCED_TASK, sync_status: 'pending' }] });
  const r = await applyInboundTaskUpdate({ ownerId: 'owner1', providerTaskId: 'g1', incoming: { status: 'completed' } });
  expect(r).toEqual({ applied: false, reason: 'local_pending' });
  expect(query).toHaveBeenCalledTimes(1);
});

test('applyInboundTaskUpdate reclaims a Google-side deletion', async () => {
  const { applyInboundTaskUpdate } = await load();
  query
    .mockResolvedValueOnce({ rows: [SYNCED_TASK] })
    .mockResolvedValueOnce({ rowCount: 1 });
  const r = await applyInboundTaskUpdate({ ownerId: 'owner1', providerTaskId: 'g1', incoming: { deleted: true } });
  expect(r).toEqual({ applied: true, action: 'deleted' });
  expect(query.mock.calls[1][0]).toMatch(/delete from tasks/i);
});

test('applyInboundTaskUpdate marks done when Google completed the task', async () => {
  const { applyInboundTaskUpdate } = await load();
  query
    .mockResolvedValueOnce({ rows: [SYNCED_TASK] })
    .mockResolvedValueOnce({ rows: [{ ...SYNCED_TASK, status: 'done' }] });
  const r = await applyInboundTaskUpdate({ ownerId: 'owner1', providerTaskId: 'g1', incoming: { status: 'completed', title: '買牛奶' } });
  expect(r.applied).toBe(true);
  const [sql, params] = query.mock.calls[1];
  expect(sql).toMatch(/sync_status = 'synced'/i); // 不觸發 outbound（防迴圈）
  expect(params[4]).toBe('done');
  expect(params[5]).not.toBeNull(); // completed_at
});

test('applyInboundTaskUpdate strips the sync marker from notes before applying', async () => {
  const { applyInboundTaskUpdate } = await load();
  query
    .mockResolvedValueOnce({ rows: [SYNCED_TASK] })
    .mockResolvedValueOnce({ rows: [{ id: 't1' }] });
  await applyInboundTaskUpdate({
    ownerId: 'owner1',
    providerTaskId: 'g1',
    incoming: { status: 'needsAction', title: '買牛奶', notes: '記得買燕麥奶\n\n[gpt-ai-assistant:t1]' },
  });
  const notesParam = query.mock.calls[1][1][3];
  expect(notesParam).toBe('記得買燕麥奶'); // 標記已剝除
});

test('applyInboundTaskUpdate treats a marker-only echo as no change', async () => {
  const { applyInboundTaskUpdate } = await load();
  query.mockResolvedValueOnce({ rows: [SYNCED_TASK] }); // notes: null, status: open
  const r = await applyInboundTaskUpdate({
    ownerId: 'owner1',
    providerTaskId: 'g1',
    incoming: { status: 'needsAction', title: '買牛奶', notes: '[gpt-ai-assistant:t1]' },
  });
  expect(r).toEqual({ applied: false, reason: 'no_change' });
  expect(query).toHaveBeenCalledTimes(1); // 只 SELECT，未寫入
});
