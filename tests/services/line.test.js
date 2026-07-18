import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let client;

const load = async () => {
  jest.resetModules();
  client = {
    get: jest.fn(),
    post: jest.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  jest.doMock('axios', () => ({
    __esModule: true,
    default: { create: jest.fn(() => client) },
  }));
  jest.doMock('../../config/index.js', () => ({
    __esModule: true,
    default: { LINE_TIMEOUT: 9000, LINE_CHANNEL_ACCESS_TOKEN: 'token' },
  }));
  jest.doMock('../../services/utils/index.js', () => ({
    handleFulfilled: jest.fn(),
    handleRejected: jest.fn(),
    handleRequest: jest.fn(),
  }));
  return import('../../services/line.js');
};

afterEach(() => {
  jest.dontMock('axios');
  jest.dontMock('../../config/index.js');
  jest.dontMock('../../services/utils/index.js');
  jest.resetModules();
});

test('push forwards a LINE retry key as an HTTP header', async () => {
  const { push } = await load();
  await push({ to: 'U1', messages: [{ type: 'text', text: 'hi' }], retryKey: 'uuid-1' });
  expect(client.post).toHaveBeenCalledWith(
    '/v2/bot/message/push',
    { to: 'U1', messages: [{ type: 'text', text: 'hi' }] },
    { headers: { 'X-Line-Retry-Key': 'uuid-1' } },
  );
});
