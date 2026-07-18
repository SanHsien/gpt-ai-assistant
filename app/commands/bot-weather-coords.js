import { TYPE_SYSTEM } from '../../constants/command.js';
import { t } from '../../locales/index.js';
import Command from './command.js';

// 內部指令：天氣追問選項的 postback 用（`天氣座標 <lat> <lon> <label>`）。
export default new Command({
  type: TYPE_SYSTEM,
  label: t('__COMMAND_BOT_WEATHER_COORDS_LABEL'),
  text: t('__COMMAND_BOT_WEATHER_COORDS_TEXT'),
  aliases: [],
});
