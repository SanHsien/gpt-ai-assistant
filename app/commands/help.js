import config from '../../config/index.js';
import { t } from '../../locales/index.js';

export const buildCommandHelp = (features = config) => {
  const lines = [
    t('__TEXT_COMMAND_HELP_TITLE'),
    '',
    t('__TEXT_COMMAND_HELP_CHAT'),
  ];

  if (features.ENABLE_SEARCH) lines.push(t('__TEXT_COMMAND_HELP_SEARCH'));
  if (features.ENABLE_IMAGE_GENERATION) lines.push(t('__TEXT_COMMAND_HELP_DRAW'));
  if (features.ENABLE_VISION) lines.push(t('__TEXT_COMMAND_HELP_VISION'));
  if (features.ENABLE_TRANSCRIPTION) lines.push(t('__TEXT_COMMAND_HELP_VOICE'));
  if (features.ENABLE_SCHEDULE) lines.push(t('__TEXT_COMMAND_HELP_SCHEDULE'));
  if (features.ENABLE_TASKS) lines.push(t('__TEXT_COMMAND_HELP_TASKS'));
  if (features.ENABLE_REMINDERS) lines.push(t('__TEXT_COMMAND_HELP_REMINDERS'));
  if (features.ENABLE_WEATHER) lines.push(t('__TEXT_COMMAND_HELP_WEATHER'));
  if (features.ENABLE_WEATHER && features.ENABLE_WEATHER_PUSH) {
    lines.push(t('__TEXT_COMMAND_HELP_WEATHER_PUSH'));
  }
  if (features.ENABLE_GOOGLE_CALENDAR) lines.push(t('__TEXT_COMMAND_HELP_GOOGLE'));

  lines.push(
    t('__TEXT_COMMAND_HELP_TEXT'),
    t('__TEXT_COMMAND_HELP_SYSTEM'),
  );
  if (features.VERCEL_DEPLOY_HOOK_URL) lines.push(t('__TEXT_COMMAND_HELP_DEPLOY'));
  lines.push('', t('__TEXT_COMMAND_HELP_FOOTER'));

  return lines.join('\n');
};

export default buildCommandHelp;
