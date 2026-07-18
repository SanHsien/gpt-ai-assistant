import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let claimDueWeatherSubscriptions;
let getSubscription;
let markSubscriptionDelivered;
let enqueueJob;
let markJobDelivered;
let decryptJson;
let push;
let getWeatherByPlace;
let formatWeather;
let withTransaction;

const SUB = {
  id: 's1', owner_id: 'o1', latitude: 25.04, longitude: 121.56, timezone: 'Asia/Taipei', location_label: '臺北市', enabled: true,
};

const load = async () => {
  jest.resetModules();
  process.env.WEATHER_DAILY_MAX_PER_RUN = '50';
  claimDueWeatherSubscriptions = jest.fn().mockResolvedValue([SUB]);
  getSubscription = jest.fn().mockResolvedValue(SUB);
  markSubscriptionDelivered = jest.fn().mockResolvedValue(undefined);
  enqueueJob = jest.fn().mockResolvedValue({ id: 'j1' });
  markJobDelivered = jest.fn().mockResolvedValue(true);
  decryptJson = jest.fn().mockReturnValue({ id: 'U-line' });
  push = jest.fn().mockResolvedValue({ data: {} });
  getWeatherByPlace = jest.fn().mockResolvedValue({ place: SUB, forecast: {} });
  formatWeather = jest.fn().mockReturnValue('臺北市 天氣');
  const client = { query: jest.fn().mockResolvedValue({ rows: [{ channel_target: { e: 1 } }] }) };
  withTransaction = jest.fn((fn) => fn(client));
  jest.doMock('../../repositories/subscriptions.js', () => ({
    claimDueWeatherSubscriptions, getSubscription, markSubscriptionDelivered,
  }));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob, markJobDelivered }));
  jest.doMock('../../services/data-protection.js', () => ({ decryptJson }));
  jest.doMock('../../services/line.js', () => ({ push }));
  jest.doMock('../../services/weather/index.js', () => ({ getWeatherByPlace, formatWeather }));
  jest.doMock('../../services/database.js', () => ({ withTransaction }));
  return import('../../services/weather-subscription.js');
};

afterEach(() => {
  delete process.env.WEATHER_DAILY_MAX_PER_RUN;
  ['../../repositories/subscriptions.js', '../../repositories/jobs.js', '../../services/data-protection.js',
    '../../services/line.js', '../../services/weather/index.js', '../../services/database.js']
    .forEach((mod) => jest.dontMock(mod));
  jest.resetModules();
});

test('nextWeatherRun picks today when the hour is still ahead, tomorrow when passed', async () => {
  const { nextWeatherRun } = await load();
  // 台北 06:00（UTC 前一日 22:00）；目標 8 點還沒到 → 今天 08:00 台北 = 00:00 UTC。
  const morning = nextWeatherRun(new Date('2026-07-16T22:00:00Z'), 'Asia/Taipei', 8);
  expect(morning.toISOString()).toBe('2026-07-17T00:00:00.000Z');
  // 台北 10:00（UTC 02:00）；目標 8 點已過 → 明天 08:00 台北 = 隔天 00:00 UTC。
  const afterHour = nextWeatherRun(new Date('2026-07-17T02:00:00Z'), 'Asia/Taipei', 8);
  expect(afterHour.toISOString()).toBe('2026-07-18T00:00:00.000Z');
});

test('nextWeatherRun keeps the local hour across a daylight-saving transition', async () => {
  const { nextWeatherRun } = await load();
  // New York switches from UTC-5 to UTC-4 on 2026-03-08.
  const run = nextWeatherRun(new Date('2026-03-08T13:30:00Z'), 'America/New_York', 9);
  expect(run.toISOString()).toBe('2026-03-09T13:00:00.000Z');
});

test('enqueueDueWeatherReminders claims due subs and enqueues one job each', async () => {
  const { enqueueDueWeatherReminders } = await load();
  const summary = await enqueueDueWeatherReminders({ now: new Date('2026-07-17T00:00:00Z') });
  expect(summary).toEqual({ claimed: 1, queued: 1 });
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'weather-daily',
    idempotencyKey: 'weather-daily:s1:2026-07-17',
  }), expect.any(Function));
});

test('sendDailyWeather pushes the forecast and marks delivered', async () => {
  const { sendDailyWeather } = await load();
  await sendDailyWeather({
    id: 'j1', lease_token: 'l1', delivered_at: null, payload: { subscriptionId: 's1', channelTarget: { e: 1 } },
  });
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ to: 'U-line', retryKey: 'j1' }));
  expect(markJobDelivered).toHaveBeenCalledWith('j1', 'l1');
  expect(markSubscriptionDelivered).toHaveBeenCalledWith('s1');
});

test('sendDailyWeather skips a cancelled subscription without pushing', async () => {
  const { sendDailyWeather } = await load();
  getSubscription.mockResolvedValue({ ...SUB, enabled: false });
  await sendDailyWeather({
    id: 'j1', lease_token: 'l1', payload: { subscriptionId: 's1', channelTarget: { e: 1 } },
  });
  expect(push).not.toHaveBeenCalled();
  expect(markJobDelivered).not.toHaveBeenCalled();
});

test('sendDailyWeather treats a 409 retry-key duplicate as delivered', async () => {
  const { sendDailyWeather } = await load();
  push.mockRejectedValue(Object.assign(new Error('dup'), { response: { status: 409 } }));
  await sendDailyWeather({
    id: 'j1', lease_token: 'l1', payload: { subscriptionId: 's1', channelTarget: { e: 1 } },
  });
  expect(markJobDelivered).toHaveBeenCalled();
});
