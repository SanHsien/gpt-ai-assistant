import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let postHandler;
let postHandlers;
let enqueueEvents;
let handleEvents;
let drainQueue;
let runAfterResponse;
let getHandlers;
let completeGoogleAuthorization;
let isGoogleCalendarConfigured;
let ensureRuntimeReady;

const load = async ({
  remindersEnabled = false,
  googleEnabled = false,
  appLang = 'zh_TW',
} = {}) => {
  jest.resetModules();
  postHandler = null;
  postHandlers = {};
  getHandlers = {};
  enqueueEvents = jest.fn();
  handleEvents = jest.fn();
  drainQueue = jest.fn().mockResolvedValue({ claimed: 0 });
  runAfterResponse = jest.fn((promise) => promise);
  completeGoogleAuthorization = jest.fn().mockResolvedValue({ ownerId: 'u1', backfillCount: 1 });
  isGoogleCalendarConfigured = jest.fn().mockReturnValue(true);
  ensureRuntimeReady = jest.fn().mockResolvedValue(undefined);

  const express = jest.fn(() => ({
    use: jest.fn(),
    get: jest.fn((path, ...handlers) => { getHandlers[path] = handlers.at(-1); }),
    post: jest.fn((path, ...handlers) => {
      postHandlers[path] = handlers.at(-1);
      if (path === '/webhook') postHandler = handlers.at(-1);
    }),
    listen: jest.fn(),
  }));
  express.json = jest.fn(() => jest.fn());

  jest.doMock('express', () => ({ __esModule: true, default: express }));
  jest.doMock('../../app/index.js', () => ({
    handleEvents,
    printPrompts: jest.fn(),
  }));
  jest.doMock('../../app/webhook.js', () => ({ enqueueEvents }));
  jest.doMock('../../config/index.js', () => ({
    __esModule: true,
    default: {
      APP_LANG: appLang,
      APP_DEBUG: false,
      APP_PORT: null,
      APP_URL: null,
      APP_WEBHOOK_PATH: '/webhook',
      ENABLE_GOOGLE_CALENDAR: googleEnabled,
      ENABLE_GOOGLE_CALENDAR_INBOUND: false,
      ENABLE_GOOGLE_TASKS: false,
      ENABLE_GOOGLE_TASKS_INBOUND: false,
      ENABLE_REMINDERS: remindersEnabled,
      ENABLE_WEATHER_PUSH: false,
      REMINDER_CRON_SECRET: (remindersEnabled || googleEnabled)
        ? 'a-very-long-random-reminder-secret'
        : null,
      REMINDER_WORKER_MAX_JOBS: 20,
      REMINDER_WORKER_TIME_BUDGET_MS: 45000,
    },
  }));
  jest.doMock('../../middleware/index.js', () => ({ validateLineSignature: jest.fn() }));
  jest.doMock('../../utils/index.js', () => ({
    fetchVersion: jest.fn(),
    getVersion: jest.fn(),
  }));
  jest.doMock('../../utils/run-after-response.js', () => ({
    __esModule: true,
    default: runAfterResponse,
  }));
  jest.doMock('../../services/runtime-preflight.js', () => ({ ensureRuntimeReady }));
  jest.doMock('../../services/google-calendar.js', () => ({
    completeGoogleAuthorization, isGoogleCalendarConfigured,
  }));
  jest.doMock('../../services/worker.js', () => ({
    drainQueue,
    JOB_KINDS: {
      GOOGLE_CALENDAR_STATUS: 'google-calendar-status',
      GOOGLE_CALENDAR_SYNC: 'google-calendar-sync',
      GOOGLE_CALENDAR_INBOUND: 'google-calendar-inbound',
      GOOGLE_TASKS_INBOUND: 'google-tasks-inbound',
      GOOGLE_TASKS_SYNC: 'google-tasks-sync',
      LINE_REMINDER: 'line-reminder',
      WEATHER_DAILY: 'weather-daily',
    },
  }));

  await import('../../api/index.js');
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

const response = () => {
  const res = {
    redirect: jest.fn(),
    send: jest.fn(),
    sendStatus: jest.fn(),
    set: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

test('liveness endpoint does not depend on external services', async () => {
  await load();
  const res = response();

  await getHandlers['/health/live']({}, res);

  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send).toHaveBeenCalledWith({ status: 'OK' });
  expect(ensureRuntimeReady).not.toHaveBeenCalled();
});

test('durable events are acknowledged before background drain finishes', async () => {
  await load();
  enqueueEvents.mockResolvedValue([]);
  let finishDrain;
  drainQueue.mockImplementation(() => new Promise((resolve) => { finishDrain = resolve; }));
  const res = response();

  await postHandler({ body: { events: [{ webhookEventId: 'w1' }] } }, res);

  expect(res.sendStatus).toHaveBeenCalledWith(200);
  expect(runAfterResponse).toHaveBeenCalledTimes(1);
  finishDrain({ claimed: 1, done: 1 });
  await runAfterResponse.mock.calls[0][0];
});

test('webhook preflight failure returns 503 without running paid work', async () => {
  await load();
  ensureRuntimeReady.mockRejectedValue(new Error('database migration required'));
  const res = response();

  await postHandler({ body: { events: [{ webhookEventId: 'w1' }] } }, res);
  expect(res.sendStatus).toHaveBeenCalledWith(503);
  expect(enqueueEvents).not.toHaveBeenCalled();
  expect(handleEvents).not.toHaveBeenCalled();
});

test('database enqueue failure returns 500 so LINE can redeliver', async () => {
  await load();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  enqueueEvents.mockRejectedValue(new Error('connection refused'));
  const res = response();

  await postHandler({ body: { events: [] } }, res);

  expect(res.sendStatus).toHaveBeenCalledTimes(1);
  expect(res.sendStatus).toHaveBeenCalledWith(500);
  expect(runAfterResponse).not.toHaveBeenCalled();
  expect(handleEvents).not.toHaveBeenCalled();
});

test('Google OAuth callback consumes code then redirects without credentials in the URL', async () => {
  await load();
  drainQueue.mockResolvedValue({ claimed: 1, done: 1 });
  const res = response();
  await getHandlers['/oauth/google/callback']({ query: { code: 'code', state: 'state' } }, res);
  expect(completeGoogleAuthorization).toHaveBeenCalledWith({ code: 'code', state: 'state' });
  expect(res.redirect).toHaveBeenCalledWith(303, '/oauth/google/complete');
  expect(runAfterResponse).toHaveBeenCalledTimes(1);
});

test('Google OAuth callback rejects missing parameters', async () => {
  await load();
  const res = response();
  await getHandlers['/oauth/google/callback']({ query: { error: 'access_denied' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(completeGoogleAuthorization).not.toHaveBeenCalled();
});

test('Google OAuth completion page follows APP_LANG', async () => {
  await load({ appLang: 'en' });
  const res = response();
  await getHandlers['/oauth/google/complete']({}, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<html lang="en">'));
  expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Google authorization complete'));
});

test('reminder cron fails closed on a wrong bearer secret', async () => {
  await load({ remindersEnabled: true });
  const res = response();
  await postHandlers['/cron/reminders']({ headers: { authorization: 'Bearer wrong' } }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(drainQueue).not.toHaveBeenCalled();
});

test('minute cron remains available for Google retries when reminders are disabled', async () => {
  await load({ googleEnabled: true });
  const res = response();
  // Google-only deployments still use the same protected endpoint and secret.
  await postHandlers['/cron/reminders']({
    headers: { authorization: 'Bearer a-very-long-random-reminder-secret' },
  }, res);
  expect(drainQueue).toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
});

test('minute cron drains reminders and Google Calendar delivery jobs', async () => {
  await load({ remindersEnabled: true, googleEnabled: true });
  const res = response();
  await postHandlers['/cron/reminders']({
    headers: { authorization: 'Bearer a-very-long-random-reminder-secret' },
  }, res);
  expect(drainQueue).toHaveBeenCalledWith({
    maxJobs: 20,
    maxDurationMs: 45000,
    kinds: [
      'line-reminder',
      'google-calendar-sync',
      'google-calendar-status',
      'weather-daily',
      'google-tasks-sync',
      'google-calendar-inbound',
      'google-tasks-inbound',
    ],
  });
  expect(res.status).toHaveBeenCalledWith(200);
});
