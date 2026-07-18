import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const ORIGINAL = process.env.DATABASE_URL;
const ORIGINAL_CA = process.env.DATABASE_SSL_CA;
let PoolCtor;
let poolInstance;

const load = async (url) => {
  jest.resetModules();
  if (url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
  poolInstance = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
  PoolCtor = jest.fn(() => poolInstance);
  jest.doMock('pg', () => ({ __esModule: true, default: { Pool: PoolCtor } }));
  return import('../../services/database.js');
};

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
  if (ORIGINAL_CA === undefined) delete process.env.DATABASE_SSL_CA;
  else process.env.DATABASE_SSL_CA = ORIGINAL_CA;
  jest.dontMock('pg');
  jest.resetModules();
});

test('isDatabaseConfigured reflects DATABASE_URL presence', async () => {
  expect((await load(undefined)).isDatabaseConfigured()).toBe(false);
  expect((await load('postgres://x')).isDatabaseConfigured()).toBe(true);
});

test('getPool / query fail closed without DATABASE_URL', async () => {
  const db = await load(undefined);
  expect(() => db.getPool()).toThrow('DATABASE_URL');
  expect(() => db.query('SELECT 1')).toThrow('DATABASE_URL');
  expect(PoolCtor).not.toHaveBeenCalled();
});

test('query uses a single cached pool with the connection string', async () => {
  const db = await load('postgres://user:pass@host/db');
  await db.query('SELECT $1::int', [1]);
  await db.query('SELECT 2');
  expect(PoolCtor).toHaveBeenCalledTimes(1);
  expect(PoolCtor).toHaveBeenCalledWith(
    expect.objectContaining({ connectionString: 'postgres://user:pass@host/db' }),
  );
  expect(poolInstance.query).toHaveBeenCalledWith('SELECT $1::int', [1]);
});

test('Supabase connections fail closed without a CA', async () => {
  delete process.env.DATABASE_SSL_CA;
  const db = await load('postgres://user:pass@aws-0-ap-northeast-1.pooler.supabase.com/db');
  expect(() => db.getPool()).toThrow('DATABASE_SSL_CA');
});

test('Supabase connections normalize and verify the configured CA', async () => {
  process.env.DATABASE_SSL_CA = 'line1\\nline2';
  const db = await load('postgres://user:pass@aws-0-ap-northeast-1.pooler.supabase.com/db');
  db.getPool();
  expect(PoolCtor).toHaveBeenCalledWith(expect.objectContaining({
    ssl: { ca: 'line1\nline2', rejectUnauthorized: true },
  }));
});

test('withTransaction commits and releases a dedicated client', async () => {
  const db = await load('postgres://user:pass@host/db');
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
  poolInstance.connect = jest.fn().mockResolvedValue(client);
  const result = await db.withTransaction(async (tx) => {
    expect(tx).toBe(client);
    await tx.query('SELECT 1');
    return 'ok';
  });
  expect(result).toBe('ok');
  expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('withTransaction rolls back and preserves the original error', async () => {
  const db = await load('postgres://user:pass@host/db');
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
  poolInstance.connect = jest.fn().mockResolvedValue(client);
  const original = new Error('boom');
  await expect(db.withTransaction(async () => { throw original; })).rejects.toBe(original);
  expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  expect(client.release).toHaveBeenCalledTimes(1);
});
