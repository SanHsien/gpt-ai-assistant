import dotenv from 'dotenv';

const { env } = process;

dotenv.config({
  path: env.NODE_ENV ? `.env.${env.NODE_ENV}` : '.env',
});

const imageGenerationModel = env.OPENAI_IMAGE_GENERATION_MODEL || 'gpt-image-2';

const config = Object.freeze({
  APP_ENV: env.NODE_ENV || 'production',
  APP_DEBUG: env.APP_DEBUG === 'true' || false,
  APP_URL: env.APP_URL || null,
  APP_PORT: env.APP_PORT || null,
  APP_LANG: env.APP_LANG || 'zh_TW',
  APP_WEBHOOK_PATH: env.APP_WEBHOOK_PATH || '/webhook',
  APP_API_TIMEOUT: env.APP_API_TIMEOUT || 9000,
  APP_MAX_GROUPS: Number(env.APP_MAX_GROUPS) || 1000,
  APP_MAX_USERS: Number(env.APP_MAX_USERS) || 1000,
  APP_MAX_PROMPT_MESSAGES: Number(env.APP_MAX_PROMPT_MESSAGES) || 4,
  APP_MAX_PROMPT_TOKENS: Number(env.APP_MAX_PROMPT_TOKENS) || 256,
  APP_MAX_PROMPT_AGE: Number(env.APP_MAX_PROMPT_AGE) || 0,
  APP_INIT_PROMPT: env.APP_INIT_PROMPT || '',
  HUMAN_NAME: env.HUMAN_NAME || '',
  HUMAN_INIT_PROMPT: env.HUMAN_INIT_PROMPT || '',
  BOT_NAME: env.BOT_NAME || 'AI',
  BOT_INIT_PROMPT: env.BOT_INIT_PROMPT || '',
  BOT_TONE: env.BOT_TONE || '',
  BOT_DEACTIVATED: env.BOT_DEACTIVATED === 'true' || false,
  ERROR_MESSAGE_DISABLED: env.ERROR_MESSAGE_DISABLED === 'true' || false,
  ENABLE_IMAGE_GENERATION: env.ENABLE_IMAGE_GENERATION !== 'false',
  ENABLE_TRANSCRIPTION: env.ENABLE_TRANSCRIPTION !== 'false',
  ENABLE_VISION: env.ENABLE_VISION !== 'false',
  ENABLE_SEARCH: env.ENABLE_SEARCH !== 'false',
  GROUP_REPLY_REQUIRES_MENTION: env.GROUP_REPLY_REQUIRES_MENTION === 'true' || false,
  ENABLE_SCHEDULE: env.ENABLE_SCHEDULE === 'true' || false,
  SCHEDULE_DEFAULT_TIMEZONE: env.SCHEDULE_DEFAULT_TIMEZONE || 'Asia/Taipei',
  ENABLE_TASKS: env.ENABLE_TASKS === 'true' || false,
  TASK_LIST_LIMIT: Math.min(Math.max(
    Number.isFinite(Number(env.TASK_LIST_LIMIT)) ? Math.trunc(Number(env.TASK_LIST_LIMIT)) : 6,
    1,
  ), 6),
  SCHEDULE_MAX_TOKENS: Number(env.SCHEDULE_MAX_TOKENS) || 400,
  SCHEDULE_CONFIRM_TTL: Number(env.SCHEDULE_CONFIRM_TTL) || 600,
  ENABLE_REMINDERS: env.ENABLE_REMINDERS === 'true' || false,
  REMINDER_CRON_SECRET: env.REMINDER_CRON_SECRET || null,
  REMINDER_WORKER_MAX_JOBS: Number(env.REMINDER_WORKER_MAX_JOBS) || 20,
  REMINDER_WORKER_TIME_BUDGET_MS: Number(env.REMINDER_WORKER_TIME_BUDGET_MS) || 45000,
  // 提醒晚於預定時刻超過這麼多分鐘就視為過期，跳過不送（避免 worker 停機恢復後補送陳舊提醒）。
  REMINDER_STALE_MINUTES: Number(env.REMINDER_STALE_MINUTES) || 120,
  // 多重（lead）提醒：除了到點提醒，額外在「提前 N 分鐘」各排一個提醒。逗號分隔的正整數分鐘，
  // 例如 `60,1440`＝提前 1 小時與 1 天。預設空＝只有到點提醒（向後相容）。去重、排序、上限 5 個。
  REMINDER_OFFSETS: [...new Set(
    String(env.REMINDER_OFFSETS || '').split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 525600),
  )].sort((a, b) => a - b).slice(0, 5),
  ENABLE_GOOGLE_CALENDAR: env.ENABLE_GOOGLE_CALENDAR === 'true' || false,
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || null,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || null,
  GOOGLE_OAUTH_REDIRECT_URI: env.GOOGLE_OAUTH_REDIRECT_URI || null,
  GOOGLE_CALENDAR_ID: env.GOOGLE_CALENDAR_ID || 'primary',
  GOOGLE_OAUTH_STATE_TTL: Number(env.GOOGLE_OAUTH_STATE_TTL) || 600,
  GOOGLE_REQUEST_TIMEOUT_MS: Number(env.GOOGLE_REQUEST_TIMEOUT_MS) || 10000,
  // Google Calendar → 本地 inbound 同步（sync token 輪詢）。需開 ENABLE_GOOGLE_CALENDAR。
  // 節流：每個帳號至少間隔 CALENDAR_INBOUND_INTERVAL 秒才輪詢一次；每次 cron 最多挑幾個帳號。
  ENABLE_GOOGLE_CALENDAR_INBOUND: env.ENABLE_GOOGLE_CALENDAR_INBOUND === 'true' || false,
  CALENDAR_INBOUND_INTERVAL: Number(env.CALENDAR_INBOUND_INTERVAL) || 300,
  CALENDAR_INBOUND_MAX_PER_RUN: Number(env.CALENDAR_INBOUND_MAX_PER_RUN) || 20,
  // Google Tasks 單向同步。與 Calendar 共用同一 OAuth 授權（scope 累加），
  // 現有僅授權 Calendar 的使用者需重新 `連結 Google 行事曆` 以加上 tasks scope。
  ENABLE_GOOGLE_TASKS: env.ENABLE_GOOGLE_TASKS === 'true' || false,
  GOOGLE_TASKS_LIST_ID: env.GOOGLE_TASKS_LIST_ID || '@default',
  // Google Tasks → 本地 inbound 同步（updatedMin 輪詢）：完成／重開、刪除、標題、備註回收。
  // 需開 ENABLE_GOOGLE_TASKS。節流：每帳號至少間隔 TASKS_INBOUND_INTERVAL 秒；每次 cron 挑帳號上限。
  ENABLE_GOOGLE_TASKS_INBOUND: env.ENABLE_GOOGLE_TASKS_INBOUND === 'true' || false,
  TASKS_INBOUND_INTERVAL: Number(env.TASKS_INBOUND_INTERVAL) || 300,
  TASKS_INBOUND_MAX_PER_RUN: Number(env.TASKS_INBOUND_MAX_PER_RUN) || 20,
  ENABLE_WEATHER: env.ENABLE_WEATHER === 'true' || false,
  WEATHER_FORECAST_DAYS: Math.min(Math.max(Number(env.WEATHER_FORECAST_DAYS) || 5, 1), 7),
  WEATHER_CACHE_TTL: Number(env.WEATHER_CACHE_TTL) || 600,
  // 每日天氣推播（走 Push API，計 LINE 額度）。需同時開 ENABLE_WEATHER。
  ENABLE_WEATHER_PUSH: env.ENABLE_WEATHER_PUSH === 'true' || false,
  WEATHER_DAILY_DEFAULT_HOUR: Math.min(Math.max(Number(env.WEATHER_DAILY_DEFAULT_HOUR) || 7, 0), 23),
  WEATHER_DAILY_MAX_PER_RUN: Number(env.WEATHER_DAILY_MAX_PER_RUN) || 50,
  ENABLE_URL_SUMMARY: env.ENABLE_URL_SUMMARY === 'true' || false,
  URL_FETCH_TIMEOUT: Number(env.URL_FETCH_TIMEOUT) || env.APP_API_TIMEOUT || 9000,
  URL_FETCH_MAX_BYTES: Number(env.URL_FETCH_MAX_BYTES) || 1000000,
  URL_FETCH_MAX_CHARS: Number(env.URL_FETCH_MAX_CHARS) || 5000,
  DATABASE_URL: env.DATABASE_URL || null,
  DATABASE_POOL_MAX: Number(env.DATABASE_POOL_MAX) || 3,
  DATABASE_SSL_CA: env.DATABASE_SSL_CA || null,
  DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY || null,
  WORKER_MAX_JOBS: Number(env.WORKER_MAX_JOBS) || 10,
  WORKER_LEASE_SECONDS: Number(env.WORKER_LEASE_SECONDS) || 120,
  WORKER_MAX_ATTEMPTS: Number(env.WORKER_MAX_ATTEMPTS) || 3,
  VERCEL_DEPLOY_HOOK_URL: env.VERCEL_DEPLOY_HOOK_URL || null,
  BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN || null,
  OPENAI_TIMEOUT: env.OPENAI_TIMEOUT || env.APP_API_TIMEOUT,
  OPENAI_API_KEY: env.OPENAI_API_KEY || null,
  OPENAI_BASE_URL: env.OPENAI_BASE_URL || 'https://api.openai.com',
  OPENAI_COMPLETION_MODEL: env.OPENAI_COMPLETION_MODEL || 'gpt-4o-mini',
  OPENAI_COMPLETION_TEMPERATURE: Number(env.OPENAI_COMPLETION_TEMPERATURE) || 1,
  OPENAI_COMPLETION_MAX_TOKENS: Number(env.OPENAI_COMPLETION_MAX_TOKENS) || 64,
  OPENAI_COMPLETION_FREQUENCY_PENALTY: Number(env.OPENAI_COMPLETION_FREQUENCY_PENALTY) || 0,
  OPENAI_COMPLETION_PRESENCE_PENALTY: Number(env.OPENAI_COMPLETION_PRESENCE_PENALTY) || 0.6,
  OPENAI_COMPLETION_STOP_SEQUENCES: env.OPENAI_COMPLETION_STOP_SEQUENCES ? String(env.OPENAI_COMPLETION_STOP_SEQUENCES).split(',') : [' assistant:', ' user:'],
  // run trace 成本估算：每 1K token 的美元單價（依你主要 completion 模型自行填）。
  // 兩者皆設才計 cost_usd，否則只記 token 數、cost 留空。價格會變動，非永久價目表。
  OPENAI_PRICE_PER_1K_PROMPT: env.OPENAI_PRICE_PER_1K_PROMPT ? Number(env.OPENAI_PRICE_PER_1K_PROMPT) : null,
  OPENAI_PRICE_PER_1K_COMPLETION: env.OPENAI_PRICE_PER_1K_COMPLETION ? Number(env.OPENAI_PRICE_PER_1K_COMPLETION) : null,
  OPENAI_IMAGE_GENERATION_MODEL: imageGenerationModel,
  OPENAI_IMAGE_GENERATION_SIZE: env.OPENAI_IMAGE_GENERATION_SIZE || '1024x1024',
  OPENAI_IMAGE_GENERATION_QUALITY: env.OPENAI_IMAGE_GENERATION_QUALITY
    || (imageGenerationModel.startsWith('gpt-image-') ? 'low' : 'standard'),
  OPENAI_IMAGE_GENERATION_TIMEOUT: Number(env.OPENAI_IMAGE_GENERATION_TIMEOUT) || 55000,
  OPENAI_VISION_MODEL: env.OPENAI_VISION_MODEL || 'gpt-4o',
  OPENAI_TRANSCRIPTION_MODEL: env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
  LINE_TIMEOUT: env.LINE_TIMEOUT || env.APP_API_TIMEOUT,
  LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN || null,
  LINE_CHANNEL_SECRET: env.LINE_CHANNEL_SECRET || null,
  SERPAPI_TIMEOUT: env.SERPAPI_TIMEOUT || env.APP_API_TIMEOUT,
  SERPAPI_API_KEY: env.SERPAPI_API_KEY || null,
  SERPAPI_LOCATION: env.SERPAPI_LOCATION || 'tw',
});

export default config;
