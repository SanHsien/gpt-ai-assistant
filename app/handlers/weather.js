import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { upsertUser } from '../../repositories/users.js';
import {
  disableWeatherSubscriptions, listWeatherSubscriptions, upsertWeatherSubscription,
} from '../../repositories/subscriptions.js';
import { isDatabaseConfigured } from '../../services/database.js';
import {
  formatWeather, getWeatherByPlace, placeLabel, resolveLocation,
} from '../../services/weather/index.js';
import { nextWeatherRun } from '../../services/weather-subscription.js';
import {
  COMMAND_BOT_WEATHER,
  COMMAND_BOT_WEATHER_COORDS,
  COMMAND_BOT_WEATHER_SUBSCRIBE,
  COMMAND_BOT_WEATHER_SUBSCRIPTIONS,
  COMMAND_BOT_WEATHER_UNSUBSCRIBE,
} from '../commands/index.js';

const DATE_PREFIX = /^(?:今天|今日|明天|明日|後天|大後天|今晚|明早|這幾天|未來(?:幾天|一週)?)\s*的?\s*/u;
const WEATHER_WORD = /(?:天氣|天気|氣象|天候)(?:預報)?/u;
const WEATHER_INTENT_LEADING = /^(?:(?:今天|今日|明天|明日|後天|大後天|今晚|明早|這幾天|未來(?:幾天|一週)?)\s*的?\s*)?(?:查|看)?\s*(?:天氣|天気|氣象|天候)(?:預報)?/u;
const WEATHER_INTENT_TRAILING = /(?:天氣|天気|氣象|天候)(?:預報)?(?:如何|怎[樣麼]|呢|嗎)?[。！？.!?]*$/u;

const isWeatherIntent = (text) => {
  const value = text.trim();
  return WEATHER_INTENT_LEADING.test(value) || WEATHER_INTENT_TRAILING.test(value);
};

const stripTrailingMarks = (text) => text.replace(/[。！？.!?]+$/u, '').trim();

const stripCommand = (text, command) => {
  const lower = text.toLowerCase();
  const prefix = [command.text, ...command.aliases]
    .find((alias) => lower.startsWith(alias.toLowerCase()));
  return (prefix ? text.slice(prefix.length) : text).trim();
};

const extractLocation = (text) => stripTrailingMarks(text)
  .replace(DATE_PREFIX, '')
  .replace(/(?:查|看)\s*/u, '')
  .replace(WEATHER_WORD, '')
  .replace(/^(?:是|在|的)\s*/u, '')
  .replace(/(?:如何|怎[樣麼]|呢|嗎)+$/u, '')
  .trim();

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const SUBSCRIPTION_COMMANDS = [
  COMMAND_BOT_WEATHER_UNSUBSCRIBE,
  COMMAND_BOT_WEATHER_SUBSCRIPTIONS,
  COMMAND_BOT_WEATHER_SUBSCRIBE,
];

const check = (context) => (
  context.hasCommand(COMMAND_BOT_WEATHER_COORDS)
  || SUBSCRIPTION_COMMANDS.some((command) => context.hasCommand(command))
  || context.hasCommand(COMMAND_BOT_WEATHER)
  || (config.ENABLE_WEATHER && isWeatherIntent(context.trimmedText))
);

const replyForecast = async (context, place) => {
  try {
    const value = await getWeatherByPlace(place);
    context.pushText(formatWeather(value));
  } catch (err) {
    context.pushText(t('__ERROR_WEATHER_UNAVAILABLE'));
    if (config.APP_DEBUG) console.error('weather failed:', err.message);
  }
  return context;
};

// 追問選項的 postback：`天氣座標 <lat> <lon> <label>`（label 可含空格，取末段全部）。
const handleCoords = async (context) => {
  const rest = stripCommand(context.trimmedText, COMMAND_BOT_WEATHER_COORDS);
  const match = rest.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(.+)$/u);
  if (!match) {
    context.pushText(t('__TEXT_WEATHER_USAGE'));
    return context;
  }
  const [, lat, lon, label] = match;
  return replyForecast(context, {
    latitude: Number(lat), longitude: Number(lon), timezone: 'auto', name: stripTrailingMarks(label),
  });
};

const coordAction = (place) => ({
  label: placeLabel(place).slice(0, 20),
  data: `${COMMAND_BOT_WEATHER_COORDS.text} ${place.latitude} ${place.longitude} ${placeLabel(place)}`,
  displayText: placeLabel(place),
});

const pad2 = (hour) => String(hour).padStart(2, '0');

// `每日天氣 台北 8` → { location: '台北', hour: 8 }；沒帶時刻用預設。
const parseSubscribeArg = (arg) => {
  const match = arg.match(/\s+(\d{1,2})\s*(?:點|時|时)?$/u);
  const hour = match ? Number(match[1]) : config.WEATHER_DAILY_DEFAULT_HOUR;
  const location = match ? arg.slice(0, match.index).trim() : arg.trim();
  return {
    location,
    hour: hour >= 0 && hour <= 23 ? hour : config.WEATHER_DAILY_DEFAULT_HOUR,
  };
};

const pushEnabledForSubscription = (context) => {
  if (config.ENABLE_WEATHER_PUSH && isDatabaseConfigured()) return true;
  context.pushText(t('__TEXT_WEATHER_SUBSCRIBE_DISABLED'));
  return false;
};

const subscribe = async (context) => {
  if (!pushEnabledForSubscription(context)) return context;
  const { location, hour } = parseSubscribeArg(
    stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_WEATHER_SUBSCRIBE)),
  );
  if (!location) {
    context.pushText(t('__TEXT_WEATHER_SUBSCRIBE_USAGE'));
    return context;
  }
  const resolved = await resolveLocation(location);
  if (!resolved) {
    context.pushText(t('__TEXT_WEATHER_NOT_FOUND'));
    return context;
  }
  if (resolved.type === 'ambiguous') {
    // 訂閱不做多層追問，請使用者用更精確地名。
    context.pushText(t('__TEXT_WEATHER_SUBSCRIBE_AMBIGUOUS'));
    return context;
  }
  const { place } = resolved;
  const owner = await upsertUser({ channelUserKey: context.userId, channelTarget: context.userId });
  const timezone = place.timezone && place.timezone !== 'auto'
    ? place.timezone
    : (owner.timezone || config.SCHEDULE_DEFAULT_TIMEZONE);
  await upsertWeatherSubscription({
    ownerId: owner.id,
    label: placeLabel(place),
    latitude: place.latitude,
    longitude: place.longitude,
    timezone,
    hour,
    nextRunAt: nextWeatherRun(new Date(), timezone, hour),
  });
  context.pushText(`${t('__TEXT_WEATHER_SUBSCRIBED')}\n${placeLabel(place)} ${pad2(hour)}:00`);
  return context;
};

const unsubscribe = async (context) => {
  if (!pushEnabledForSubscription(context)) return context;
  const owner = await upsertUser({ channelUserKey: context.userId });
  const count = await disableWeatherSubscriptions(owner.id);
  context.pushText(t(count > 0 ? '__TEXT_WEATHER_UNSUBSCRIBED' : '__TEXT_WEATHER_NO_SUBSCRIPTION'));
  return context;
};

const listSubscriptions = async (context) => {
  if (!pushEnabledForSubscription(context)) return context;
  const owner = await upsertUser({ channelUserKey: context.userId });
  const subs = await listWeatherSubscriptions(owner.id);
  if (subs.length === 0) {
    context.pushText(t('__TEXT_WEATHER_NO_SUBSCRIPTION'));
    return context;
  }
  const body = subs.map((sub) => `${sub.location_label} ${pad2(sub.hour)}:00`).join('\n');
  context.pushText(`${t('__TEXT_WEATHER_SUBSCRIPTIONS_HEADER')}\n${body}`);
  return context;
};

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    if (!config.ENABLE_WEATHER) {
      context.pushText(t('__ERROR_FEATURE_DISABLED'));
      return context;
    }
    if (context.hasCommand(COMMAND_BOT_WEATHER_COORDS)) return handleCoords(context);
    if (context.hasCommand(COMMAND_BOT_WEATHER_UNSUBSCRIBE)) return unsubscribe(context);
    if (context.hasCommand(COMMAND_BOT_WEATHER_SUBSCRIPTIONS)) return listSubscriptions(context);
    if (context.hasCommand(COMMAND_BOT_WEATHER_SUBSCRIBE)) return subscribe(context);

    const location = extractLocation(context.trimmedText);
    if (!location) {
      context.pushText(t('__TEXT_WEATHER_USAGE'));
      return context;
    }
    let resolved;
    try {
      resolved = await resolveLocation(location);
    } catch (err) {
      context.pushText(t('__ERROR_WEATHER_UNAVAILABLE'));
      if (config.APP_DEBUG) console.error('weather geocode failed:', err.message);
      return context;
    }
    if (!resolved) {
      context.pushText(t('__TEXT_WEATHER_NOT_FOUND'));
      return context;
    }
    if (resolved.type === 'ambiguous') {
      context.pushText(t('__TEXT_WEATHER_AMBIGUOUS'), resolved.candidates.map(coordAction));
      return context;
    }
    return replyForecast(context, resolved.place);
  }
)();

export default exec;
