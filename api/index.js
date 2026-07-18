import express from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { printPrompts } from '../app/index.js';
import { enqueueEvents } from '../app/webhook.js';
import config from '../config/index.js';
import { validateLineSignature } from '../middleware/index.js';
import { validateBearerSecret } from '../middleware/validate-bearer-secret.js';
import { fetchVersion, getVersion } from '../utils/index.js';
import runAfterResponse from '../utils/run-after-response.js';
import { ensureRuntimeReady } from '../services/runtime-preflight.js';
import {
  completeGoogleAuthorization,
  isGoogleCalendarConfigured,
} from '../services/google-calendar.js';
import { drainQueue, JOB_KINDS } from '../services/worker.js';
import { enqueueDueWeatherReminders } from '../services/weather-subscription.js';
import { enqueueDueCalendarInbound } from '../services/google-calendar-inbound.js';
import { enqueueDueTasksInbound } from '../services/google-tasks-inbound.js';
import { t } from '../locales/index.js';

const app = express();

const oauthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(String(req.headers['x-real-ip'] || req.ip || 'unknown')),
});

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));

const oauthPage = (title, message) => `<!doctype html>
<html lang="${t('__OAUTH_HTML_LANG')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

app.get('/oauth/google/complete', oauthRateLimit, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).send(oauthPage(
    t('__OAUTH_GOOGLE_COMPLETE_TITLE'),
    t('__OAUTH_GOOGLE_COMPLETE_MESSAGE'),
  ));
});

app.get('/oauth/google/callback', oauthRateLimit, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isGoogleCalendarConfigured()) {
    res.status(503).send(oauthPage(
      t('__OAUTH_GOOGLE_DISABLED_TITLE'),
      t('__OAUTH_GOOGLE_DISABLED_MESSAGE'),
    ));
    return;
  }
  if (req.query.error || !req.query.code || !req.query.state) {
    res.status(400).send(oauthPage(
      t('__OAUTH_GOOGLE_DENIED_TITLE'),
      t('__OAUTH_GOOGLE_DENIED_MESSAGE'),
    ));
    return;
  }
  try {
    await ensureRuntimeReady();
    await completeGoogleAuthorization({ code: req.query.code, state: req.query.state });
    res.redirect(303, '/oauth/google/complete');
    runAfterResponse(drainQueue().catch((err) => console.error('Google Calendar sync failed:', err.message)));
  } catch (err) {
    console.error('Google Calendar OAuth failed:', err.code || 'unknown');
    res.status(400).send(oauthPage(
      t('__OAUTH_GOOGLE_FAILED_TITLE'),
      t('__OAUTH_GOOGLE_FAILED_MESSAGE'),
    ));
  }
});

app.get('/', async (req, res) => {
  if (config.APP_URL) {
    res.redirect(config.APP_URL);
    return;
  }
  const currentVersion = getVersion();
  try {
    await ensureRuntimeReady();
  } catch (err) {
    console.error('Runtime preflight failed:', err.code || 'unknown');
    res.status(503).send({ status: 'NOT_READY', currentVersion });
    return;
  }
  let latestVersion = null;
  try {
    latestVersion = await fetchVersion();
  } catch (err) {
    console.error(err.message);
  }
  res.status(200).send({ status: 'OK', currentVersion, latestVersion });
});

app.post('/cron/reminders', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if ((!config.ENABLE_REMINDERS && !config.ENABLE_GOOGLE_CALENDAR
      && !config.ENABLE_WEATHER_PUSH && !config.ENABLE_GOOGLE_TASKS
      && !config.ENABLE_GOOGLE_CALENDAR_INBOUND && !config.ENABLE_GOOGLE_TASKS_INBOUND)
    || !config.REMINDER_CRON_SECRET) {
    res.status(503).send({ status: 'disabled' });
    return;
  }
  if (!validateBearerSecret(req.headers.authorization, config.REMINDER_CRON_SECRET)) {
    res.status(401).send({ status: 'unauthorized' });
    return;
  }
  try {
    await ensureRuntimeReady();
    // 每日天氣訂閱到期的先入列（重用同一 queue／drain，不另建 cron）。
    if (config.ENABLE_WEATHER_PUSH) await enqueueDueWeatherReminders();
    // Google Calendar → 本地 inbound 輪詢：挑到期帳號入列 inbound job。
    if (config.ENABLE_GOOGLE_CALENDAR_INBOUND) await enqueueDueCalendarInbound();
    // Google Tasks → 本地 inbound 輪詢：挑到期帳號入列 inbound job。
    if (config.ENABLE_GOOGLE_TASKS_INBOUND) await enqueueDueTasksInbound();
    const summary = await drainQueue({
      maxJobs: config.REMINDER_WORKER_MAX_JOBS,
      kinds: [
        JOB_KINDS.LINE_REMINDER,
        JOB_KINDS.GOOGLE_CALENDAR_SYNC,
        JOB_KINDS.GOOGLE_CALENDAR_STATUS,
        JOB_KINDS.WEATHER_DAILY,
        JOB_KINDS.GOOGLE_TASKS_SYNC,
        JOB_KINDS.GOOGLE_CALENDAR_INBOUND,
        JOB_KINDS.GOOGLE_TASKS_INBOUND,
      ],
    });
    res.status(200).send({ status: 'OK', ...summary });
  } catch (err) {
    console.error('Reminder drain failed:', err.message);
    res.status(500).send({ status: 'error' });
  }
});

app.post(config.APP_WEBHOOK_PATH, validateLineSignature, async (req, res) => {
  // 6.0 durable-only：去重與入列一律落在 DB（跨 instance 有效），先回 200 給 LINE，
  // 再於同一次調用內 drain——延遲仍是秒級，reply token 還有效，回覆維持免費 reply。
  try {
    await ensureRuntimeReady();
  } catch (err) {
    console.error('Runtime preflight failed:', err.code || 'unknown');
    res.sendStatus(503);
    return;
  }
  try {
    await enqueueEvents(req.body.events);
    res.sendStatus(200);

    runAfterResponse((async () => {
      const summary = await drainQueue();
      if (config.APP_DEBUG) console.log('drainQueue', summary);
    })().catch((err) => console.error(err.message)));
  } catch (err) {
    console.error(err.message);
    res.sendStatus(500);
    return;
  }

  if (config.APP_DEBUG) printPrompts();
});

if (config.APP_PORT) {
  app.listen(config.APP_PORT);
}

export default app;
