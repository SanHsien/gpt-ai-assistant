import {
  afterEach, beforeEach, expect, test,
} from '@jest/globals';
import { getPrompt, handleEvents, removePrompt } from '../app/index.js';
import { COMMAND_BOT_ACTIVATE, COMMAND_BOT_DEACTIVATE } from '../app/commands/index.js';
import {
  createEvents, MOCK_TEXT_OK, MOCK_USER_01, TEST_BOT_SOURCE_REPOSITORY,
  TEST_HANDLE_OPTIONS, TIMEOUT,
} from './utils.js';

beforeEach(async () => {
  TEST_BOT_SOURCE_REPOSITORY.clear();
  const events = [
    ...createEvents([COMMAND_BOT_ACTIVATE.text]),
  ];
  await handleEvents(events, TEST_HANDLE_OPTIONS);
});

afterEach(() => {
  removePrompt(MOCK_USER_01);
});

test('COMMAND_BOT_DEACTIVATE', async () => {
  const events = [
    ...createEvents(['嗨！']),
    ...createEvents([COMMAND_BOT_DEACTIVATE.text]),
    ...createEvents(['嗨！']), // should be ignored
  ];
  let results;
  try {
    results = await handleEvents(events, TEST_HANDLE_OPTIONS);
  } catch (err) {
    console.error(err);
  }
  expect(getPrompt(MOCK_USER_01).messages.length).toEqual(5);
  const replies = results.map(({ messages }) => messages.map(({ text }) => text));
  expect(replies).toEqual(
    [
      [MOCK_TEXT_OK],
      [
        COMMAND_BOT_DEACTIVATE.reply,
      ],
    ],
  );
}, TIMEOUT);
