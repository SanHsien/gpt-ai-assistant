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

test('sends GPT-5 the reasoning-model parameter set, not the legacy one', async () => {
  // Chat Completions rejects `max_tokens` and the penalties for gpt-5 outright —
  // the request 400s rather than ignoring them — so the split is load-bearing.
  // Adopted from upstream PR #365, rewritten for this fork's extra fields.
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
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 128,
  });

  const [, body] = post.mock.calls[0];
  expect(body.max_completion_tokens).toBe(128);
  expect(body).not.toHaveProperty('max_tokens');
  expect(body).not.toHaveProperty('frequency_penalty');
  expect(body).not.toHaveProperty('presence_penalty');
});

test('keeps the legacy parameter set for non-reasoning models', async () => {
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
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 64,
  });

  const [, body] = post.mock.calls[0];
  expect(body.max_tokens).toBe(64);
  expect(body).not.toHaveProperty('max_completion_tokens');
  expect(body).toHaveProperty('frequency_penalty');
  expect(body).toHaveProperty('presence_penalty');
});
