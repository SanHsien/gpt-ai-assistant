import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;
let deriveChannelUserKey;
let encryptJson;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  deriveChannelUserKey = jest.fn((value) => `protected:${value}`);
  encryptJson = jest.fn((value) => ({ encrypted: value }));
  jest.doMock('../../services/database.js', () => ({ query }));
  jest.doMock('../../services/data-protection.js', () => ({ deriveChannelUserKey, encryptJson }));
  return import('../../repositories/users.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../services/data-protection.js');
  jest.resetModules();
});

test('upsertUser upserts and only coalesces provided fields', async () => {
  const { upsertUser } = await load();
  query.mockResolvedValue({ rows: [{ id: 'u1', channel_user_key: 'k1' }] });
  const user = await upsertUser({
    channelUserKey: 'k1', channelTarget: 'U1', timezone: 'Asia/Taipei', quietHours: { start: 22 },
  });
  expect(user).toEqual({ id: 'u1', channel_user_key: 'k1' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/insert into users/i);
  expect(sql).toMatch(/on conflict \(channel_user_key\) do update/i);
  expect(params[0]).toBe('protected:k1');
  expect(params[1]).toBe(JSON.stringify({ encrypted: { id: 'U1' } }));
  expect(params[2]).toBe('Asia/Taipei');
  expect(params[4]).toBe(JSON.stringify({ start: 22 }));
  expect(params[5]).toBeNull();
  expect(encryptJson).toHaveBeenCalledWith({ id: 'U1' });
});

test('getUserByKey returns the row or null', async () => {
  const { getUserByKey } = await load();
  query.mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
  expect(await getUserByKey('k1')).toEqual({ id: 'u1' });
  expect(query.mock.calls[0][1]).toEqual(['protected:k1']);
  query.mockResolvedValueOnce({ rows: [] });
  expect(await getUserByKey('nope')).toBeNull();
});

test('upsertUser persists a reminders_paused flag', async () => {
  const { upsertUser } = await load();
  query.mockResolvedValue({ rows: [{ id: 'u1' }] });
  await upsertUser({ channelUserKey: 'k1', remindersPaused: true });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/reminders_paused = COALESCE\(\$7, users.reminders_paused\)/i);
  expect(params[6]).toBe(true);
});

test('clearQuietHours nulls the column by protected key', async () => {
  const { clearQuietHours } = await load();
  query.mockResolvedValue({ rows: [{ id: 'u1' }] });
  await clearQuietHours('k1');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/quiet_hours = null/i);
  expect(params).toEqual(['protected:k1']);
});

test('getUserById queries by id without hashing', async () => {
  const { getUserById } = await load();
  query.mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
  expect(await getUserById('u1')).toEqual({ id: 'u1' });
  expect(query.mock.calls[0][1]).toEqual(['u1']);
  query.mockResolvedValueOnce({ rows: [] });
  expect(await getUserById('nope')).toBeNull();
});
