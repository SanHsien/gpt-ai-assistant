import {
  afterEach, expect, jest, test,
} from '@jest/globals';

afterEach(() => {
  jest.dontMock('axios');
  jest.resetModules();
});

test('passes an optional response format to Chat Completions', async () => {
  const post = jest.fn();
  const use = jest.fn();
  jest.doMock('axios', () => ({
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        interceptors: {
          request: { use },
          response: { use },
        },
        post,
      })),
    },
  }));

  const { createChatCompletion } = await import('../services/openai.js');
  await createChatCompletion({
    messages: [{ role: 'user', content: 'return JSON' }],
    responseFormat: { type: 'json_object' },
  });

  expect(post).toHaveBeenCalledWith(
    '/v1/chat/completions',
    expect.objectContaining({ response_format: { type: 'json_object' } }),
  );
});
