import {
  afterEach, expect, jest, test,
} from '@jest/globals';
import { MOCK_GROUP_01 } from '../constants/mock.js';

const ORIGINAL = process.env.GROUP_REPLY_REQUIRES_MENTION;

const loadApp = async (value) => {
  jest.resetModules();
  if (value === undefined) delete process.env.GROUP_REPLY_REQUIRES_MENTION;
  else process.env.GROUP_REPLY_REQUIRES_MENTION = value;
  const { handleEvents } = await import('../app/index.js');
  const { createEvents, TEST_HANDLE_OPTIONS } = await import('./utils.js');
  return { handleEvents, createEvents, TEST_HANDLE_OPTIONS };
};

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GROUP_REPLY_REQUIRES_MENTION;
  else process.env.GROUP_REPLY_REQUIRES_MENTION = ORIGINAL;
  jest.resetModules();
});

test('group ignores a non-addressed message when GROUP_REPLY_REQUIRES_MENTION=true', async () => {
  const { handleEvents, createEvents, TEST_HANDLE_OPTIONS } = await loadApp('true');
  const results = await handleEvents(
    createEvents(['今天天氣真好'], MOCK_GROUP_01),
    TEST_HANDLE_OPTIONS,
  );
  expect(results).toHaveLength(0);
}, 9000);

test('group replies to a non-addressed message when the policy is off (default)', async () => {
  const { handleEvents, createEvents, TEST_HANDLE_OPTIONS } = await loadApp('false');
  const results = await handleEvents(
    createEvents(['今天天氣真好'], MOCK_GROUP_01),
    TEST_HANDLE_OPTIONS,
  );
  expect(results.length).toBeGreaterThan(0);
}, 9000);
