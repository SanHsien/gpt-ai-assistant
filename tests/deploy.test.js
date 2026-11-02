import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const load = async (hook) => {
  jest.resetModules();
  const deploy = jest.fn().mockResolvedValue({});
  const updateHistory = jest.fn();
  jest.doMock('../config/index.js', () => ({
    __esModule: true,
    default: { APP_LANG: 'zh_TW', VERCEL_DEPLOY_HOOK_URL: hook },
  }));
  jest.doMock('../services/vercel.js', () => ({ __esModule: true, default: deploy }));
  jest.doMock('../app/history/index.js', () => ({ updateHistory }));
  const { default: handler } = await import('../app/handlers/deploy.js');
  const { t } = await import('../locales/index.js');
  return { handler, deploy, updateHistory, t };
};

const createContext = (sourceType = 'user', matches = true) => ({
  id: 'test-source',
  userId: 'test-user',
  event: { source: { type: sourceType } },
  hasCommand: jest.fn().mockReturnValue(matches),
  pushText: jest.fn(),
  pushError: jest.fn(),
});

afterEach(() => {
  jest.dontMock('../config/index.js');
  jest.dontMock('../services/vercel.js');
  jest.dontMock('../app/history/index.js');
  jest.resetModules();
});

test.each(['user', 'group', 'room'])('deploy is denied for %s even with a configured hook', async (sourceType) => {
  const { handler, deploy, updateHistory, t } = await load('https://example.invalid/deploy');
  const context = createContext(sourceType);
  expect(await handler(context)).toBe(context);
  expect(deploy).not.toHaveBeenCalled();
  expect(updateHistory).not.toHaveBeenCalled();
  expect(context.pushText).toHaveBeenCalledTimes(1);
  expect(context.pushText).toHaveBeenCalledWith(t('__ERROR_FEATURE_DISABLED'));
  expect(context.pushError).not.toHaveBeenCalled();
});

test.each([null, ''])('missing hook (%s) returns before deployment or history changes', async (hook) => {
  const { handler, deploy, updateHistory, t } = await load(hook);
  const context = createContext();
  expect(await handler(context)).toBe(context);
  expect(deploy).not.toHaveBeenCalled();
  expect(updateHistory).not.toHaveBeenCalled();
  expect(context.pushText).toHaveBeenCalledTimes(1);
  expect(context.pushText).toHaveBeenCalledWith(t('__ERROR_MISSING_ENV')('VERCEL_DEPLOY_HOOK_URL'));
  expect(context.pushError).not.toHaveBeenCalled();
});

test('other commands continue to the next handler', async () => {
  const { handler, deploy, updateHistory } = await load(null);
  const context = createContext('user', false);
  expect(handler(context)).toBe(false);
  expect(deploy).not.toHaveBeenCalled();
  expect(updateHistory).not.toHaveBeenCalled();
  expect(context.pushText).not.toHaveBeenCalled();
});
