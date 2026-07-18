import {
  afterEach,
  beforeEach,
  expect,
  test,
} from '@jest/globals';
import { getPrompt, handleEvents, removePrompt } from '../app/index.js';
import {
  COMMAND_SYS_COMMAND,
  COMMAND_SYS_REPORT,
  GENERAL_COMMANDS,
} from '../app/commands/index.js';
import { createEvents, TIMEOUT, MOCK_USER_01 } from './utils.js';

beforeEach(() => {
  //
});

afterEach(() => {
  removePrompt(MOCK_USER_01);
});

test('COMMAND_SYS_COMMAND', async () => {
  const events = [
    ...createEvents([`${COMMAND_SYS_COMMAND.text}`]),
  ];
  let results;
  try {
    results = await handleEvents(events);
  } catch (err) {
    console.error(err);
  }
  expect(getPrompt(MOCK_USER_01).messages.length).toEqual(3);
  expect(results).toHaveLength(1);
  expect(results[0].messages).toHaveLength(1);
  expect(results[0].messages[0].type).toBe('text');
  expect(results[0].messages[0].text).toContain('可用功能與指令');
  expect(results[0].messages[0].text).toContain('【對話】');
  expect(results[0].messages[0].text).toContain('【文字處理】');
  expect(results[0].messages[0].text).toContain('【系統】');
  expect(results[0].messages[0].quickReply.items).toHaveLength(GENERAL_COMMANDS.length);
  expect(results[0].messages[0].quickReply.items.map(({ action }) => action.text))
    .toContain(COMMAND_SYS_COMMAND.text);
}, TIMEOUT);

test('COMMAND_SYS_REPORT targets this independently maintained repository', async () => {
  const results = await handleEvents(createEvents([COMMAND_SYS_REPORT.text]));

  expect(results[0].messages[0].text)
    .toBe('https://github.com/SanHsien/gpt-ai-assistant/issues');
}, TIMEOUT);
