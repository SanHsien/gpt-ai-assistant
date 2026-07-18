import {
  afterEach, beforeEach, expect, jest, test,
} from '@jest/globals';

let startRun;
let finishRun;
let insertCompletedRun;
let isDatabaseConfigured;
let logSpy;
let errorSpy;

const load = async ({ promptPrice, completionPrice } = {}) => {
  jest.resetModules();
  if (promptPrice != null) process.env.OPENAI_PRICE_PER_1K_PROMPT = String(promptPrice);
  if (completionPrice != null) process.env.OPENAI_PRICE_PER_1K_COMPLETION = String(completionPrice);
  startRun = jest.fn().mockResolvedValue('r1');
  finishRun = jest.fn().mockResolvedValue(undefined);
  insertCompletedRun = jest.fn().mockResolvedValue(undefined);
  isDatabaseConfigured = jest.fn().mockReturnValue(true);
  jest.doMock('../../repositories/runs.js', () => ({ startRun, finishRun, insertCompletedRun }));
  jest.doMock('../../services/database.js', () => ({ isDatabaseConfigured }));
  return import('../../services/run-trace.js');
};

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.OPENAI_PRICE_PER_1K_PROMPT;
  delete process.env.OPENAI_PRICE_PER_1K_COMPLETION;
  jest.dontMock('../../repositories/runs.js');
  jest.dontMock('../../services/database.js');
  logSpy.mockRestore();
  errorSpy.mockRestore();
  jest.resetModules();
});

test('traceRun records a done run and returns the result on success', async () => {
  const { traceRun } = await load();
  const result = await traceRun({ capability: 'talk' }, async () => 'hello');
  expect(startRun).toHaveBeenCalledWith({ capability: 'talk' });
  expect(result).toBe('hello');
  expect(finishRun).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'done' }));
});

test('traceRun records an error run and rethrows on failure', async () => {
  const { traceRun } = await load();
  await expect(
    traceRun({ capability: 'talk' }, async () => { throw new Error('boom'); }),
  ).rejects.toThrow('boom');
  expect(finishRun).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'error', error: 'boom' }));
});

test('computeCostUsd returns null when pricing is not configured', async () => {
  const { computeCostUsd } = await load();
  expect(computeCostUsd({ prompt_tokens: 1000, completion_tokens: 1000 })).toBeNull();
});

test('computeCostUsd multiplies tokens by the configured per-1K price', async () => {
  const { computeCostUsd } = await load({ promptPrice: 0.15, completionPrice: 0.6 });
  // 2000 prompt → 0.30；500 completion → 0.30；合計 0.60。
  expect(computeCostUsd({ prompt_tokens: 2000, completion_tokens: 500 })).toBe(0.6);
  expect(computeCostUsd(null)).toBeNull();
});

test('recordCompletionRun inserts a trace row with tokens and computed cost', async () => {
  const { recordCompletionRun } = await load({ promptPrice: 0.15, completionPrice: 0.6 });
  await recordCompletionRun({
    capability: 'search',
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 1000, completion_tokens: 1000 },
    durationMs: 42,
  });
  expect(insertCompletedRun).toHaveBeenCalledWith(expect.objectContaining({
    capability: 'search',
    model: 'gpt-4o-mini',
    promptTokens: 1000,
    completionTokens: 1000,
    costUsd: 0.75,
    durationMs: 42,
    status: 'done',
  }));
});

test('recordCompletionRun emits a structured log line without conversation content', async () => {
  const { recordCompletionRun } = await load();
  await recordCompletionRun({ capability: 'chat', model: 'm', usage: { prompt_tokens: 5, completion_tokens: 7 } });
  const logged = JSON.parse(logSpy.mock.calls[0][0]);
  expect(logged).toMatchObject({
    evt: 'run', capability: 'chat', model: 'm', promptTokens: 5, completionTokens: 7,
  });
  expect(logged).not.toHaveProperty('messages');
  expect(logged).not.toHaveProperty('text');
});

test('recordCompletionRun skips DB write when the database is not configured', async () => {
  const { recordCompletionRun } = await load();
  isDatabaseConfigured.mockReturnValue(false);
  await recordCompletionRun({ capability: 'chat', model: 'm', usage: { prompt_tokens: 1 } });
  expect(insertCompletedRun).not.toHaveBeenCalled();
});

test('recordCompletionRun never throws when the insert fails (observability is best-effort)', async () => {
  const { recordCompletionRun } = await load();
  insertCompletedRun.mockRejectedValue(new Error('db down'));
  await expect(recordCompletionRun({ capability: 'chat', model: 'm' })).resolves.toBeUndefined();
  expect(errorSpy).toHaveBeenCalled();
});
