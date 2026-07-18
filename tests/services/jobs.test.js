import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let completeJob;
let retryOrFailJob;

const load = async () => {
  jest.resetModules();
  completeJob = jest.fn().mockResolvedValue(true);
  retryOrFailJob = jest.fn().mockResolvedValue('pending');
  jest.doMock('../../repositories/jobs.js', () => ({ completeJob, retryOrFailJob }));
  return import('../../services/jobs.js');
};

afterEach(() => {
  jest.dontMock('../../repositories/jobs.js');
  jest.resetModules();
});

test('computeBackoffSeconds grows exponentially and caps', async () => {
  const { computeBackoffSeconds } = await load();
  expect(computeBackoffSeconds(1, { baseSeconds: 5 })).toBe(5);
  expect(computeBackoffSeconds(2, { baseSeconds: 5 })).toBe(10);
  expect(computeBackoffSeconds(3, { baseSeconds: 5 })).toBe(20);
  expect(computeBackoffSeconds(20, { baseSeconds: 5, maxSeconds: 100 })).toBe(100);
});

test('runJob completes the job on success', async () => {
  const { runJob } = await load();
  const handler = jest.fn().mockResolvedValue('ok');
  const job = { id: 'j1', attempts: 1, lease_token: 'lease1' };
  const status = await runJob(job, handler);
  expect(handler).toHaveBeenCalledWith(job);
  expect(completeJob).toHaveBeenCalledWith('j1', 'lease1');
  expect(retryOrFailJob).not.toHaveBeenCalled();
  expect(status).toBe('done');
});

test('runJob retries with backoff on handler failure', async () => {
  const { runJob } = await load();
  const handler = jest.fn().mockRejectedValue(new Error('boom'));
  const status = await runJob({ id: 'j2', attempts: 2, lease_token: 'lease2' }, handler);
  expect(completeJob).not.toHaveBeenCalled();
  expect(retryOrFailJob).toHaveBeenCalledWith('j2', {
    leaseToken: 'lease2', error: 'boom', backoffSeconds: 10, retryable: true,
  });
  expect(status).toBe('pending');
});

test('runJob passes a handler refusal to repeat paid work straight through', async () => {
  const { runJob } = await load();
  retryOrFailJob.mockResolvedValue('dead');
  const handler = jest.fn().mockRejectedValue(
    Object.assign(new Error('refusing to repeat paid work'), { retryable: false }),
  );
  const status = await runJob({ id: 'j2', attempts: 2, lease_token: 'lease2' }, handler);
  expect(retryOrFailJob).toHaveBeenCalledWith('j2', expect.objectContaining({ retryable: false }));
  expect(status).toBe('dead');
});

test('runJob reports stale when another worker owns the lease', async () => {
  const { runJob } = await load();
  completeJob.mockResolvedValue(false);
  const status = await runJob(
    { id: 'j1', attempts: 1, lease_token: 'old-lease' },
    jest.fn().mockResolvedValue(undefined),
  );
  expect(status).toBe('stale');
});
