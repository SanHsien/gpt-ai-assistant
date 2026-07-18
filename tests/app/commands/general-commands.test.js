import { expect, test } from '@jest/globals';
import {
  buildGeneralCommands,
  COMMAND_BOT_DRAW,
  COMMAND_BOT_FORGET,
  COMMAND_BOT_GOOGLE_CALENDAR,
  COMMAND_BOT_REMINDERS_PAUSE,
  COMMAND_BOT_REMINDERS_RESUME,
  COMMAND_BOT_SCHEDULE,
  COMMAND_BOT_SCHEDULE_LIST,
  COMMAND_BOT_SEARCH,
  COMMAND_BOT_TASK,
  COMMAND_BOT_TASK_LIST,
  COMMAND_BOT_WEATHER,
  COMMAND_BOT_WEATHER_SUBSCRIBE,
  COMMAND_SYS_COMMAND,
} from '../../../app/commands/index.js';

const allFeatures = {
  ENABLE_SCHEDULE: true,
  ENABLE_TASKS: true,
  ENABLE_WEATHER: true,
  ENABLE_WEATHER_PUSH: true,
  ENABLE_SEARCH: true,
  ENABLE_IMAGE_GENERATION: true,
  ENABLE_GOOGLE_CALENDAR: true,
  ENABLE_REMINDERS: true,
};

test('builds 13 discoverable quick replies in task-first order', () => {
  expect(buildGeneralCommands(allFeatures)).toEqual([
    COMMAND_BOT_SCHEDULE,
    COMMAND_BOT_SCHEDULE_LIST,
    COMMAND_BOT_TASK,
    COMMAND_BOT_TASK_LIST,
    COMMAND_BOT_WEATHER,
    COMMAND_BOT_WEATHER_SUBSCRIBE,
    COMMAND_BOT_SEARCH,
    COMMAND_BOT_DRAW,
    COMMAND_BOT_GOOGLE_CALENDAR,
    COMMAND_BOT_REMINDERS_PAUSE,
    COMMAND_BOT_REMINDERS_RESUME,
    COMMAND_BOT_FORGET,
    COMMAND_SYS_COMMAND,
  ]);
  expect(buildGeneralCommands(allFeatures)).toHaveLength(13);
});

test('hides quick replies for disabled capabilities', () => {
  expect(buildGeneralCommands({
    ...allFeatures,
    ENABLE_SCHEDULE: false,
    ENABLE_TASKS: false,
    ENABLE_WEATHER: false,
    ENABLE_WEATHER_PUSH: false,
    ENABLE_GOOGLE_CALENDAR: false,
    ENABLE_REMINDERS: false,
  })).toEqual([
    COMMAND_BOT_SEARCH,
    COMMAND_BOT_DRAW,
    COMMAND_BOT_FORGET,
    COMMAND_SYS_COMMAND,
  ]);
});

test('keeps privacy and help entries when optional capabilities are disabled', () => {
  const commands = buildGeneralCommands({
    ENABLE_SCHEDULE: false,
    ENABLE_TASKS: false,
    ENABLE_WEATHER: false,
    ENABLE_WEATHER_PUSH: false,
    ENABLE_SEARCH: false,
    ENABLE_IMAGE_GENERATION: false,
    ENABLE_GOOGLE_CALENDAR: false,
    ENABLE_REMINDERS: false,
  });

  expect(commands).toEqual([COMMAND_BOT_FORGET, COMMAND_SYS_COMMAND]);
  expect(commands).toHaveLength(2);
  expect(new Set(commands.map(({ text }) => text)).size).toBe(commands.length);
  expect(commands.length).toBeLessThanOrEqual(13);
});
