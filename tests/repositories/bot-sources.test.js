import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let withTransaction;
let query;
let deriveChannelUserKey;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  const client = { query };
  withTransaction = jest.fn((fn) => fn(client));
  deriveChannelUserKey = jest.fn((value) => `protected:${value}`);
  jest.doMock('../../services/database.js', () => ({ withTransaction, query }));
  jest.doMock('../../services/data-protection.js', () => ({ deriveChannelUserKey }));
  return import('../../repositories/bot-sources.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../services/data-protection.js');
  jest.resetModules();
});

test('ensureBotSource returns an existing durable source without consuming the limit', async () => {
  const repo = await load();
  query.mockResolvedValueOnce({ rows: [] }); // advisory lock
  query.mockResolvedValueOnce({ rows: [{ source_type: 'user', is_activated: false }] });
  const result = await repo.ensureBotSource({
    sourceKey: 'U1', sourceType: 'user', defaultActivated: true, maxSources: 100,
  });
  expect(result).toEqual({ source_type: 'user', is_activated: false });
  expect(deriveChannelUserKey).toHaveBeenCalledWith('U1');
  expect(query).toHaveBeenCalledTimes(2);
});

test('ensureBotSource atomically rejects a new source at the configured limit', async () => {
  const repo = await load();
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({ rows: [{ count: '100' }] });
  await expect(repo.ensureBotSource({
    sourceKey: 'U1', sourceType: 'user', defaultActivated: true, maxSources: 100,
  })).rejects.toMatchObject({ code: 'SOURCE_LIMIT_REACHED' });
});

test('setBotSourceActivation updates only the protected source key', async () => {
  const repo = await load();
  query.mockResolvedValue({ rows: [{ source_type: 'group', is_activated: true }] });
  expect(await repo.setBotSourceActivation('G1', true)).toEqual({
    source_type: 'group', is_activated: true,
  });
  expect(query.mock.calls[0][1]).toEqual([true, 'protected:G1']);
});
