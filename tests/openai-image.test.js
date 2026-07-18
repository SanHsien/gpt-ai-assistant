import {
  afterEach, expect, jest, test,
} from '@jest/globals';

afterEach(() => {
  jest.dontMock('axios');
  jest.resetModules();
});

test('uses the image-specific timeout for generation requests', async () => {
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

  const { createImage } = await import('../services/openai.js');
  await createImage({ prompt: 'cat' });

  expect(post).toHaveBeenCalledWith(
    '/v1/images/generations',
    expect.objectContaining({ prompt: 'cat' }),
    { timeout: 55000 },
  );
});
