import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;
let decryptJson;
let encryptJson;

const load = async () => {
  jest.resetModules();
  query = jest.fn();
  encryptJson = jest.fn((value) => ({ encrypted: value }));
  decryptJson = jest.fn((value) => value.encrypted);
  jest.doMock('../../services/database.js', () => ({ query }));
  jest.doMock('../../services/data-protection.js', () => ({ decryptJson, encryptJson }));
  return import('../../repositories/jobs.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../services/data-protection.js');
  jest.resetModules();
});

test('enqueueJob inserts with ON CONFLICT and returns the row', async () => {
  const { enqueueJob } = await load();
  query.mockResolvedValue({ rows: [{ id: 'j1', payload: { encrypted: { a: 1 } } }] });
  const job = await enqueueJob({ kind: 'reminder', payload: { a: 1 }, idempotencyKey: 'k1' });
  expect(job).toEqual({ id: 'j1', payload: { a: 1 }, result: null });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/insert into jobs/i);
  expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/i);
  expect(params[0]).toBe('reminder');
  expect(params[1]).toBe(JSON.stringify({ encrypted: { a: 1 } }));
  expect(params[3]).toBe('k1');
});

test('enqueueJob returns null on duplicate idempotency key', async () => {
  const { enqueueJob } = await load();
  query.mockResolvedValue({ rows: [] });
  expect(await enqueueJob({ kind: 'x' })).toBeNull();
});

test('reviveDeadJob requeues only a dead job with the matching idempotency key', async () => {
  const { reviveDeadJob } = await load();
  query.mockResolvedValue({ rows: [{
    id: 'j-dead', status: 'pending', payload: { encrypted: { taskId: 't1' } },
  }] });

  const job = await reviveDeadJob('google-tasks-sync:t1:1:upsert');

  expect(job).toEqual({
    id: 'j-dead', status: 'pending', payload: { taskId: 't1' }, result: null,
  });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'pending'/i);
  expect(sql).toMatch(/attempts = 0/i);
  expect(sql).toMatch(/last_error = null/i);
  expect(sql).toMatch(/where idempotency_key = \$1 and status = 'dead'/i);
  expect(params).toEqual(['google-tasks-sync:t1:1:upsert']);
});

test('reviveDeadJob does not touch pending, processing, or completed jobs', async () => {
  const { reviveDeadJob } = await load();
  query.mockResolvedValue({ rows: [] });
  await expect(reviveDeadJob('k1')).resolves.toBeNull();
});

test('claimNextJob uses FOR UPDATE SKIP LOCKED and returns the claimed job', async () => {
  const { claimNextJob } = await load();
  query.mockResolvedValue({ rows: [{ id: 'j2', attempts: 1, payload: { encrypted: {} } }] });
  const job = await claimNextJob({ leaseSeconds: 30 });
  expect(job).toEqual({
    id: 'j2', attempts: 1, payload: {}, result: null,
  });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/for update skip locked/i);
  expect(sql).toMatch(/status = 'processing'/i);
  expect(params).toEqual([30, null]);
});

test('claimNextJob reclaims a crashed worker job (expired lease) and retires exhausted ones', async () => {
  const { claimNextJob } = await load();
  query.mockResolvedValue({ rows: [{ id: 'j-reclaim', attempts: 2, payload: { encrypted: {} } }] });
  await claimNextJob({ leaseSeconds: 30 });
  const [sql] = query.mock.calls[0];
  // worker 崩潰後租約過期、且仍有嘗試次數的 processing job 會被重新領取（crash recovery）。
  expect(sql).toMatch(/status = 'processing' and lease_until <= now\(\) and attempts < max_attempts/i);
  // 已用盡嘗試次數的過期 processing job 轉 dead（dead-letter），不再無限重試。
  expect(sql).toMatch(/set status = 'dead'[\s\S]*attempts >= max_attempts/i);
});

test('claimNextJob can restrict a scheduler to reminder jobs', async () => {
  const { claimNextJob } = await load();
  query.mockResolvedValue({ rows: [] });
  await claimNextJob({ kinds: ['line-reminder'] });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/kind = any/i);
  expect(params).toEqual([60, ['line-reminder']]);
});

test('claimNextJob returns null when nothing is claimable', async () => {
  const { claimNextJob } = await load();
  query.mockResolvedValue({ rows: [] });
  expect(await claimNextJob()).toBeNull();
});

test('completeJob marks the job done', async () => {
  const { completeJob } = await load();
  query.mockResolvedValue({ rowCount: 1 });
  expect(await completeJob('j1', 'lease1')).toBe(true);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'done'/i);
  expect(sql).toMatch(/lease_token = \$2/i);
  expect(params).toEqual(['j1', 'lease1']);
});

test('retryOrFailJob returns the resulting status', async () => {
  const { retryOrFailJob } = await load();
  query.mockResolvedValue({ rows: [{ status: 'pending' }] });
  const status = await retryOrFailJob('j1', {
    leaseToken: 'lease1', error: 'boom', backoffSeconds: 20,
  });
  expect(status).toBe('pending');
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/attempts >= max_attempts/i);
  expect(sql).toMatch(/lease_token = \$4/i);
  expect(params).toEqual(['j1', 20, 'boom', 'lease1', true]);
});

test('completeJob rejects a stale lease token', async () => {
  const { completeJob } = await load();
  query.mockResolvedValue({ rowCount: 0 });
  expect(await completeJob('j1', 'stale')).toBe(false);
});

test('retryOrFailJob dead-letters a failure the handler marked unretryable', async () => {
  const { retryOrFailJob } = await load();
  query.mockResolvedValue({ rows: [{ status: 'dead' }] });
  const status = await retryOrFailJob('j1', { leaseToken: 'lease1', retryable: false });
  expect(status).toBe('dead');
  const [sql, params] = query.mock.calls[0];
  // NOT $5 => 直接 dead，不看 attempts。
  expect(sql).toMatch(/NOT \$5 OR attempts >= max_attempts/i);
  expect(params[4]).toBe(false);
});

test('saveJobResult encrypts the AI checkpoint and requires a live lease', async () => {
  const { saveJobResult } = await load();
  query.mockResolvedValue({ rowCount: 1 });
  expect(await saveJobResult('j1', 'lease1', { messages: ['hi'] })).toBe(true);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/set result = \$3/i);
  expect(sql).toMatch(/lease_token = \$2/i);
  expect(encryptJson).toHaveBeenCalledWith({ messages: ['hi'] });
  expect(params[2]).toBe(JSON.stringify({ encrypted: { messages: ['hi'] } }));
});

test('saveJobResult reports a stale lease instead of overwriting', async () => {
  const { saveJobResult } = await load();
  query.mockResolvedValue({ rowCount: 0 });
  expect(await saveJobResult('j1', 'stale', {})).toBe(false);
});

test('markJobDelivered records delivery exactly once', async () => {
  const { markJobDelivered } = await load();
  query.mockResolvedValue({ rowCount: 1 });
  expect(await markJobDelivered('j1', 'lease1')).toBe(true);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/delivered_at = now\(\)/i);
  expect(sql).toMatch(/delivered_at IS NULL/i);
  expect(params).toEqual(['j1', 'lease1']);
});

test('checkpoint writes degrade instead of failing when migration 0003 is not applied', async () => {
  const { saveJobResult, markJobDelivered } = await load();
  const undefinedColumn = Object.assign(new Error('column "result" does not exist'), { code: '42703' });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  query.mockRejectedValue(undefinedColumn);
  expect(await saveJobResult('j1', 'lease1', {})).toBeNull();
  expect(await markJobDelivered('j1', 'lease1')).toBeNull();
  jest.restoreAllMocks();
});

test('checkpoint writes still surface a real database error', async () => {
  const { saveJobResult } = await load();
  query.mockRejectedValue(new Error('connection refused'));
  await expect(saveJobResult('j1', 'lease1', {})).rejects.toThrow('connection refused');
});

test('rescheduleJob moves a processing job back to pending at a new run_at', async () => {
  const { rescheduleJob } = await load();
  query.mockResolvedValue({ rowCount: 1 });
  const at = new Date('2026-07-21T00:00:00.000Z');
  expect(await rescheduleJob('j1', 'lease1', at)).toBe(true);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/status = 'pending', run_at = \$3/i);
  expect(sql).toMatch(/lease_token = \$2/i);
  expect(params).toEqual(['j1', 'lease1', at]);
});

test('rescheduleJob reports a lost lease', async () => {
  const { rescheduleJob } = await load();
  query.mockResolvedValue({ rowCount: 0 });
  expect(await rescheduleJob('j1', 'stale', new Date())).toBe(false);
});
