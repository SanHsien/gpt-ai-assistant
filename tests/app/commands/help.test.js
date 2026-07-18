import { expect, test } from '@jest/globals';
import { buildCommandHelp } from '../../../app/commands/help.js';

const allFeatures = {
  ENABLE_SEARCH: true,
  ENABLE_IMAGE_GENERATION: true,
  ENABLE_VISION: true,
  ENABLE_TRANSCRIPTION: true,
  ENABLE_SCHEDULE: true,
  ENABLE_TASKS: true,
  ENABLE_REMINDERS: true,
  ENABLE_WEATHER: true,
  ENABLE_WEATHER_PUSH: true,
  ENABLE_GOOGLE_CALENDAR: true,
  VERCEL_DEPLOY_HOOK_URL: 'https://example.invalid/deploy',
};

test('builds a grouped complete help message for enabled features', () => {
  const help = buildCommandHelp(allFeatures);

  [
    '【對話】',
    '【搜尋】',
    '【生圖】',
    '【看圖】',
    '【語音】',
    '【行程】',
    '【任務】',
    '【提醒】',
    '【天氣】',
    '【每日天氣】',
    '【Google】',
    '【文字處理】',
    '【系統】',
    '【維護】',
  ].forEach((heading) => expect(help).toContain(heading));
  expect(help).toContain('範例：天氣 台北');
  expect(help.length).toBeLessThanOrEqual(5000);
});

test('omits disabled optional features while preserving core help', () => {
  const help = buildCommandHelp({
    ...allFeatures,
    ENABLE_SEARCH: false,
    ENABLE_IMAGE_GENERATION: false,
    ENABLE_VISION: false,
    ENABLE_TRANSCRIPTION: false,
    ENABLE_SCHEDULE: false,
    ENABLE_TASKS: false,
    ENABLE_REMINDERS: false,
    ENABLE_WEATHER: false,
    ENABLE_WEATHER_PUSH: false,
    ENABLE_GOOGLE_CALENDAR: false,
    VERCEL_DEPLOY_HOOK_URL: null,
  });

  expect(help).toContain('【對話】');
  expect(help).toContain('【文字處理】');
  expect(help).toContain('【系統】');
  expect(help).not.toContain('【行程】');
  expect(help).not.toContain('【每日天氣】');
  expect(help).not.toContain('【維護】');
});
