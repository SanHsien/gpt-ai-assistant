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

test('saveSyncToken defaults to the Google-origin baseline query version', async () => {
  const { saveSyncToken } = await load();
  query.mockResolvedValue({ rowCount: 1 });
  await saveSyncToken('owner-1', 'token-3');
  expect(query.mock.calls[0][1]).toEqual(['owner-1', 'token-3', 3]);
});

test('Calendar inbound allows only one fresh owner claim at a time', async () => {
  const { claimCalendarInboundSync } = await load();
  client.query
    .mockResolvedValueOnce({
      rows: [{
        owner_id: 'u1',
        calendar_id: 'primary',
        sync_token: null,
        inbound_claim_token: null,
      }],
    })
    .mockResolvedValueOnce({
      rows: [{
        owner_id: 'u1',
        inbound_claim_token: 'claim-a',
        inbound_baseline_generation: 'generation-a',
        inbound_baseline_time_min: '2026-07-29T00:00:00Z',
      }],
    });
  await expect(claimCalendarInboundSync({
    ownerId: 'u1',
    claimToken: 'claim-a',
    baselineGeneration: 'generation-a',
    baselineTimeMin: '2026-07-29T00:00:00Z',
    staleBefore: '2026-07-29T00:04:00Z',
    claimedAt: '2026-07-29T00:05:00Z',
  })).resolves.toEqual(expect.objectContaining({ inbound_claim_token: 'claim-a' }));

  client.query.mockReset();
  client.query.mockResolvedValueOnce({
    rows: [{
      owner_id: 'u1',
      sync_token: null,
      inbound_claim_token: 'claim-a',
      inbound_claimed_at: '2026-07-29T00:05:00Z',
    }],
  });
  await expect(claimCalendarInboundSync({
    ownerId: 'u1',
    claimToken: 'claim-b',
    baselineGeneration: 'generation-b',
    baselineTimeMin: '2026-07-29T00:06:00Z',
    staleBefore: '2026-07-29T00:04:00Z',
    claimedAt: '2026-07-29T00:06:00Z',
  })).resolves.toBeNull();
  expect(client.query).toHaveBeenCalledTimes(1);
});

test('Calendar inbound stale takeover preserves its query snapshot and rejects the old token', async () => {
  const { claimCalendarInboundSync } = await load();
  const persisted = {
    owner_id: 'u1',
    calendar_id: 'primary',
    sync_token: null,
    inbound_claim_token: 'claim-old',
    inbound_claimed_at: '2026-07-29T00:00:00Z',
    inbound_baseline_generation: 'generation-old',
    inbound_baseline_time_min: '2026-07-28T23:00:00Z',
    inbound_page_token: 'page-7',
  };
  client.query
    .mockResolvedValueOnce({ rows: [persisted] })
    .mockResolvedValueOnce({ rows: [{ ...persisted, inbound_claim_token: 'claim-new' }] });
  await claimCalendarInboundSync({
    ownerId: 'u1',
    claimToken: 'claim-new',
    baselineGeneration: 'generation-new',
    baselineTimeMin: '2026-07-29T00:10:00Z',
    staleBefore: '2026-07-29T00:05:00Z',
    claimedAt: '2026-07-29T00:10:00Z',
  });
  expect(client.query.mock.calls[1][1]).toEqual([
    'u1',
    'claim-new',
    '2026-07-29T00:10:00Z',
    'generation-old',
    '2026-07-28T23:00:00Z',
    'page-7',
  ]);

  client.query.mockReset();
  client.query.mockResolvedValueOnce({
    rows: [{ ...persisted, inbound_claim_token: 'claim-new' }],
  });
  await expect(claimCalendarInboundSync({
    ownerId: 'u1',
    requestedClaimToken: 'claim-old',
    claimToken: 'claim-old-refresh',
    baselineGeneration: 'ignored',
    baselineTimeMin: '2026-07-29T00:10:00Z',
    staleBefore: '2026-07-29T00:05:00Z',
    claimedAt: '2026-07-29T00:10:00Z',
  })).resolves.toBeNull();
  expect(client.query).toHaveBeenCalledTimes(1);
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
