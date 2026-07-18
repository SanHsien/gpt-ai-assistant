import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let query;

const BASE_CONFIG = {
  DATABASE_URL: 'postgres://db',
  DATA_ENCRYPTION_KEY: 'base64-key',
  LINE_CHANNEL_SECRET: 'line-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  OPENAI_API_KEY: 'openai-key',
  ENABLE_SEARCH: false,
  ENABLE_GOOGLE_CALENDAR: false,
  ENABLE_GOOGLE_TASKS: false,
  ENABLE_GOOGLE_CALENDAR_INBOUND: false,
  ENABLE_GOOGLE_TASKS_INBOUND: false,
  ENABLE_REMINDERS: false,
  ENABLE_WEATHER_PUSH: false,
};

const load = async (config = BASE_CONFIG) => {
  jest.resetModules();
  query = jest.fn().mockResolvedValue({ rows: [{ name: '0018_durable_sources.sql' }] });
  jest.doMock('../../config/index.js', () => ({ __esModule: true, default: config }));
  jest.doMock('../../services/database.js', () => ({ query }));
  return import('../../services/runtime-preflight.js');
};

afterEach(() => {
  jest.dontMock('../../config/index.js');
  jest.dontMock('../../services/database.js');
  jest.resetModules();
});

test('requires durable runtime credentials and the search key when search is enabled', async () => {
  const preflight = await load({ ...BASE_CONFIG, DATABASE_URL: null, ENABLE_SEARCH: true });
  expect(() => preflight.assertRuntimeConfig()).toThrow(/DATABASE_URL.*SERPAPI_API_KEY/);
});

test('requires Google and cron credentials only when those capabilities are enabled', async () => {
  const preflight = await load({
    ...BASE_CONFIG,
    ENABLE_GOOGLE_TASKS: true,
    ENABLE_REMINDERS: true,
  });
  expect(() => preflight.assertRuntimeConfig()).toThrow(
    /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*GOOGLE_OAUTH_REDIRECT_URI.*REMINDER_CRON_SECRET/,
  );
});

test('requires the latest migration before accepting traffic', async () => {
  const preflight = await load();
  query.mockResolvedValueOnce({ rows: [] });
  await expect(preflight.ensureRuntimeReady()).rejects.toThrow('0018_durable_sources.sql');
});

test('passes once runtime configuration and the latest migration are present', async () => {
  const preflight = await load();
  await expect(preflight.ensureRuntimeReady()).resolves.toEqual(expect.objectContaining({
    latestMigration: '0018_durable_sources.sql',
  }));
  expect(query).toHaveBeenCalledWith(
    expect.stringMatching(/schema_migrations/i),
    ['0018_durable_sources.sql'],
  );
});
