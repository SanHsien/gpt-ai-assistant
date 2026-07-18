import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let oauth;
let createOAuthState;
let consumeOAuthState;
let getCalendarAccount;
let saveCalendarAccount;
let getEvent;
let listUnsyncedEvents;
let markEventSynced;
let markEventSyncError;
let enqueueJob;
let withTransaction;
let enqueuePendingGoogleTasks;

const ACCOUNT = {
  owner_id: 'u1',
  credentials: { access_token: 'access', refresh_token: 'refresh', expiry_date: 4102444800000 },
  scopes: ['scope'],
  calendar_id: 'primary',
};

const load = async (configOverrides = {}) => {
  jest.resetModules();
  oauth = {
    credentials: {},
    generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/auth'),
    generateCodeVerifierAsync: jest.fn().mockResolvedValue({
      codeVerifier: 'verifier-secret', codeChallenge: 'challenge',
    }),
    getToken: jest.fn().mockResolvedValue({ tokens: { access_token: 'new', scope: 'scope' } }),
    setCredentials: jest.fn((credentials) => { oauth.credentials = credentials; }),
    getAccessToken: jest.fn().mockResolvedValue({ token: 'access' }),
    request: jest.fn(),
  };
  jest.doMock('google-auth-library', () => ({ OAuth2Client: jest.fn(() => oauth) }));
  jest.doMock('../../config/index.js', () => ({
    __esModule: true,
    default: {
      ENABLE_GOOGLE_CALENDAR: true,
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/oauth/google/callback',
      GOOGLE_CALENDAR_ID: 'primary',
      GOOGLE_OAUTH_STATE_TTL: 600,
      SCHEDULE_DEFAULT_TIMEZONE: 'Asia/Taipei',
      WORKER_MAX_ATTEMPTS: 3,
      ...configOverrides,
    },
  }));
  createOAuthState = jest.fn();
  consumeOAuthState = jest.fn().mockResolvedValue({
    owner_id: 'u1', code_verifier: 'verifier-secret',
  });
  getCalendarAccount = jest.fn().mockResolvedValue(ACCOUNT);
  saveCalendarAccount = jest.fn();
  jest.doMock('../../repositories/calendar-accounts.js', () => ({
    createOAuthState, consumeOAuthState, getCalendarAccount, saveCalendarAccount,
  }));
  getEvent = jest.fn();
  listUnsyncedEvents = jest.fn().mockResolvedValue([]);
  markEventSynced = jest.fn();
  markEventSyncError = jest.fn();
  jest.doMock('../../repositories/events.js', () => ({
    getEvent, listUnsyncedEvents, markEventSynced, markEventSyncError,
  }));
  enqueueJob = jest.fn().mockResolvedValue({ id: 'j1' });
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob }));
  const client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  jest.doMock('../../services/database.js', () => ({ withTransaction }));
  enqueuePendingGoogleTasks = jest.fn().mockResolvedValue(2);
  jest.doMock('../../services/google-tasks-queue.js', () => ({ enqueuePendingGoogleTasks }));
  return import('../../services/google-calendar.js');
};

afterEach(() => {
  jest.dontMock('google-auth-library');
  jest.dontMock('../../config/index.js');
  jest.dontMock('../../repositories/calendar-accounts.js');
  jest.dontMock('../../repositories/events.js');
  jest.dontMock('../../repositories/jobs.js');
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../services/google-tasks-queue.js');
  jest.resetModules();
});

test('authorization URL uses offline access, narrow scope, and stored random state', async () => {
  const { createGoogleAuthorizationUrl, GOOGLE_CALENDAR_SCOPE } = await load();
  await expect(createGoogleAuthorizationUrl('u1'))
    .resolves.toBe('https://accounts.google.com/auth?openExternalBrowser=1');
  expect(createOAuthState).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'u1', codeVerifier: 'verifier-secret',
  }));
  const { state } = createOAuthState.mock.calls[0][0];
  expect(state.length).toBeGreaterThan(20);
  expect(oauth.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
    access_type: 'offline',
    state,
    scope: [GOOGLE_CALENDAR_SCOPE],
    code_challenge_method: 'S256',
    code_challenge: 'challenge',
  }));
});

test('callback consumes state and preserves an existing refresh token', async () => {
  const { completeGoogleAuthorization } = await load();
  await expect(completeGoogleAuthorization({ state: 'state', code: 'code' }))
    .resolves.toEqual({ ownerId: 'u1', backfillCount: 0, taskBackfillCount: 0 });
  expect(consumeOAuthState).toHaveBeenCalledWith('state');
  expect(oauth.getToken).toHaveBeenCalledWith(expect.objectContaining({
    code: 'code', codeVerifier: 'verifier-secret',
  }));
  expect(saveCalendarAccount).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'u1', credentials: expect.objectContaining({ refresh_token: 'refresh' }),
  }));
});

test('callback backfills existing tasks after the tasks scope is granted', async () => {
  const { completeGoogleAuthorization, GOOGLE_TASKS_SCOPE } = await load({ ENABLE_GOOGLE_TASKS: true });
  oauth.getToken.mockResolvedValue({
    tokens: { access_token: 'new', scope: GOOGLE_TASKS_SCOPE },
  });
  await expect(completeGoogleAuthorization({ state: 'state', code: 'code' }))
    .resolves.toEqual({ ownerId: 'u1', backfillCount: 0, taskBackfillCount: 2 });
  expect(enqueuePendingGoogleTasks).toHaveBeenCalledWith('u1');
});

test('callback falls back to the requested scopes when Google omits tokens.scope', async () => {
  const { completeGoogleAuthorization, GOOGLE_TASKS_SCOPE } = await load({ ENABLE_GOOGLE_TASKS: true });
  oauth.getToken.mockResolvedValue({ tokens: { access_token: 'new' } });
  await completeGoogleAuthorization({ state: 'state', code: 'code' });
  expect(saveCalendarAccount).toHaveBeenCalledWith(expect.objectContaining({
    scopes: expect.arrayContaining([GOOGLE_TASKS_SCOPE]),
  }));
  expect(enqueuePendingGoogleTasks).toHaveBeenCalledWith('u1');
});

test('event conversion handles all-day end exclusivity and deterministic ids', async () => {
  const { toGoogleEvent } = await load();
  const body = toGoogleEvent({
    id: '12345678-1234-1234-1234-123456789abc',
    title: '借保貸',
    start_at: '2026-07-19T16:00:00.000Z',
    all_day: true,
    timezone: 'Asia/Taipei',
  });
  expect(body.id).toBe('gpta12345678123412341234123456789abc');
  expect(body.start).toEqual({ date: '2026-07-20' });
  expect(body.end).toEqual({ date: '2026-07-21' });
});

test('all-day events never send a non-exclusive same-day end to Google', async () => {
  const { toGoogleEvent } = await load();
  const body = toGoogleEvent({
    id: '12345678-1234-1234-1234-123456789abc',
    title: '整天活動',
    start_at: '2026-07-19T16:00:00.000Z',
    end_at: '2026-07-20T03:00:00.000Z',
    all_day: true,
    timezone: 'Asia/Taipei',
  });
  expect(body.start).toEqual({ date: '2026-07-20' });
  expect(body.end).toEqual({ date: '2026-07-21' });
});

test('suppresses Google default reminders when LINE reminders are enabled (dedup)', async () => {
  const { toGoogleEvent } = await load({ ENABLE_REMINDERS: true });
  const body = toGoogleEvent({
    id: '12345678-1234-1234-1234-123456789abc',
    title: '開會',
    start_at: '2026-07-20T07:00:00Z',
    all_day: false,
    timezone: 'Asia/Taipei',
  });
  expect(body.reminders).toEqual({ useDefault: false, overrides: [] });
});

test('keeps Google default reminders when LINE reminders are disabled', async () => {
  const { toGoogleEvent } = await load({ ENABLE_REMINDERS: false });
  const body = toGoogleEvent({
    id: '12345678-1234-1234-1234-123456789abc',
    title: '開會',
    start_at: '2026-07-20T07:00:00Z',
    all_day: false,
    timezone: 'Asia/Taipei',
  });
  expect(body.reminders).toBeUndefined();
});

test('Google 409 is treated as an idempotent successful insert', async () => {
  const { insertGoogleEvent } = await load();
  oauth.request.mockRejectedValue(Object.assign(new Error('duplicate'), { response: { status: 409 } }));
  const id = await insertGoogleEvent('u1', {
    id: '12345678-1234-1234-1234-123456789abc',
    title: '開會',
    start_at: '2026-07-20T07:00:00Z',
    all_day: false,
    timezone: 'Asia/Taipei',
  });
  expect(id).toBe('gpta12345678123412341234123456789abc');
});

test('sync worker marks a local event with the Google event id', async () => {
  const { syncGoogleCalendarEvent } = await load();
  const event = {
    id: '12345678-1234-1234-1234-123456789abc',
    version: 1,
    owner_id: 'u1',
    title: '開會',
    start_at: '2026-07-20T07:00:00Z',
    all_day: false,
    timezone: 'Asia/Taipei',
    status: 'confirmed',
    provider_event_id: null,
  };
  getEvent.mockResolvedValue(event);
  oauth.request.mockResolvedValue({ data: { id: 'google-id' } });
  const synced = { ...event, provider_event_id: 'google-id', sync_status: 'synced' };
  markEventSynced.mockResolvedValue(synced);
  await expect(syncGoogleCalendarEvent({ ownerId: 'u1', eventId: event.id }))
    .resolves.toEqual(synced);
  expect(markEventSynced).toHaveBeenCalledWith('u1', event.id, 'google-id', expect.any(Function));
  expect(markEventSyncError).not.toHaveBeenCalled();
});

test('sync worker patches an existing Google event after a local edit', async () => {
  const { syncGoogleCalendarEvent } = await load();
  const event = {
    id: '12345678-1234-1234-1234-123456789abc',
    version: 2,
    owner_id: 'u1',
    title: '改到下午的會議',
    start_at: '2026-07-20T08:00:00Z',
    all_day: false,
    timezone: 'Asia/Taipei',
    status: 'confirmed',
    provider_event_id: 'google-id',
    sync_status: 'pending',
  };
  getEvent.mockResolvedValue(event);
  oauth.request.mockResolvedValue({ data: { id: 'google-id' } });
  markEventSynced.mockResolvedValue({ ...event, sync_status: 'synced' });
  await syncGoogleCalendarEvent({ ownerId: 'u1', eventId: event.id });
  expect(oauth.request).toHaveBeenCalledWith(expect.objectContaining({
    method: 'PATCH',
    url: expect.stringContaining('/events/google-id'),
    data: expect.objectContaining({ summary: '改到下午的會議' }),
  }));
  expect(markEventSynced).toHaveBeenCalledWith('u1', event.id, 'google-id', expect.any(Function));
});

test('backfill enqueues each unsynced event with a versioned idempotency key', async () => {
  const { enqueuePendingGoogleEvents } = await load();
  listUnsyncedEvents.mockResolvedValue([{ id: 'e1', version: 2 }]);
  await expect(enqueuePendingGoogleEvents('u1')).resolves.toBe(1);
  expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'google-calendar-sync',
    payload: { ownerId: 'u1', eventId: 'e1' },
    idempotencyKey: 'google-calendar-sync:e1:2',
  }));
});

test('completing a Google event is idempotent and preserves private metadata', async () => {
  const { completeGoogleEvent } = await load();
  oauth.request
    .mockResolvedValueOnce({
      data: {
        summary: '看診',
        extendedProperties: { private: { localEventId: 'e1' } },
      },
    })
    .mockResolvedValueOnce({ data: {} });
  await expect(completeGoogleEvent('u1', 'google-1')).resolves.toBe(true);
  expect(oauth.request.mock.calls[1][0]).toMatchObject({
    method: 'PATCH',
    data: {
      summary: '[完成] 看診',
      extendedProperties: {
        private: { localEventId: 'e1', assistantStatus: 'completed' },
      },
    },
  });
});

test('Google event lists hide events already marked complete by the assistant', async () => {
  const { listGoogleEvents } = await load();
  oauth.request.mockResolvedValue({
    data: {
      items: [
        {
          id: 'done',
          summary: '已完成',
          start: { date: '2026-07-20' },
          extendedProperties: { private: { assistantStatus: 'completed' } },
        },
        { id: 'open', summary: '待辦', start: { date: '2026-07-21' } },
      ],
    },
  });
  await expect(listGoogleEvents('u1')).resolves.toEqual([expect.objectContaining({ id: 'open' })]);
});
