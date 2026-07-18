import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let upsertUser;
let createTask;
let listTasks;
let getTask;
let completeTask;
let reopenTask;
let deleteTaskAndReturn;
let markTaskSyncPending;
let isDatabaseConfigured;
let withTransaction;
let parseTaskDraft;
let isGoogleTasksEnabled;
let hasTasksScope;
let enqueueJob;

const load = async ({ enabled = true, databaseConfigured = true } = {}) => {
  jest.resetModules();
  process.env.ENABLE_TASKS = enabled ? 'true' : 'false';
  upsertUser = jest.fn().mockResolvedValue({ id: 'owner-1', timezone: null });
  createTask = jest.fn().mockResolvedValue({ id: 't1', title: '買牛奶', version: 1 });
  listTasks = jest.fn().mockResolvedValue([]);
  getTask = jest.fn().mockResolvedValue(null);
  completeTask = jest.fn().mockResolvedValue({ id: 't1', title: '買牛奶', version: 2 });
  reopenTask = jest.fn().mockResolvedValue({ id: 't1', title: '買牛奶', version: 2 });
  deleteTaskAndReturn = jest.fn().mockResolvedValue({ id: 't1', version: 3, provider_task_id: null });
  markTaskSyncPending = jest.fn().mockResolvedValue({});
  isDatabaseConfigured = jest.fn().mockReturnValue(databaseConfigured);
  const client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  parseTaskDraft = jest.fn(async ({ text }) => ({ valid: true, errors: [], value: { title: text } }));
  isGoogleTasksEnabled = jest.fn().mockReturnValue(false);
  hasTasksScope = jest.fn().mockResolvedValue(true);
  enqueueJob = jest.fn().mockResolvedValue({ id: 'j1' });
  jest.doMock('../../../repositories/users.js', () => ({ upsertUser }));
  jest.doMock('../../../repositories/tasks.js', () => ({
    createTask,
    listTasks,
    getTask,
    completeTask,
    reopenTask,
    deleteTaskAndReturn,
    markTaskSyncPending,
  }));
  jest.doMock('../../../services/database.js', () => ({ isDatabaseConfigured, withTransaction }));
  jest.doMock('../../../services/task-parser.js', () => ({ parseTaskDraft }));
  jest.doMock('../../../services/google-tasks.js', () => ({ isGoogleTasksEnabled, hasTasksScope }));
  jest.doMock('../../../repositories/jobs.js', () => ({ enqueueJob }));
  const { default: taskHandler } = await import('../../../app/handlers/tasks.js');
  return taskHandler;
};

const makeContext = (text) => ({
  userId: 'U-line-id',
  trimmedText: text,
  messages: [],
  hasCommand({ text: commandText, aliases }) {
    const content = text.toLowerCase();
    return [commandText, ...aliases].some((alias) => content.startsWith(alias.toLowerCase()));
  },
  pushText(value, actions = []) { this.messages.push({ type: 'text', text: value, actions }); return this; },
  pushError(err) { this.error = err; return this; },
});

afterEach(() => {
  delete process.env.ENABLE_TASKS;
  ['../../../repositories/users.js', '../../../repositories/tasks.js',
    '../../../services/database.js', '../../../services/task-parser.js',
    '../../../services/google-tasks.js', '../../../repositories/jobs.js']
    .forEach((mod) => jest.dontMock(mod));
  jest.resetModules();
});

test('enqueues a Google Tasks upsert when enabled and the account has tasks scope', async () => {
  const handler = await load();
  isGoogleTasksEnabled.mockReturnValue(true);
  const context = await handler(makeContext('新增任務 買牛奶'));
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-tasks-sync',
    idempotencyKey: 'google-tasks-sync:t1:1:upsert',
    payload: expect.objectContaining({ ownerId: 'owner-1', taskId: 't1', action: 'upsert' }),
  }));
  expect(context.messages[0].text).toContain('已新增任務');
  expect(context.messages[0].text).toContain('已排入 Google Tasks 同步');
});

test('does not enqueue a sync when Google Tasks is disabled', async () => {
  const handler = await load();
  isGoogleTasksEnabled.mockReturnValue(false);
  await handler(makeContext('新增任務 買牛奶'));
  expect(enqueueJob).not.toHaveBeenCalled();
});

test('deleting a synced task enqueues a Google Tasks delete', async () => {
  const handler = await load();
  isGoogleTasksEnabled.mockReturnValue(true);
  deleteTaskAndReturn.mockResolvedValue({ id: 't1', version: 3, provider_task_id: 'g-1' });
  await handler(makeContext('刪任務 t1'));
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-tasks-sync',
    payload: expect.objectContaining({ action: 'delete', providerTaskId: 'g-1' }),
  }), expect.any(Function));
});

test('ignores messages that are not task commands', async () => {
  const taskHandler = await load();
  expect(taskHandler(makeContext('今天天氣如何'))).toBe(false);
});

test('refuses to work when the feature is off, without touching the database', async () => {
  const taskHandler = await load({ enabled: false });
  const context = await taskHandler(makeContext('新增任務 買牛奶'));
  expect(context.messages[0].text).toBe('此功能目前已停用');
  expect(upsertUser).not.toHaveBeenCalled();
});

test('creates a title-only task', async () => {
  const taskHandler = await load();
  const context = await taskHandler(makeContext('新增任務 買牛奶'));
  expect(createTask).toHaveBeenCalledWith('owner-1', { title: '買牛奶' });
  expect(context.messages[0].text).toContain('已新增任務');
  expect(context.messages[0].text).toContain('尚未同步 Google Tasks');
  expect(context.messages[0].text).toContain('不會建立 Google 日曆行程');
});

test('asks for content when the add command is empty', async () => {
  const taskHandler = await load();
  const context = await taskHandler(makeContext('新增任務'));
  expect(context.messages[0].text).toContain('請告訴我任務內容');
  expect(createTask).not.toHaveBeenCalled();
});

test('lists open tasks with done and delete shortcuts bound to each id', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([
    { id: 'ta', title: '買牛奶', due_at: null },
    { id: 'tb', title: '交報告', due_at: null },
  ]);
  const context = await taskHandler(makeContext('我的任務'));
  expect(listTasks).toHaveBeenCalledWith('owner-1', expect.objectContaining({ status: 'open' }));
  const [message] = context.messages;
  expect(message.text).toContain('買牛奶');
  // postback：id 藏在 data，聊天只顯示 displayText。
  expect(message.actions.map(({ data }) => data)).toEqual([
    '完成任務 ta',
    '刪任務 ta',
    '完成任務 tb',
    '刪任務 tb',
  ]);
  // displayText 不含 task id；聊天記錄顯示當次列表序號。
  expect(message.actions.map(({ displayText }) => displayText))
    .toEqual(['完成任務 1', '刪任務 1', '完成任務 2', '刪任務 2']);
});

test('says the list is empty when there are no open tasks', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([]);
  const context = await taskHandler(makeContext('我的任務'));
  expect(context.messages[0].text).toContain('沒有待辦任務');
});

test('completes the task named by the done shortcut', async () => {
  const taskHandler = await load();
  const context = await taskHandler(makeContext('完成任務 ta。'));
  expect(completeTask).toHaveBeenCalledWith('owner-1', 'ta');
  expect(context.messages[0].text).toContain('已完成任務');
});

test('completing an already-done task is idempotent', async () => {
  const taskHandler = await load();
  completeTask.mockResolvedValue(null);
  getTask.mockResolvedValue({ id: 'ta', status: 'done' });
  const context = await taskHandler(makeContext('完成任務 ta'));
  expect(context.messages[0].text).toContain('已經完成');
});

test('completing an unknown task reports not found', async () => {
  const taskHandler = await load();
  completeTask.mockResolvedValue(null);
  getTask.mockResolvedValue(null);
  const context = await taskHandler(makeContext('完成任務 ghost'));
  expect(context.messages[0].text).toContain('找不到');
});

test('deletes the task named by the delete shortcut', async () => {
  const taskHandler = await load();
  const context = await taskHandler(makeContext('刪任務 ta。'));
  expect(deleteTaskAndReturn).toHaveBeenCalledWith('owner-1', 'ta');
  expect(context.messages[0].text).toContain('已刪除任務');
});

test('reports not found when the task to delete is already gone', async () => {
  const taskHandler = await load();
  deleteTaskAndReturn.mockResolvedValue(null);
  const context = await taskHandler(makeContext('刪任務 ghost'));
  expect(context.messages[0].text).toContain('找不到');
});

test('parses a due date and shows it on the created task', async () => {
  const taskHandler = await load();
  parseTaskDraft.mockResolvedValue({
    valid: true, errors: [], value: { title: '交報告', dueAt: '2026-07-20T07:00:00.000Z' },
  });
  const context = await taskHandler(makeContext('新增任務 明天早上交報告'));
  expect(parseTaskDraft).toHaveBeenCalledWith(expect.objectContaining({ text: '明天早上交報告' }));
  expect(createTask).toHaveBeenCalledWith('owner-1', { title: '交報告', dueAt: '2026-07-20T07:00:00.000Z' });
  expect(context.messages[0].text).toContain('交報告');
});

test('filters the list to a due-bounded range', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([{ id: 'ta', title: '交報告', due_at: '2026-07-16T02:00:00.000Z' }]);
  const context = await taskHandler(makeContext('我的任務 今天'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.status).toBe('open');
  // 「今天」必須同時有起訖，不能把更早的逾期任務混進來。
  expect(opts.dueAfter).toBeInstanceOf(Date);
  expect(opts.dueBefore).toBeInstanceOf(Date);
  expect(opts.dueAfter.getTime()).toBeLessThan(opts.dueBefore.getTime());
  expect(context.messages[0].text).toContain('今天到期');
});

test('accepts 今日 as the today filter alias', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([{ id: 'ta', title: '交報告', due_at: '2026-07-17T01:00:00.000Z' }]);
  const context = await taskHandler(makeContext('我的任務 今日'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.dueAfter).toBeInstanceOf(Date);
  expect(opts.dueBefore).toBeInstanceOf(Date);
  expect(context.messages[0].text).toContain('今天到期');
});

test('filters tomorrow to the next local calendar day', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([{ id: 'ta', title: '交報告', due_at: '2026-07-18T01:00:00.000Z' }]);
  const context = await taskHandler(makeContext('我的任務 明天'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.dueAfter).toBeInstanceOf(Date);
  expect(opts.dueBefore).toBeInstanceOf(Date);
  expect(opts.dueBefore.getTime() - opts.dueAfter.getTime()).toBeGreaterThan(0);
  expect(context.messages[0].text).toContain('明天到期');
});

test('filters next-week aliases to the following Monday-through-Sunday range', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([{ id: 'ta', title: '交報告', due_at: '2026-07-26T01:00:00.000Z' }]);
  const context = await taskHandler(makeContext('我的任務 下個星期'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.dueAfter).toBeInstanceOf(Date);
  expect(opts.dueBefore).toBeInstanceOf(Date);
  expect(opts.dueBefore.getTime()).toBeGreaterThan(opts.dueAfter.getTime());
  expect(context.messages[0].text).toContain('下週到期');
});

test('rejects an unknown task-list filter instead of silently listing everything', async () => {
  const taskHandler = await load();
  const context = await taskHandler(makeContext('我的任務 未來'));
  expect(listTasks).not.toHaveBeenCalled();
  expect(context.messages[0].text).toContain('可用篩選');
});

test('removes Context sentence punctuation before parsing a new task', async () => {
  const taskHandler = await load();
  await taskHandler(makeContext('新增任務 今天整理測試紀錄 #驗收。'));
  expect(parseTaskDraft).toHaveBeenCalledWith(expect.objectContaining({
    text: '今天整理測試紀錄 #驗收',
  }));
});

test('an unfiltered list passes no due bound', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([{ id: 'ta', title: '買牛奶', due_at: null }]);
  await taskHandler(makeContext('我的任務'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.dueAfter).toBeNull();
  expect(opts.dueBefore).toBeNull();
});

test('shows priority mark and tags on the created task list', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([
    {
      id: 'ta', title: '交報告', due_at: null, priority: 'high', tags: ['工作'],
    },
  ]);
  const context = await taskHandler(makeContext('我的任務'));
  expect(context.messages[0].text).toContain('🔴');
  expect(context.messages[0].text).toContain('#工作');
});

test('lists completed tasks with a reopen shortcut', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([{
    id: 'ta', title: '買牛奶', due_at: null, priority: 'normal', tags: [],
  }]);
  const context = await taskHandler(makeContext('我的任務 已完成'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.status).toBe('done');
  expect(context.messages[0].actions.map(({ data }) => data)).toContain('重開任務 ta');
  expect(context.messages[0].actions.map(({ displayText }) => displayText))
    .toEqual(['重開任務 1', '刪任務 1']);
});

test('filters the list by a hashtag', async () => {
  const taskHandler = await load();
  listTasks.mockResolvedValue([{
    id: 'ta', title: '買牛奶', due_at: null, priority: 'normal', tags: ['購物'],
  }]);
  const context = await taskHandler(makeContext('我的任務 #購物'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.tag).toBe('購物');
  expect(context.messages[0].text).toContain('#購物');
});

test('adds a next-page shortcut when there are more tasks than a page', async () => {
  const taskHandler = await load();
  // 回傳 PAGE_SIZE+1（7）筆 → 有下一頁。
  listTasks.mockResolvedValue(Array.from({ length: 7 }, (_, i) => ({
    id: `t${i}`, title: `任務${i}`, due_at: null, priority: 'normal', tags: [],
  })));
  const context = await taskHandler(makeContext('我的任務'));
  const [, opts] = listTasks.mock.calls[0];
  expect(opts.limit).toBe(7); // PAGE_SIZE + 1
  const next = context.messages[0].actions.find(({ data }) => data.includes('@6'));
  expect(next).toBeDefined();
  expect(next.data).toBe('我的任務 @6');
});

test('reopens a completed task by id (idempotent)', async () => {
  const taskHandler = await load();
  const context = await taskHandler(makeContext('重開任務 ta。'));
  expect(reopenTask).toHaveBeenCalledWith('owner-1', 'ta');
  expect(context.messages[0].text).toContain('已重新開啟任務');
  expect(context.messages[0].text).toContain('尚未同步 Google Tasks');
  expect(context.messages[0].text).toContain('不會建立 Google 日曆行程');
});

test('reopening a task that is not done is a no-op message', async () => {
  const taskHandler = await load();
  reopenTask.mockResolvedValue(null);
  getTask.mockResolvedValue({ id: 'ta', status: 'open' });
  const context = await taskHandler(makeContext('重開任務 ta'));
  expect(context.messages[0].text).toContain('還沒完成');
});
