import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let createChatCompletion;

const load = async (content) => {
  jest.resetModules();
  process.env.SCHEDULE_MAX_TOKENS = '400';
  createChatCompletion = jest.fn().mockResolvedValue({
    data: { choices: [{ message: { content } }] },
  });
  jest.doMock('../../services/openai.js', () => ({ createChatCompletion }));
  return import('../../services/task-parser.js');
};

afterEach(() => {
  delete process.env.SCHEDULE_MAX_TOKENS;
  jest.dontMock('../../services/openai.js');
  jest.resetModules();
});

test('parses a title with a due date using deterministic, reproducible params', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({
    title: '交報告', dueAt: '2026-07-20T09:00:00+08:00',
  }));
  const result = await parseTaskDraft({
    text: '明天早上交報告',
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-19T00:00:00.000Z'),
  });
  expect(result.valid).toBe(true);
  expect(result.value.title).toBe('交報告');
  expect(result.value.dueAt).toBe('2026-07-20T01:00:00.000Z');
  const [params] = createChatCompletion.mock.calls[0];
  expect(params.temperature).toBe(0);
  expect(params.responseFormat).toMatchObject({
    type: 'json_schema',
    json_schema: { name: 'task_draft', strict: true },
  });
});

test('realigns today to the user timezone date when the model returns the previous UTC day', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({
    title: '整理測試紀錄', dueAt: '2026-07-16T09:00:00+08:00', priority: 'normal',
  }));
  const result = await parseTaskDraft({
    text: '今天整理測試紀錄',
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T16:56:00.000Z'),
  });
  expect(result.valid).toBe(true);
  expect(result.value.dueAt).toBe('2026-07-17T01:00:00.000Z');
});

test('uses the local date at 09:00 when 今日 gets no model due time', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({
    title: '整理測試紀錄', dueAt: null, priority: 'normal',
  }));
  const result = await parseTaskDraft({
    text: '今日整理測試紀錄',
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T17:41:00.000Z'),
  });
  expect(result.value.dueAt).toBe('2026-07-17T01:00:00.000Z');
});

test('resolves a broad this-week deadline to Sunday instead of accepting a model guess', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({
    title: '繳交測試報告', dueAt: '2026-07-18T09:00:00+08:00', priority: 'normal',
  }));
  const result = await parseTaskDraft({
    text: '本週繳交測試報告',
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T17:41:00.000Z'),
  });
  expect(result.value.dueAt).toBe('2026-07-19T01:00:00.000Z');
  expect(createChatCompletion.mock.calls[0][0].messages[0].content)
    .toContain('對應 2026-07-19');
});

test('uses Sunday at 09:00 when a broad week phrase gets no model due time', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({
    title: '繳交測試報告', dueAt: null, priority: 'normal',
  }));
  const result = await parseTaskDraft({
    text: '下周繳交測試報告',
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T17:41:00.000Z'),
  });
  expect(result.value.dueAt).toBe('2026-07-26T01:00:00.000Z');
});

test('keeps a title with no due date (dueAt null is dropped)', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({ title: '買牛奶', dueAt: null }));
  const result = await parseTaskDraft({ text: '買牛奶', timezone: 'Asia/Taipei' });
  expect(result.valid).toBe(true);
  expect(result.value).toEqual({ title: '買牛奶' });
});

test('falls back to the raw text as title when the model returns junk', async () => {
  const { parseTaskDraft } = await load('sorry I have no idea');
  const result = await parseTaskDraft({ text: '回電話給王先生', timezone: 'Asia/Taipei' });
  expect(result.valid).toBe(true);
  expect(result.value.title).toBe('回電話給王先生');
});

test('a model-supplied field outside the task schema is rejected downstream', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({ title: '', dueAt: null }));
  // 空 title → 退回把原文當 title，仍可用。
  const result = await parseTaskDraft({ text: '買咖啡', timezone: 'Asia/Taipei' });
  expect(result.value.title).toBe('買咖啡');
});

test('parses priority and extracts hashtags deterministically', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({
    title: '交報告', dueAt: null, priority: 'high',
  }));
  const result = await parseTaskDraft({ text: '重要 交報告 #工作 #專案', timezone: 'Asia/Taipei' });
  expect(result.value.priority).toBe('high');
  expect(result.value.tags).toEqual(['工作', '專案']);
  // 交給模型的文字已去掉 #標籤。
  const [, userMsg] = createChatCompletion.mock.calls[0][0].messages;
  expect(userMsg.content).not.toContain('#');
});

test('does not include sentence punctuation in hashtags', async () => {
  const { parseTaskDraft } = await load(JSON.stringify({
    title: '整理測試紀錄', dueAt: null, priority: 'normal',
  }));
  const result = await parseTaskDraft({ text: '整理測試紀錄 #驗收。', timezone: 'Asia/Taipei' });
  expect(result.value.tags).toEqual(['驗收']);
});
