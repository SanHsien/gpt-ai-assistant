import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let upsertUser;
let clearQuietHours;
let isDatabaseConfigured;

const load = async ({ enabled = true, databaseConfigured = true } = {}) => {
  jest.resetModules();
  process.env.ENABLE_REMINDERS = enabled ? 'true' : 'false';
  upsertUser = jest.fn().mockResolvedValue({ id: 'owner-1' });
  clearQuietHours = jest.fn().mockResolvedValue({ id: 'owner-1' });
  isDatabaseConfigured = jest.fn().mockReturnValue(databaseConfigured);
  jest.doMock('../../../repositories/users.js', () => ({ upsertUser, clearQuietHours }));
  jest.doMock('../../../services/database.js', () => ({ isDatabaseConfigured }));
  const { default: remindersHandler } = await import('../../../app/handlers/reminders.js');
  return remindersHandler;
};

const makeContext = (text) => ({
  userId: 'U-line-id',
  trimmedText: text,
  messages: [],
  hasCommand({ text: commandText, aliases }) {
    const content = text.toLowerCase();
    return [commandText, ...aliases].some((alias) => content.startsWith(alias.toLowerCase()));
  },
  pushText(value) { this.messages.push({ type: 'text', text: value }); return this; },
  pushError(err) { this.error = err; return this; },
});

afterEach(() => {
  delete process.env.ENABLE_REMINDERS;
  jest.dontMock('../../../repositories/users.js');
  jest.dontMock('../../../services/database.js');
  jest.resetModules();
});

test('ignores messages that are not reminder-preference commands', async () => {
  const handler = await load();
  expect(handler(makeContext('今天天氣如何'))).toBe(false);
});

test('refuses to work when reminders are disabled', async () => {
  const handler = await load({ enabled: false });
  const context = await handler(makeContext('暫停提醒'));
  expect(context.messages[0].text).toBe('此功能目前已停用');
  expect(upsertUser).not.toHaveBeenCalled();
});

test('sets quiet hours from a HH-HH range', async () => {
  const handler = await load();
  const context = await handler(makeContext('安靜時段 22-8'));
  expect(upsertUser).toHaveBeenCalledWith({ channelUserKey: 'U-line-id', quietHours: { start: 22, end: 8 } });
  expect(context.messages[0].text).toContain('22:00');
});

test('clears quiet hours on the off keyword', async () => {
  const handler = await load();
  const context = await handler(makeContext('安靜時段 關閉'));
  expect(clearQuietHours).toHaveBeenCalledWith('U-line-id');
  expect(context.messages[0].text).toContain('已關閉');
});

test('rejects an out-of-range or malformed quiet window', async () => {
  const handler = await load();
  const context = await handler(makeContext('安靜時段 25-8'));
  expect(context.messages[0].text).toContain('請告訴我安靜時段');
  expect(upsertUser).not.toHaveBeenCalled();
});

test('pauses reminders', async () => {
  const handler = await load();
  const context = await handler(makeContext('暫停提醒'));
  expect(upsertUser).toHaveBeenCalledWith({ channelUserKey: 'U-line-id', remindersPaused: true });
  expect(context.messages[0].text).toContain('已暫停提醒');
});

test('resumes reminders', async () => {
  const handler = await load();
  const context = await handler(makeContext('恢復提醒'));
  expect(upsertUser).toHaveBeenCalledWith({ channelUserKey: 'U-line-id', remindersPaused: false });
  expect(context.messages[0].text).toContain('已恢復提醒');
});
