import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  jest.doMock('../../services/database.js', () => ({ query }));
  return import('../../repositories/subscriptions.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.resetModules();
});

test('upsertWeatherSubscription upserts on the owner+coords unique key', async () => {
  const { upsertWeatherSubscription } = await load();
  query.mockResolvedValue({ rows: [{ id: 's1' }] });
  await upsertWeatherSubscription({
    ownerId: 'o1', label: '臺北市', latitude: 25.04, longitude: 121.56, timezone: 'Asia/Taipei', hour: 8, nextRunAt: new Date('2026-07-18T00:00:00Z'),
  });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/insert into subscriptions/i);
  expect(sql).toMatch(/on conflict \(owner_id, kind, latitude, longitude\) do update/i);
  expect(params[0]).toBe('o1');
  expect(params[5]).toBe(8); // hour is the 6th positional param
});

test('listWeatherSubscriptions returns only enabled rows', async () => {
  const { listWeatherSubscriptions } = await load();
  query.mockResolvedValue({ rows: [{ id: 's1' }] });
  await listWeatherSubscriptions('o1');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/kind = 'weather' and enabled/i);
  expect(params).toEqual(['o1']);
});

test('disableWeatherSubscriptions disables all and returns the count', async () => {
  const { disableWeatherSubscriptions } = await load();
  query.mockResolvedValue({ rowCount: 2 });
  expect(await disableWeatherSubscriptions('o1')).toBe(2);
  const [sql] = query.mock.calls[0];
  expect(sql).toMatch(/set enabled = false/i);
});

test('claimDueWeatherSubscriptions advances next_run_at with SKIP LOCKED', async () => {
  const { claimDueWeatherSubscriptions } = await load();
  query.mockResolvedValue({ rows: [{ id: 's1' }] });
  const rows = await claimDueWeatherSubscriptions('2026-07-17T00:00:00Z', 50);
  expect(rows).toEqual([{ id: 's1' }]);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/next_run_at at time zone/i);
  expect(sql).toMatch(/interval '1 day'/i);
  expect(sql).toMatch(/for update skip locked/i);
  expect(params).toEqual(['2026-07-17T00:00:00Z', 50]);
});

test('claimDueWeatherSubscriptions can run on a transaction executor', async () => {
  const { claimDueWeatherSubscriptions } = await load();
  const executor = jest.fn().mockResolvedValue({ rows: [] });
  await claimDueWeatherSubscriptions('2026-07-17T00:00:00Z', 10, executor);
  expect(executor).toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});
