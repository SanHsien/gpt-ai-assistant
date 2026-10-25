import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const load = async (data) => {
  jest.resetModules();
  jest.doMock('../config/index.js', () => ({
    __esModule: true,
    default: { APP_ENV: 'production', OPENAI_COMPLETION_MODEL: 'gpt-test' },
  }));
  jest.doMock('../services/run-trace.js', () => ({
    __esModule: true,
    recordCompletionRun: jest.fn(),
  }));
  jest.doMock('../services/openai.js', () => ({
    __esModule: true,
    FINISH_REASON_STOP: 'stop',
    createChatCompletion: jest.fn().mockResolvedValue({ data }),
  }));
  return (await import('../utils/generate-completion.js')).default;
};

afterEach(() => {
  jest.dontMock('../config/index.js');
  jest.dontMock('../services/run-trace.js');
  jest.dontMock('../services/openai.js');
  jest.resetModules();
});

test('trims normal completion text', async () => {
  const generateCompletion = await load({
    choices: [{ message: { content: ' hi \n' }, finish_reason: 'stop' }],
  });
  const result = await generateCompletion({ prompt: { messages: [] } });
  expect(result.text).toBe('hi');
  expect(result.isFinishReasonStop).toBe(true);
});

test('a refusal (content: null) is returned as text instead of crashing on trim()', async () => {
  const generateCompletion = await load({
    choices: [{ message: { content: null, refusal: 'I cannot help with that.' }, finish_reason: 'stop' }],
  });
  const result = await generateCompletion({ prompt: { messages: [] } });
  expect(result.text).toBe('I cannot help with that.');
});

test('null content without a refusal yields empty text, not a TypeError', async () => {
  const generateCompletion = await load({
    choices: [{ message: { content: null }, finish_reason: 'length' }],
  });
  const result = await generateCompletion({ prompt: { messages: [] } });
  expect(result.text).toBe('');
  expect(result.isFinishReasonStop).toBe(false);
});

test('an empty choices array raises a readable error', async () => {
  const generateCompletion = await load({ choices: [] });
  await expect(generateCompletion({ prompt: { messages: [] } })).rejects.toThrow(/no choices/i);
});
