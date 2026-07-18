import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const FLAG_KEYS = ['ENABLE_IMAGE_GENERATION', 'ENABLE_TRANSCRIPTION', 'ENABLE_VISION', 'ENABLE_SEARCH'];
const ORIGINAL = Object.fromEntries(FLAG_KEYS.map((k) => [k, process.env[k]]));

const loadApp = async (env) => {
  jest.resetModules();
  Object.entries(env).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  const { handleEvents } = await import('../app/index.js');
  const { COMMAND_BOT_DRAW, COMMAND_BOT_SEARCH } = await import('../app/commands/index.js');
  const { createEvents, TEST_HANDLE_OPTIONS } = await import('./utils.js');
  return {
    handleEvents, COMMAND_BOT_DRAW, COMMAND_BOT_SEARCH, createEvents, TEST_HANDLE_OPTIONS,
  };
};

afterEach(() => {
  Object.entries(ORIGINAL).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  jest.resetModules();
});

test('draw replies a text notice (no image) when ENABLE_IMAGE_GENERATION=false', async () => {
  const {
    handleEvents, COMMAND_BOT_DRAW, createEvents, TEST_HANDLE_OPTIONS,
  } = await loadApp({ ENABLE_IMAGE_GENERATION: 'false' });

  const results = await handleEvents(
    createEvents([`${COMMAND_BOT_DRAW.text}貓咪`]),
    TEST_HANDLE_OPTIONS,
  );
  const replies = results.flatMap(({ messages }) => messages);

  expect(replies).toHaveLength(1);
  expect(replies[0].originalContentUrl).toBeUndefined();
  expect(replies[0].text).toBeTruthy();
}, 9000);

test('search replies a text notice when ENABLE_SEARCH=false', async () => {
  const {
    handleEvents, COMMAND_BOT_SEARCH, createEvents, TEST_HANDLE_OPTIONS,
  } = await loadApp({ ENABLE_SEARCH: 'false' });

  const results = await handleEvents(
    createEvents([`${COMMAND_BOT_SEARCH.text}天氣`]),
    TEST_HANDLE_OPTIONS,
  );
  const replies = results.flatMap(({ messages }) => messages);

  expect(replies).toHaveLength(1);
  expect(replies[0].text).toBeTruthy();
}, 9000);
