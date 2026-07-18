import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import config from '../config/index.js';
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
  googleAuthorizationScopes,
} from '../contracts/google-provider.js';
import { JOB_KINDS } from '../constants/jobs.js';
import {
  consumeOAuthState,
  createOAuthState,
  deleteCalendarAccount,
  getCalendarAccount,
  saveCalendarAccount,
} from '../repositories/calendar-accounts.js';
import {
  getEvent,
  listUnsyncedEvents,
  markEventSynced,
  markEventSyncError,
} from '../repositories/events.js';
import { enqueueJob } from '../repositories/jobs.js';
import { withTransaction } from './database.js';
import { enqueuePendingGoogleTasks } from './google-tasks-queue.js';

export { GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE };
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// OAuth 憑證是否備妥（不含 ENABLE_* 旗標）。Tasks 可獨立於 Calendar 啟用，只要 OAuth 有配置。
export const isGoogleOAuthConfigured = () => Boolean(
  config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_OAUTH_REDIRECT_URI,
);

export const isGoogleCalendarConfigured = () => Boolean(
  config.ENABLE_GOOGLE_CALENDAR && isGoogleOAuthConfigured(),
);

// 授權時要求的 scope：Calendar 一律要，Tasks 依旗標累加。
export const authorizationScopes = () => googleAuthorizationScopes({
  tasksEnabled: config.ENABLE_GOOGLE_TASKS,
});

const requireConfiguration = () => {
  if (!isGoogleCalendarConfigured()) {
    throw Object.assign(new Error('Google Calendar is not configured'), { code: 'not_configured' });
  }
};

const makeOAuthClient = () => new OAuth2Client(
  config.GOOGLE_CLIENT_ID,
  config.GOOGLE_CLIENT_SECRET,
  config.GOOGLE_OAUTH_REDIRECT_URI,
);

/**
 * @param {string} ownerId
 * @returns {Promise<string>}
 */
export const createGoogleAuthorizationUrl = async (ownerId) => {
  requireConfiguration();
  const auth = makeOAuthClient();
  const { codeVerifier, codeChallenge } = await auth.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString('base64url');
  await createOAuthState({
    ownerId,
    state,
    codeVerifier,
    expiresAt: new Date(Date.now() + config.GOOGLE_OAUTH_STATE_TTL * 1000),
  });
  const authorizationUrl = new URL(auth.generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent select_account',
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    scope: authorizationScopes(),
    state,
  }));
  // LINE URI action 預設使用 in-app browser；Google OAuth 禁止 embedded user-agent。
  authorizationUrl.searchParams.set('openExternalBrowser', '1');
  return authorizationUrl.toString();
};

export async function enqueuePendingGoogleEvents(ownerId) {
  const events = await listUnsyncedEvents(ownerId);
  await Promise.all(events.map((event) => enqueueJob({
    kind: JOB_KINDS.GOOGLE_CALENDAR_SYNC,
    payload: { ownerId, eventId: event.id },
    idempotencyKey: `google-calendar-sync:${event.id}:${event.version}`,
    maxAttempts: config.WORKER_MAX_ATTEMPTS,
  })));
  return events.length;
}

/**
 * @param {{ state: string, code: string }} params
 * @returns {Promise<{ ownerId: string, backfillCount: number, taskBackfillCount: number }>}
 */
export const completeGoogleAuthorization = async ({ state, code }) => {
  requireConfiguration();
  if (!state || !code) throw Object.assign(new Error('Missing OAuth callback parameters'), { code: 'invalid_callback' });
  const consumed = await consumeOAuthState(state);
  if (!consumed) throw Object.assign(new Error('OAuth state is invalid or expired'), { code: 'invalid_state' });

  const ownerId = consumed.owner_id;
  const previous = await getCalendarAccount(ownerId);
  const { tokens } = await makeOAuthClient().getToken({
    code,
    codeVerifier: consumed.code_verifier,
    redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
  });
  const credentials = {
    ...tokens,
    refresh_token: tokens.refresh_token || previous?.credentials?.refresh_token,
  };
  if (!credentials.refresh_token) {
    throw Object.assign(new Error('Google did not return a refresh token'), { code: 'missing_refresh_token' });
  }
  const scopes = String(tokens.scope || authorizationScopes().join(' ')).split(/\s+/).filter(Boolean);
  await saveCalendarAccount({
    ownerId,
    credentials,
    scopes,
    calendarId: config.GOOGLE_CALENDAR_ID,
  });
  const backfillCount = await enqueuePendingGoogleEvents(ownerId);
  let taskBackfillCount = 0;
  const grantedScopes = new Set(scopes);
  if (config.ENABLE_GOOGLE_TASKS && grantedScopes.has(GOOGLE_TASKS_SCOPE)) {
    taskBackfillCount = await enqueuePendingGoogleTasks(ownerId);
  }
  return { ownerId, backfillCount, taskBackfillCount };
};

export const authorizedRequest = async (ownerId, request) => {
  if (!isGoogleOAuthConfigured()) {
    throw Object.assign(new Error('Google OAuth is not configured'), { code: 'not_configured' });
  }
  const account = await getCalendarAccount(ownerId);
  if (!account) throw Object.assign(new Error('Google account is not connected'), { code: 'not_connected' });
  const auth = makeOAuthClient();
  auth.setCredentials(account.credentials);
  await auth.getAccessToken();
  const response = await auth.request(request);
  if (JSON.stringify(auth.credentials) !== JSON.stringify(account.credentials)) {
    await saveCalendarAccount({
      ownerId,
      credentials: auth.credentials,
      scopes: account.scopes,
      calendarId: account.calendar_id,
    });
  }
  return { account, response };
};

const dateInTimezone = (value, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const nextDate = (date) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

const recurrenceRule = (recurrence) => {
  if (!recurrence) return undefined;
  const values = [`FREQ=${recurrence.freq}`];
  if (recurrence.interval) values.push(`INTERVAL=${recurrence.interval}`);
  if (recurrence.count) values.push(`COUNT=${recurrence.count}`);
  if (recurrence.until) values.push(`UNTIL=${new Date(recurrence.until).toISOString().replace(/[-:]/g, '').replace('.000', '')}`);
  return [`RRULE:${values.join(';')}`];
};

export const toGoogleEvent = (event) => {
  const timezone = event.timezone || config.SCHEDULE_DEFAULT_TIMEZONE;
  const startDate = dateInTimezone(event.start_at, timezone);
  const requestedEndDate = event.end_at ? dateInTimezone(event.end_at, timezone) : null;
  const allDayEndDate = requestedEndDate && requestedEndDate > startDate
    ? requestedEndDate
    : nextDate(startDate);
  const start = event.all_day
    ? { date: startDate }
    : { dateTime: new Date(event.start_at).toISOString(), timeZone: timezone };
  const end = event.all_day
    ? { date: allDayEndDate }
    : {
      dateTime: new Date(event.end_at || new Date(event.start_at).getTime() + 60 * 60 * 1000).toISOString(),
      timeZone: timezone,
    };
  return {
    id: `gpta${event.id.replaceAll('-', '')}`,
    summary: event.title,
    start,
    end,
    ...(event.location ? { location: event.location } : {}),
    ...(event.notes ? { description: event.notes } : {}),
    ...(event.recurrence ? { recurrence: recurrenceRule(event.recurrence) } : {}),
    // delivery 去重：本地 LINE 提醒開啟時，關掉 Google 自身的預設通知，避免同一行程雙重提醒；
    // 未開 LINE 提醒則沿用 Google 預設通知（不主動移除使用者原本的行事曆提醒）。
    ...(config.ENABLE_REMINDERS ? { reminders: { useDefault: false, overrides: [] } } : {}),
    extendedProperties: { private: { localEventId: event.id } },
  };
};

export const insertGoogleEvent = async (ownerId, event) => {
  const body = toGoogleEvent(event);
  try {
    const { account, response } = await authorizedRequest(ownerId, {
      method: 'POST',
      url: `${CALENDAR_API}/calendars/${encodeURIComponent(config.GOOGLE_CALENDAR_ID)}/events`,
      params: { sendUpdates: 'none' },
      data: body,
    });
    return response.data?.id || body.id || account.calendar_id;
  } catch (err) {
    // client-specified event id 讓重試具冪等性；409 代表前一次其實已成功。
    if (err.response?.status === 409) return body.id;
    throw err;
  }
};

export const updateGoogleEvent = async (ownerId, event) => {
  const { id: ignoredId, ...body } = toGoogleEvent(event);
  const { response } = await authorizedRequest(ownerId, {
    method: 'PATCH',
    url: `${CALENDAR_API}/calendars/${encodeURIComponent(config.GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(event.provider_event_id)}`,
    params: { sendUpdates: 'none' },
    data: body,
  });
  return response.data?.id || event.provider_event_id;
};

export const listGoogleEvents = async (ownerId, { timeMin, maxResults = 10 } = {}) => {
  const { response } = await authorizedRequest(ownerId, {
    method: 'GET',
    url: `${CALENDAR_API}/calendars/${encodeURIComponent(config.GOOGLE_CALENDAR_ID)}/events`,
    params: {
      maxResults: Math.min(maxResults * 2, 50),
      orderBy: 'startTime',
      singleEvents: true,
      timeMin: timeMin || new Date().toISOString(),
    },
  });
  return (response.data?.items || [])
    .filter((event) => event.extendedProperties?.private?.assistantStatus !== 'completed')
    .map((event) => ({
      id: event.id,
      title: event.summary || '(無標題)',
      start_at: event.start?.dateTime || event.start?.date,
      end_at: event.start?.date ? null : event.end?.dateTime,
      all_day: Boolean(event.start?.date),
      location: event.location || null,
    }))
    .slice(0, maxResults);
};

export const completeGoogleEvent = async (ownerId, eventId) => {
  try {
    const { response } = await authorizedRequest(ownerId, {
      method: 'GET',
      url: `${CALENDAR_API}/calendars/${encodeURIComponent(config.GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
    });
    const event = response.data || {};
    if (event.extendedProperties?.private?.assistantStatus === 'completed') return true;
    const summary = event.summary || '(無標題)';
    await authorizedRequest(ownerId, {
      method: 'PATCH',
      url: `${CALENDAR_API}/calendars/${encodeURIComponent(config.GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
      params: { sendUpdates: 'none' },
      data: {
        summary: summary.startsWith('[完成] ') ? summary : `[完成] ${summary}`,
        extendedProperties: {
          ...event.extendedProperties,
          private: {
            ...event.extendedProperties?.private,
            assistantStatus: 'completed',
          },
        },
      },
    });
    return true;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 410) return false;
    throw err;
  }
};

export const deleteGoogleEvent = async (ownerId, eventId) => {
  try {
    await authorizedRequest(ownerId, {
      method: 'DELETE',
      url: `${CALENDAR_API}/calendars/${encodeURIComponent(config.GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
      params: { sendUpdates: 'none' },
    });
    return true;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 410) return false;
    throw err;
  }
};

export const syncGoogleCalendarEvent = async ({ ownerId, eventId }) => {
  let event;
  try {
    return await withTransaction(async (client) => {
      const executor = client.query.bind(client);
      event = await getEvent(ownerId, eventId, executor, true);
      if (!event || event.status !== 'confirmed') return null;
      if (event.provider_event_id && event.sync_status === 'synced') return event;
      const providerEventId = event.provider_event_id
        ? await updateGoogleEvent(ownerId, event)
        : await insertGoogleEvent(ownerId, event);
      return markEventSynced(ownerId, event.id, providerEventId, executor);
    });
  } catch (err) {
    const status = err.response?.status;
    const code = err.code || (status ? `google_${status}` : 'google_unavailable');
    if (event) await markEventSyncError(ownerId, event.id, code);
    if (status && status < 500 && status !== 429) err.retryable = false;
    if (code === 'not_connected' || code === 'not_configured') err.retryable = false;
    throw err;
  }
};

/**
 * 解除 Google 帳號連結：向 Google 撤銷 token，並刪除本地保存的 token envelope。
 * 撤銷失敗（token 可能已過期／已撤銷）不阻擋本地刪除——使用者要求解除就一定移除本地憑證。
 * @param {string} ownerId
 * @returns {Promise<boolean>} 原本是否有連結（false = 本來就沒連結）
 */
export const unlinkGoogleCalendar = async (ownerId) => {
  const account = await getCalendarAccount(ownerId);
  if (!account) return false;
  try {
    const auth = makeOAuthClient();
    auth.setCredentials(account.credentials);
    await auth.revokeCredentials();
  } catch (err) {
    console.error('Google token revocation failed:', err.code || err.response?.status || 'unknown');
  }
  await deleteCalendarAccount(ownerId);
  return true;
};

export default {
  completeGoogleAuthorization,
  completeGoogleEvent,
  createGoogleAuthorizationUrl,
  deleteGoogleEvent,
  enqueuePendingGoogleEvents,
  insertGoogleEvent,
  isGoogleCalendarConfigured,
  listGoogleEvents,
  syncGoogleCalendarEvent,
  toGoogleEvent,
  unlinkGoogleCalendar,
  updateGoogleEvent,
};
