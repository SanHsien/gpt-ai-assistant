import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let decryptJson;
let getEvent;
let markJobDelivered;
let rescheduleJob;
let getUserById;
let push;
let enqueueJob;

const EVENT = {
  id: 'event-1',
  owner_id: 'owner-1',
  title: '看診',
  start_at: '2026-07-20T07:00:00.000Z',
  timezone: 'Asia/Taipei',
  all_day: false,
  status: 'confirmed',
  provider_event_id: 'google-1',
};

const JOB = {
  id: '9dfef00c-ec97-4306-96c9-c927e5347ce4',
  lease_token: 'lease-1',
  delivered_at: null,
  run_at: new Date().toISOString(),
  payload: {
    ownerId: 'owner-1', eventId: 'event-1', channelTarget: { encrypted: 'target' },
  },
};

const load = async () => {
  jest.resetModules();
  decryptJson = jest.fn().mockReturnValue({ id: 'U-line-id' });
  getEvent = jest.fn().mockResolvedValue(EVENT);
  markJobDelivered = jest.fn().mockResolvedValue(true);
  rescheduleJob = jest.fn().mockResolvedValue(true);
  getUserById = jest.fn().mockResolvedValue({
    id: 'owner-1', timezone: 'Asia/Taipei', quiet_hours: null, reminders_paused: false,
  });
  push = jest.fn().mockResolvedValue({ data: {} });
  enqueueJob = jest.fn().mockResolvedValue({ id: 'next-job' });
  jest.doMock('../../services/data-protection.js', () => ({ decryptJson }));
  jest.doMock('../../repositories/events.js', () => ({ getEvent }));
  jest.doMock('../../repositories/jobs.js', () => ({ markJobDelivered, rescheduleJob, enqueueJob }));
  jest.doMock('../../repositories/users.js', () => ({ getUserById }));
  jest.doMock('../../services/line.js', () => ({ push }));
  return import('../../services/reminders.js');
};

afterEach(() => {
  jest.dontMock('../../services/data-protection.js');
  jest.dontMock('../../repositories/events.js');
  jest.dontMock('../../repositories/jobs.js');
  jest.dontMock('../../repositories/users.js');
  jest.dontMock('../../services/line.js');
  jest.resetModules();
});

test('timed events remind at their start and all-day events at 09:00 local', async () => {
  const { getDefaultReminderTime } = await load();
  expect(getDefaultReminderTime(EVENT).toISOString()).toBe('2026-07-20T07:00:00.000Z');
  expect(getDefaultReminderTime({
    start_at: '2026-07-19T16:00:00.000Z', all_day: true, timezone: 'Asia/Taipei',
  }).toISOString()).toBe('2026-07-20T01:00:00.000Z');
  expect(getDefaultReminderTime({
    start_at: '2026-03-08T05:00:00.000Z', all_day: true, timezone: 'America/New_York',
  }).toISOString()).toBe('2026-03-08T13:00:00.000Z');
});

test('sends one idempotent LINE push with a complete action', async () => {
  const { sendLineReminder } = await load();
  await sendLineReminder(JOB);
  expect(push).toHaveBeenCalledWith({
    to: 'U-line-id',
    retryKey: JOB.id,
    messages: [expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('看診'),
      quickReply: expect.objectContaining({ items: expect.any(Array) }),
    })],
  });
  expect(push.mock.calls[0][0].messages[0].quickReply.items[0].action)
    .toEqual({
      type: 'postback',
      label: '標記完成',
      data: '完成行程 event-1',
      displayText: '完成行程',
    });
  expect(markJobDelivered).toHaveBeenCalledWith(JOB.id, 'lease-1');
});

test('a lead reminder labels how far ahead it is', async () => {
  const { sendLineReminder } = await load();
  await sendLineReminder({ ...JOB, payload: { ...JOB.payload, leadMinutes: 1440 } });
  const { text } = push.mock.calls[0][0].messages[0];
  expect(text).toContain('行程提醒（1 天前）');
});

test('does not push cancelled, completed, deleted, or already delivered reminders', async () => {
  const { sendLineReminder } = await load();
  getEvent.mockResolvedValue({ ...EVENT, status: 'completed' });
  await sendLineReminder(JOB);
  await sendLineReminder({ ...JOB, delivered_at: '2026-07-20T07:00:00.000Z' });
  expect(push).not.toHaveBeenCalled();
});

test('treats LINE duplicate retry-key response as delivered', async () => {
  const { sendLineReminder } = await load();
  push.mockRejectedValue(Object.assign(new Error('duplicate'), { response: { status: 409 } }));
  await sendLineReminder(JOB);
  expect(markJobDelivered).toHaveBeenCalled();
});

test('does not retry permanent LINE client errors', async () => {
  const { sendLineReminder } = await load();
  push.mockRejectedValue(Object.assign(new Error('bad target'), { response: { status: 400 } }));
  await expect(sendLineReminder(JOB)).rejects.toMatchObject({ retryable: false });
  expect(markJobDelivered).not.toHaveBeenCalled();
});

test('quietHoursEnd returns null outside the quiet window and an instant inside it', async () => {
  const { quietHoursEnd } = await load();
  // 台北 20:00（UTC 12:00）不在 22–8 安靜時段。
  expect(quietHoursEnd(new Date('2026-07-20T12:00:00Z'), 'Asia/Taipei', { start: 22, end: 8 })).toBeNull();
  // 台北 23:00（UTC 15:00）在 22–8 內 → 結束在隔天 08:00 台北（00:00 UTC）。
  const end = quietHoursEnd(new Date('2026-07-20T15:00:00Z'), 'Asia/Taipei', { start: 22, end: 8 });
  expect(end.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  // 台北 03:00（UTC 前一日 19:00）仍在 22–8 內 → 結束在當天 08:00 台北。
  const early = quietHoursEnd(new Date('2026-07-20T19:00:00Z'), 'Asia/Taipei', { start: 22, end: 8 });
  expect(early.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  // 無效設定回 null。
  expect(quietHoursEnd(new Date(), 'Asia/Taipei', null)).toBeNull();
  expect(quietHoursEnd(new Date(), 'Asia/Taipei', { start: 5, end: 5 })).toBeNull();
});

test('paused reminders are skipped without pushing or resending', async () => {
  const { sendLineReminder } = await load();
  getUserById.mockResolvedValue({ id: 'owner-1', reminders_paused: true });
  await sendLineReminder(JOB);
  expect(push).not.toHaveBeenCalled();
  expect(rescheduleJob).not.toHaveBeenCalled();
});

test('a stale reminder past the freshness window is skipped', async () => {
  process.env.REMINDER_STALE_MINUTES = '120';
  const { sendLineReminder } = await load();
  const stale = { ...JOB, run_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() };
  await sendLineReminder(stale);
  expect(push).not.toHaveBeenCalled();
  delete process.env.REMINDER_STALE_MINUTES;
});

test('a reminder due during quiet hours is rescheduled to the window end, not pushed', async () => {
  const { sendLineReminder } = await load();
  getUserById.mockResolvedValue({
    id: 'owner-1', timezone: 'Asia/Taipei', quiet_hours: { start: 22, end: 8 }, reminders_paused: false,
  });
  // run_at = 台北 23:30（不過期），落在安靜時段。
  const nightJob = { ...JOB, run_at: '2026-07-20T15:30:00.000Z' };
  jest.useFakeTimers().setSystemTime(new Date('2026-07-20T15:30:00Z'));
  await sendLineReminder(nightJob);
  jest.useRealTimers();
  expect(push).not.toHaveBeenCalled();
  expect(rescheduleJob).toHaveBeenCalledWith(JOB.id, 'lease-1', expect.any(Date));
});

test('nextOccurrence advances by frequency and stops at count/until', async () => {
  const { nextOccurrence } = await load();
  expect(nextOccurrence({ freq: 'WEEKLY', interval: 1 }, '2099-07-20T07:00:00.000Z', 0).toISOString())
    .toBe('2099-07-27T07:00:00.000Z');
  expect(nextOccurrence({ freq: 'DAILY', interval: 2 }, '2099-07-20T00:00:00.000Z', 0).toISOString())
    .toBe('2099-07-22T00:00:00.000Z');
  // count=2 → 只有 occurrence 0、1；index 1 之後沒有下一個。
  expect(nextOccurrence({ freq: 'WEEKLY', count: 2 }, '2099-07-27T07:00:00.000Z', 1)).toBeNull();
  // 超過 until 回 null。
  expect(nextOccurrence({ freq: 'WEEKLY', until: '2099-07-25T00:00:00.000Z' }, '2099-07-20T07:00:00.000Z', 0))
    .toBeNull();
});

test('a recurring reminder schedules the next occurrence before delivering this one', async () => {
  const { sendLineReminder } = await load();
  getEvent.mockResolvedValue({
    ...EVENT, start_at: '2099-07-20T07:00:00.000Z', recurrence: { freq: 'WEEKLY', interval: 1 }, version: 1,
  });
  await sendLineReminder({ ...JOB, run_at: new Date().toISOString(), payload: { ...JOB.payload } });
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'line-reminder',
    idempotencyKey: 'line-reminder:event-1:occ1:start:1',
    payload: expect.objectContaining({ occurrenceStart: '2099-07-27T07:00:00.000Z', occurrenceIndex: 1 }),
  }), undefined);
});

test('a non-recurring reminder does not schedule any follow-up', async () => {
  const { sendLineReminder } = await load();
  await sendLineReminder(JOB);
  expect(enqueueJob).not.toHaveBeenCalled();
});

test('monthly recurrence skips invalid month days instead of overflowing', async () => {
  const { nextOccurrence } = await load();
  expect(nextOccurrence({ freq: 'MONTHLY' }, '2027-01-31T07:00:00.000Z', 0).toISOString())
    .toBe('2027-03-31T07:00:00.000Z');
});

test('a recurring occurrence schedules its configured lead reminders too', async () => {
  process.env.REMINDER_OFFSETS = '60,1440';
  const { sendLineReminder } = await load();
  getEvent.mockResolvedValue({
    ...EVENT, start_at: '2099-07-20T07:00:00.000Z', recurrence: { freq: 'WEEKLY' }, version: 1,
  });
  await sendLineReminder(JOB);
  const keys = enqueueJob.mock.calls.map(([job]) => job.idempotencyKey);
  expect(keys).toEqual(expect.arrayContaining([
    'line-reminder:event-1:occ1:start:1',
    'line-reminder:event-1:occ1:lead60:1',
    'line-reminder:event-1:occ1:lead1440:1',
  ]));
  delete process.env.REMINDER_OFFSETS;
});
