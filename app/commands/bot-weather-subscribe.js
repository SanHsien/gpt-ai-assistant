import { TYPE_SYSTEM } from '../../constants/command.js';
import { t } from '../../locales/index.js';
import Command from './command.js';

export default new Command({
  type: TYPE_SYSTEM,
  label: t('__COMMAND_BOT_WEATHER_SUBSCRIBE_LABEL'),
  text: t('__COMMAND_BOT_WEATHER_SUBSCRIBE_TEXT'),
  aliases: [
    ...t('__COMMAND_BOT_WEATHER_SUBSCRIBE_ALIASES'),
    '/subscribeweather',
  ],
});
