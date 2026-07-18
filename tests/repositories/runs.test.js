import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  jest.doMock('../../services/database.js', () => ({ query }));
  return import('../../repositories/runs.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.resetModules();
});

test('startRun inserts and returns the run id', async () => {
  const { startRun } = await load();
  query.mockResolvedValue({ rows: [{ id: 'r1' }] });
  const id = await startRun({ webhookEventId: 'e1', capability: 'talk', model: 'gpt-4o-mini' });
  expect(id).toBe('r1');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/insert into runs/i);
  expect(params).toEqual(['e1', 'talk', 'gpt-4o-mini']);
});

test('finishRun records status, duration and error', async () => {
  const { finishRun } = await load();
  query.mockResolvedValue({ rowCount: 1 });
  await finishRun('r1', { status: 'error', durationMs: 123, error: 'boom' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/update runs/i);
  expect(params[0]).toBe('r1');
  expect(params[1]).toBe('error');
  expect(params[2]).toBe(123);
  expect(params[7]).toBe('boom');
});
