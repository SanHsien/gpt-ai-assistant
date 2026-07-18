import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let getEvent;
let markJobDelivered;
let push;

const EVENT = {
  id: 'ev-1',
  title: '看診',
  start_at: '2026-07-20T07:00:00.000Z',
  all_day: false,
  timezone: 'Asia/Taipei',
  status: 'confirmed',
};

const load = async () => {
  jest.resetModules();
  getEvent = jest.fn().mockResolvedValue(EVENT);
  markJobDelivered = jest.fn().mockResolvedValue(true);
  push = jest.fn().mockResolvedValue(undefined);
  jest.doMock('../../repositories/events.js', () => ({ getEvent }));
  jest.doMock('../../repositories/jobs.js', () => ({ markJobDelivered }));
  jest.doMock('../../services/line.js', () => ({ push }));
  return import('../../services/google-calendar-status.js');
};

const statusJob = (status, overrides = {}) => ({
  id: `job-${status}`,
  lease_token: 'lease-1',
  delivered_at: null,
  payload: {
    ownerId: 'owner-1', eventId: 'ev-1', notificationTarget: 'U-line-1', status,
  },
  ...overrides,
});

afterEach(() => {
  jest.dontMock('../../repositories/events.js');
  jest.dontMock('../../repositories/jobs.js');
  jest.dontMock('../../services/line.js');
  jest.resetModules();
});

test('success is announced only after the Google event is synced', async () => {
  const { sendGoogleCalendarStatus } = await load();
  await sendGoogleCalendarStatus(statusJob('success'));
  expect(push).toHaveBeenCalledWith(expect.objectContaining({
    to: 'U-line-1',
    retryKey: 'job-success',
    messages: [expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('已同步到 Google 行事曆'),
    })],
  }));
  expect(markJobDelivered).toHaveBeenCalledWith('job-success', 'lease-1');
});

test('final failure offers retry, postpone, and explicit deletion', async () => {
  const { sendGoogleCalendarStatus } = await load();
  await sendGoogleCalendarStatus(statusJob('failure'));
  const message = push.mock.calls[0][0].messages[0];
  expect(message.text).toContain('同步到 Google 行事曆失敗');
  expect(message.quickReply.items.map(({ action }) => ({
    label: action.label, data: action.data, displayText: action.displayText,
  }))).toEqual([
    { label: '重試同步', data: '重試同步 ev-1', displayText: '重試同步' },
    { label: '暫不處理', data: '暫不處理 ev-1', displayText: '暫不處理' },
    { label: '刪除行程', data: '刪行程 ev-1', displayText: '刪除行程' },
  ]);
});

test('a delivered status job never sends a duplicate push', async () => {
  const { sendGoogleCalendarStatus } = await load();
  await sendGoogleCalendarStatus(statusJob('success', { delivered_at: '2026-07-15T00:00:00Z' }));
  expect(push).not.toHaveBeenCalled();
});

test('a permanent LINE delivery error is not retried', async () => {
  const { sendGoogleCalendarStatus } = await load();
  push.mockRejectedValue(Object.assign(new Error('bad target'), { response: { status: 400 } }));
  await expect(sendGoogleCalendarStatus(statusJob('failure')))
    .rejects.toMatchObject({ retryable: false });
  expect(markJobDelivered).not.toHaveBeenCalled();
});

test('LINE 409 is treated as already delivered by the retry key', async () => {
  const { sendGoogleCalendarStatus } = await load();
  push.mockRejectedValue(Object.assign(new Error('duplicate'), { response: { status: 409 } }));
  await sendGoogleCalendarStatus(statusJob('success'));
  expect(markJobDelivered).toHaveBeenCalledWith('job-success', 'lease-1');
});
