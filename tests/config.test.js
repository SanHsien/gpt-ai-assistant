import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const originalModel = process.env.OPENAI_IMAGE_GENERATION_MODEL;
const originalQuality = process.env.OPENAI_IMAGE_GENERATION_QUALITY;
const originalTaskListLimit = process.env.TASK_LIST_LIMIT;

afterEach(() => {
  if (originalModel === undefined) delete process.env.OPENAI_IMAGE_GENERATION_MODEL;
  else process.env.OPENAI_IMAGE_GENERATION_MODEL = originalModel;
  if (originalQuality === undefined) delete process.env.OPENAI_IMAGE_GENERATION_QUALITY;
  else process.env.OPENAI_IMAGE_GENERATION_QUALITY = originalQuality;
  if (originalTaskListLimit === undefined) delete process.env.TASK_LIST_LIMIT;
  else process.env.TASK_LIST_LIMIT = originalTaskListLimit;
  jest.resetModules();
});

test('uses a supported cost-conscious image model by default', async () => {
  delete process.env.OPENAI_IMAGE_GENERATION_MODEL;
  delete process.env.OPENAI_IMAGE_GENERATION_QUALITY;
  jest.resetModules();

  const { default: config } = await import('../config/index.js');

  expect(config.OPENAI_IMAGE_GENERATION_MODEL).toBe('gpt-image-2');
  expect(config.OPENAI_IMAGE_GENERATION_QUALITY).toBe('low');
  expect(config.OPENAI_IMAGE_GENERATION_TIMEOUT).toBe(55000);
});

test('keeps the compatible default quality for an explicit DALL-E fallback', async () => {
  process.env.OPENAI_IMAGE_GENERATION_MODEL = 'dall-e-3';
  delete process.env.OPENAI_IMAGE_GENERATION_QUALITY;
  jest.resetModules();

  const { default: config } = await import('../config/index.js');

  expect(config.OPENAI_IMAGE_GENERATION_QUALITY).toBe('standard');
});

test.each([
  [undefined, 6],
  ['3.8', 3],
  ['0', 1],
  ['12', 6],
])('normalizes TASK_LIST_LIMIT %s to a safe page size', async (value, expected) => {
  if (value === undefined) delete process.env.TASK_LIST_LIMIT;
  else process.env.TASK_LIST_LIMIT = value;
  jest.resetModules();

  const { default: config } = await import('../config/index.js');

  expect(config.TASK_LIST_LIMIT).toBe(expected);
});
