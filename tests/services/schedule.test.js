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
  return import('../../services/schedule.js');
};

afterEach(() => {
  delete process.env.SCHEDULE_MAX_TOKENS;
  jest.dontMock('../../services/openai.js');
  jest.resetModules();
});

test('parseSchedule asks for a JSON draft with schedule-specific model params', async () => {
  const draft = JSON.stringify({
    title: '看診', start: '2026-07-15T15:00:00+08:00', timezone: 'Asia/Taipei',
  });
  const { parseSchedule } = await load(draft);
  const result = await parseSchedule({ text: '明天下午三點看診', timezone: 'Asia/Taipei' });

  expect(result.valid).toBe(true);
  expect(result.value.title).toBe('看診');

  const [params] = createChatCompletion.mock.calls[0];
  // 聊天的 64 token 上限塞不下行程 JSON，且解析必須可重現。
  expect(params.maxTokens).toBe(400);
  expect(params.temperature).toBe(0);
  expect(params.frequencyPenalty).toBe(0);
  expect(params.presencePenalty).toBe(0);
  expect(params.stop).toEqual([]);
  expect(params.responseFormat).toMatchObject({
    type: 'json_schema',
    json_schema: { name: 'event_draft', strict: true },
  });
  expect(params.messages[1]).toEqual({ role: 'user', content: '明天下午三點看診' });
});

test('parseSchedule rejects model output that is not a valid draft', async () => {
  const { parseSchedule } = await load('抱歉，我不知道你要排什麼');
  const result = await parseSchedule({ text: '???', timezone: 'Asia/Taipei' });
  expect(result.valid).toBe(false);
  expect(result.value).toBeNull();
});

test('parseSchedule rejects a draft carrying fields the schema does not allow', async () => {
  const { parseSchedule } = await load(JSON.stringify({
    title: '看診', start: '2026-07-15T15:00:00+08:00', ownerId: 'attacker',
  }));
  const result = await parseSchedule({ text: '看診', timezone: 'Asia/Taipei' });
  expect(result.valid).toBe(false);
});
