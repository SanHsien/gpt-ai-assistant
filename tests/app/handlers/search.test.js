import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let fetchAnswer;
let generateCompletion;

const load = async () => {
  jest.resetModules();
  process.env.SERPAPI_API_KEY = 'test-key';
  fetchAnswer = jest.fn().mockResolvedValue({
    answer: 'raw answer',
    sources: [
      {
        title: '台北天氣', link: 'https://a', source: 'weather.com', date: '2026-07-16',
      },
      {
        title: '氣象預報', link: 'https://b', source: null, date: null,
      },
    ],
  });
  generateCompletion = jest.fn().mockResolvedValue({ text: 'AI 整理後的答案', isFinishReasonStop: true });
  // 只覆寫 fetchAnswer／generateCompletion，其餘（addMark 等，prompt 模組會用）保留真實。
  jest.doMock('../../../utils/index.js', () => {
    const actual = jest.requireActual('../../../utils/index.js');
    return { ...actual, fetchAnswer, generateCompletion };
  });
  const { default: searchHandler } = await import('../../../app/handlers/search.js');
  return searchHandler;
};

const makeContext = (text) => ({
  userId: 'U1',
  id: 'U1',
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
  delete process.env.SERPAPI_API_KEY;
  delete process.env.ENABLE_SCHEDULE;
  jest.dontMock('../../../utils/index.js');
  jest.resetModules();
});

test('ignores non-search messages', async () => {
  const handler = await load();
  expect(handler(makeContext('今天天氣'))).toBe(false);
});

test('appends cited sources beneath the AI answer', async () => {
  const handler = await load();
  const context = await handler(makeContext('搜尋 台北天氣'));
  const message = context.messages.find((msg) => msg.text.includes('AI 整理後的答案'));
  expect(message.text).toContain('📎 來源');
  expect(message.text).toContain('台北天氣（weather.com · 2026-07-16）');
  expect(message.text).toContain('https://a');
  expect(message.text).toContain('https://b');
});

test('does not pass sources into the model prompt (only the answer is used)', async () => {
  const handler = await load();
  await handler(makeContext('搜尋 台北天氣'));
  const promptArg = generateCompletion.mock.calls[0][0];
  const promptText = JSON.stringify(promptArg);
  // 來源連結不進 prompt（清楚分開來源與模型推論、避免注入放大）。
  expect(promptText).not.toContain('https://a');
});

test('replies without a sources block when there are none', async () => {
  const handler = await load();
  fetchAnswer.mockResolvedValue({ answer: 'a', sources: [] });
  const context = await handler(makeContext('搜尋 冷門詞'));
  const message = context.messages.find((msg) => msg.text.includes('AI 整理後的答案'));
  expect(message.text).not.toContain('📎');
});

test('offers a create-event quick-reply when the answer has a date and scheduling is on', async () => {
  process.env.ENABLE_SCHEDULE = 'true';
  const handler = await load();
  generateCompletion.mockResolvedValue({ text: '五月天演唱會 2026/5/20 晚上7點在高雄', isFinishReasonStop: true });
  const context = await handler(makeContext('搜尋 五月天演唱會'));
  const message = context.messages[context.messages.length - 1];
  const action = message.actions.find((a) => a.data);
  expect(action).toBeTruthy();
  expect(action.label).toContain('建立行程');
  // postback 走 Phase 1 行程流程：資料以行程指令為前綴＋答案，確認才建立。
  expect(action.data).toContain('五月天演唱會 2026/5/20');
});

test('omits the create-event action when the answer has no date', async () => {
  process.env.ENABLE_SCHEDULE = 'true';
  const handler = await load();
  generateCompletion.mockResolvedValue({ text: '這是一段沒有日期的說明文字', isFinishReasonStop: true });
  const context = await handler(makeContext('搜尋 隨便'));
  const message = context.messages[context.messages.length - 1];
  expect((message.actions || []).some((a) => a.data)).toBe(false);
});

test('omits the create-event action when scheduling is disabled', async () => {
  const handler = await load(); // ENABLE_SCHEDULE 未設
  generateCompletion.mockResolvedValue({ text: '五月天演唱會 2026/5/20 晚上7點', isFinishReasonStop: true });
  const context = await handler(makeContext('搜尋 五月天'));
  const message = context.messages[context.messages.length - 1];
  expect((message.actions || []).some((a) => a.data)).toBe(false);
});
