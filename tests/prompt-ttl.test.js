import {
  afterEach, expect, jest, test,
} from '@jest/globals';
import { ROLE_HUMAN } from '../services/openai.js';

const ORIGINAL = process.env.APP_MAX_PROMPT_AGE;

const load = async (age) => {
  jest.resetModules();
  if (age === undefined) delete process.env.APP_MAX_PROMPT_AGE;
  else process.env.APP_MAX_PROMPT_AGE = age;
  const {
    getPrompt, setPrompt, removePrompt, Prompt,
  } = await import('../app/prompt/index.js');
  return {
    getPrompt, setPrompt, removePrompt, Prompt,
  };
};

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_MAX_PROMPT_AGE;
  else process.env.APP_MAX_PROMPT_AGE = ORIGINAL;
  jest.resetModules();
});

test('getPrompt keeps the stored prompt within max age', async () => {
  const { getPrompt, setPrompt, Prompt } = await load('3600');
  const prompt = new Prompt();
  prompt.write(ROLE_HUMAN, 'hello');
  setPrompt('user-a', prompt);
  expect(getPrompt('user-a')).toBe(prompt);
}, 9000);

test('getPrompt expires a stale prompt beyond max age', async () => {
  const { getPrompt, setPrompt, Prompt } = await load('1');
  const prompt = new Prompt();
  prompt.write(ROLE_HUMAN, 'hello');
  const storedLength = prompt.messages.length;
  setPrompt('user-b', prompt);
  prompt.updatedAt = Date.now() - 5000;
  const fresh = getPrompt('user-b');
  expect(fresh).not.toBe(prompt);
  expect(fresh.messages.length).toBeLessThan(storedLength);
}, 9000);

test('getPrompt never expires when max age is 0 (default)', async () => {
  const { getPrompt, setPrompt, Prompt } = await load('0');
  const prompt = new Prompt();
  prompt.write(ROLE_HUMAN, 'hello');
  setPrompt('user-c', prompt);
  prompt.updatedAt = Date.now() - 999999999;
  expect(getPrompt('user-c')).toBe(prompt);
}, 9000);
