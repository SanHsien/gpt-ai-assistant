import {
  afterEach, expect, jest, test,
} from '@jest/globals';
import getVersion from '../utils/get-version.js';

// fetchVersion 打外部 GitHub raw；unit test 不依賴網路，改用 mock 讓版本比對可決定性驗證。
const load = async (latest) => {
  jest.resetModules();
  jest.doMock('../utils/fetch-version.js', () => ({
    __esModule: true,
    default: jest.fn().mockResolvedValue(latest),
  }));
  const { getPrompt, handleEvents, removePrompt } = await import('../app/index.js');
  const { COMMAND_SYS_VERSION } = await import('../app/commands/index.js');
  const { t } = await import('../locales/index.js');
  const { createEvents, MOCK_USER_01 } = await import('./utils.js');
  return {
    getPrompt, handleEvents, removePrompt, COMMAND_SYS_VERSION, t, createEvents, MOCK_USER_01,
  };
};

afterEach(() => {
  jest.dontMock('../utils/fetch-version.js');
  jest.resetModules();
});

test('COMMAND_SYS_VERSION reports up-to-date when latest === current', async () => {
  const current = getVersion();
  const {
    handleEvents, getPrompt, removePrompt, COMMAND_SYS_VERSION, t, createEvents, MOCK_USER_01,
  } = await load(current);
  const results = await handleEvents(createEvents([COMMAND_SYS_VERSION.text]));
  const replies = results.map(({ messages }) => messages.map(({ text }) => text));
  expect(getPrompt(MOCK_USER_01).messages.length).toEqual(3);
  expect(replies).toEqual([[t('__COMMAND_SYS_VERSION_REPLY')(current, true)]]);
  removePrompt(MOCK_USER_01);
}, 9000);

test('COMMAND_SYS_VERSION reports a new version when latest !== current', async () => {
  const current = getVersion();
  const latest = `${current}-next`;
  const {
    handleEvents, removePrompt, COMMAND_SYS_VERSION, t, createEvents, MOCK_USER_01,
  } = await load(latest);
  const results = await handleEvents(createEvents([COMMAND_SYS_VERSION.text]));
  const replies = results.map(({ messages }) => messages.map(({ text }) => text));
  expect(replies).toEqual([[
    t('__COMMAND_SYS_VERSION_REPLY')(current, false),
    t('__MESSAGE_NEW_VERSION_AVAILABLE')(latest),
  ]]);
  removePrompt(MOCK_USER_01);
}, 9000);
