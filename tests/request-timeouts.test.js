import http from 'node:http';
import {
  afterEach, beforeEach, expect, jest, test,
} from '@jest/globals';

const KEYS = ['OPENAI_TIMEOUT', 'LINE_TIMEOUT', 'SERPAPI_TIMEOUT', 'APP_API_TIMEOUT', 'OPENAI_BASE_URL'];
let saved;

beforeEach(() => {
  saved = KEYS.map((k) => process.env[k]);
  KEYS.forEach((k) => delete process.env[k]);
  jest.resetModules();
});

afterEach(() => {
  KEYS.forEach((k, i) => {
    if (saved[i] === undefined) delete process.env[k];
    else process.env[k] = saved[i];
  });
  jest.resetModules();
});

const loadConfig = async () => (await import('../config/index.js')).default;

test('外部 API 未設定任何逾時時仍有有限的預設值（不會無限等待）', async () => {
  const config = await loadConfig();
  // Vercel function 上限 60 秒，三者都必須比它短。
  expect(config.OPENAI_TIMEOUT).toBe(45000);
  expect(config.LINE_TIMEOUT).toBe(10000);
  expect(config.SERPAPI_TIMEOUT).toBe(15000);
});

test('空字串視為未設定（.env.example 的空白欄位）', async () => {
  KEYS.slice(0, 4).forEach((k) => { process.env[k] = ''; });
  const config = await loadConfig();
  expect(config.OPENAI_TIMEOUT).toBe(45000);
  expect(config.LINE_TIMEOUT).toBe(10000);
  expect(config.SERPAPI_TIMEOUT).toBe(15000);
});

test('個別變數優先，其次 APP_API_TIMEOUT，且皆為數字', async () => {
  process.env.APP_API_TIMEOUT = '7000';
  process.env.LINE_TIMEOUT = '3000';
  const config = await loadConfig();
  expect(config.LINE_TIMEOUT).toBe(3000);
  expect(config.OPENAI_TIMEOUT).toBe(7000);
  expect(config.SERPAPI_TIMEOUT).toBe(7000);
});

test('非正數或非數字的逾時值退回預設', async () => {
  process.env.OPENAI_TIMEOUT = '0';
  process.env.LINE_TIMEOUT = 'abc';
  process.env.SERPAPI_TIMEOUT = '-5';
  const config = await loadConfig();
  expect(config.OPENAI_TIMEOUT).toBe(45000);
  expect(config.LINE_TIMEOUT).toBe(10000);
  expect(config.SERPAPI_TIMEOUT).toBe(15000);
});

test('對方不回應時 OpenAI 呼叫會在逾時內失敗，而不是卡住', async () => {
  const sockets = new Set();
  const server = http.createServer(() => { /* 收到請求但永遠不回應 */ });
  server.on('connection', (socket) => { sockets.add(socket); });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  try {
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.OPENAI_TIMEOUT = '300';
    const { createChatCompletion } = await import('../services/openai.js');
    const startedAt = Date.now();
    await expect(createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({ code: 'ECONNABORTED' });
    expect(Date.now() - startedAt).toBeLessThan(3000);
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => { server.close(resolve); });
  }
});

test('LINE 與 SerpAPI 的 axios client 都帶有逾時', async () => {
  const create = jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  }));
  jest.doMock('axios', () => ({ __esModule: true, default: { create } }));
  try {
    await import('../services/line.js');
    await import('../services/serpapi.js');
    const timeouts = create.mock.calls.map(([options]) => options.timeout);
    expect(timeouts).toHaveLength(3); // line、line data、serpapi
    timeouts.forEach((timeout) => expect(timeout).toBeGreaterThan(0));
  } finally {
    jest.dontMock('axios');
  }
});
