import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { clearQuietHours, upsertUser } from '../../repositories/users.js';
import { isDatabaseConfigured } from '../../services/database.js';
import {
  COMMAND_BOT_QUIET_HOURS,
  COMMAND_BOT_REMINDERS_PAUSE,
  COMMAND_BOT_REMINDERS_RESUME,
} from '../commands/index.js';

const REMINDER_COMMANDS = [
  COMMAND_BOT_QUIET_HOURS,
  COMMAND_BOT_REMINDERS_PAUSE,
  COMMAND_BOT_REMINDERS_RESUME,
];

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => REMINDER_COMMANDS.some((command) => context.hasCommand(command));

const stripCommand = (text, command) => {
  const lower = text.toLowerCase();
  const prefix = [command.text, ...command.aliases]
    .find((alias) => lower.startsWith(alias.toLowerCase()));
  return (prefix ? text.slice(prefix.length) : text).trim();
};

const stripTrailingMarks = (text) => text.replace(/[。！？.!?]+$/u, '').trim();

const OFF_WORDS = new Set(['關閉', '关闭', '取消', 'off', '停用']);

// `22-8`／`22~8`／`22到8` → { start: 22, end: 8 }。整點小時、跨午夜允許。
const parseQuietHours = (text) => {
  const match = text.match(/^(\d{1,2})\s*[-~到至]\s*(\d{1,2})$/u);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 0 || start > 23 || end < 0 || end > 23 || start === end) return null;
  return { start, end };
};

const pad = (hour) => String(hour).padStart(2, '0');

const setQuietHours = async (context) => {
  const arg = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_QUIET_HOURS));
  if (!arg) {
    context.pushText(t('__TEXT_QUIET_HOURS_USAGE'));
    return context;
  }
  if (OFF_WORDS.has(arg.toLowerCase())) {
    await clearQuietHours(context.userId);
    context.pushText(t('__TEXT_QUIET_HOURS_CLEARED'));
    return context;
  }
  const quietHours = parseQuietHours(arg);
  if (!quietHours) {
    context.pushText(t('__TEXT_QUIET_HOURS_USAGE'));
    return context;
  }
  await upsertUser({ channelUserKey: context.userId, quietHours });
  context.pushText(`${t('__TEXT_QUIET_HOURS_SET')} ${pad(quietHours.start)}:00–${pad(quietHours.end)}:00`);
  return context;
};

const setPaused = async (context, paused) => {
  await upsertUser({ channelUserKey: context.userId, remindersPaused: paused });
  context.pushText(t(paused ? '__TEXT_REMINDERS_PAUSED' : '__TEXT_REMINDERS_RESUMED'));
  return context;
};

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    if (!config.ENABLE_REMINDERS || !isDatabaseConfigured()) {
      context.pushText(t('__ERROR_FEATURE_DISABLED'));
      return context;
    }
    try {
      if (context.hasCommand(COMMAND_BOT_REMINDERS_PAUSE)) return await setPaused(context, true);
      if (context.hasCommand(COMMAND_BOT_REMINDERS_RESUME)) return await setPaused(context, false);
      return await setQuietHours(context);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
