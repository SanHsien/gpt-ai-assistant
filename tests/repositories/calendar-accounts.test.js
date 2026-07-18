import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;
let client;
let encryptJson;
let decryptJson;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  client = { query: jest.fn() };
  encryptJson = jest.fn((value) => ({ encrypted: value }));
  decryptJson = jest.fn((value) => value.encrypted);
  jest.doMock('../../services/database.js', () => ({
    query,
    withTransaction: jest.fn((fn) => fn(client)),
  }));
  jest.doMock('../../services/data-protection.js', () => ({ encryptJson, decryptJson }));
  return import('../../repositories/calendar-accounts.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../services/data-protection.js');
  jest.resetModules();
});

test('calendar credentials are encrypted before persistence', async () => {
  const { saveCalendarAccount } = await load();
  query.mockResolvedValue({
    rows: [{ owner_id: 'u1', credentials: { encrypted: { refresh_token: 'secret' } } }],
  });
  const account = await saveCalendarAccount({
    ownerId: 'u1', credentials: { refresh_token: 'secret' }, scopes: ['scope'],
  });
  expect(encryptJson).toHaveBeenCalledWith({ refresh_token: 'secret' });
  expect(query.mock.calls[0][1][1]).toBe(JSON.stringify({ encrypted: { refresh_token: 'secret' } }));
  expect(account.credentials).toEqual({ refresh_token: 'secret' });
});

test('OAuth state is hashed at rest and consumed exactly once', async () => {
  const { createOAuthState, consumeOAuthState } = await load();
  query.mockResolvedValue({ rowCount: 1 });
  await createOAuthState({
    ownerId: 'u1', state: 'raw-state', codeVerifier: 'verifier-secret', expiresAt: '2099-01-01',
  });
  const stored = query.mock.calls[0][1][0];
  expect(stored).not.toContain('raw-state');
  expect(stored).toHaveLength(64);

  expect(query.mock.calls[0][1][2]).toBe(JSON.stringify({ encrypted: 'verifier-secret' }));
  client.query.mockResolvedValue({
    rows: [{ owner_id: 'u1', code_verifier: { encrypted: 'verifier-secret' } }],
  });
  await expect(consumeOAuthState('raw-state')).resolves.toEqual({
    owner_id: 'u1', code_verifier: 'verifier-secret',
  });
  expect(client.query.mock.calls[0][0]).toMatch(/delete from oauth_states/i);
  expect(client.query.mock.calls[0][0]).toMatch(/expires_at > now/i);
  expect(client.query.mock.calls[0][1][0]).toBe(stored);
});

test('hasCalendarAccount returns the database boolean', async () => {
  const { hasCalendarAccount } = await load();
  query.mockResolvedValue({ rows: [{ connected: true }] });
  await expect(hasCalendarAccount('u1')).resolves.toBe(true);
});

test('deleteCalendarAccount removes the owner row and reports if any', async () => {
  const { deleteCalendarAccount } = await load();
  query.mockResolvedValueOnce({ rowCount: 1 });
  expect(await deleteCalendarAccount('owner-1')).toBe(true);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/delete from calendar_accounts where owner_id = \$1/i);
  expect(params).toEqual(['owner-1']);
  query.mockResolvedValueOnce({ rowCount: 0 });
  expect(await deleteCalendarAccount('owner-2')).toBe(false);
});

test('Tasks inbound leases a poll and commits its watermark only for the same claim', async () => {
  const { claimAccountsForTasksInbound, completeTasksInboundClaim } = await load();
  query.mockResolvedValueOnce({ rows: [{ owner_id: 'u1', prev: null }] });
  await claimAccountsForTasksInbound(
    '2026-07-17T04:55:00.000Z',
    20,
    '2026-07-17T05:00:00.000Z',
  );
  expect(query.mock.calls[0][0]).toMatch(/tasks_inbound_claimed_at/i);
  expect(query.mock.calls[0][1]).toEqual([
    '2026-07-17T04:55:00.000Z', 20, '2026-07-17T05:00:00.000Z',
  ]);

  query.mockResolvedValueOnce({ rowCount: 1 });
  await expect(completeTasksInboundClaim('u1', '2026-07-17T05:00:00.000Z')).resolves.toBe(true);
  expect(query.mock.calls[1][0]).toMatch(/tasks_last_pulled_at = \$2/i);
  expect(query.mock.calls[1][0]).toMatch(/tasks_inbound_claimed_at = \$2/i);
});
