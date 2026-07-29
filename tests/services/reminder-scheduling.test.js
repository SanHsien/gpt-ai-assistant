import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let enqueueJob;

const load = async () => {
  jest.resetModules();
  process.env.REMINDER_OFFSETS = '60,1440';
  enqueueJob = jest.fn();
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  return import('../../services/reminder-scheduling.js');
};

afterEach(() => {
  delete process.env.REMINDER_OFFSETS;
  jest.dontMock('../../repositories/jobs.js');
  jest.useRealTimers();
  jest.resetModules();
});

test('scheduleEventReminders never overlaps enqueue calls on one transaction executor', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:00:00Z'));
  const { scheduleEventReminders } = await load();
  let releaseFirst;
  enqueueJob
    .mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ id: 'start-job' });
    }))
    .mockResolvedValue({ id: 'lead-job' });

  const pending = scheduleEventReminders({
    ownerId: 'owner-1',
    event: { id: 'event-1', version: 2 },
    channelTarget: { encrypted: 'target' },
    remindAt: new Date('2026-07-20T08:00:00.000Z'),
    executor: jest.fn(),
  });
  await Promise.resolve();
  expect(enqueueJob).toHaveBeenCalledTimes(1);
  releaseFirst();
  await expect(pending).resolves.toEqual({ startJobId: 'start-job', queued: 3 });
  expect(enqueueJob).toHaveBeenCalledTimes(3);
});
