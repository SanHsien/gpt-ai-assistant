import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let resolveLocation;
let getWeatherByPlace;
let formatWeather;
let placeLabel;
let upsertUser;
let isDatabaseConfigured;
let upsertWeatherSubscription;
let listWeatherSubscriptions;
let disableWeatherSubscriptions;
let nextWeatherRun;

const PLACE = {
  name: '臺北市', admin1: '臺北市', country: '臺灣', latitude: 25.04, longitude: 121.56, timezone: 'Asia/Taipei',
};

const load = async ({ enabled = true, pushEnabled = true } = {}) => {
  jest.resetModules();
  process.env.ENABLE_WEATHER = enabled ? 'true' : 'false';
  resolveLocation = jest.fn().mockResolvedValue({ type: 'single', place: PLACE });
  getWeatherByPlace = jest.fn().mockResolvedValue({ place: PLACE, forecast: {} });
  formatWeather = jest.fn().mockReturnValue('臺北市 天氣\n現在：晴 30°C');
  placeLabel = jest.fn((place) => [place.name, place.admin1, place.country]
    .filter((part, i, arr) => part && arr.indexOf(part) === i).join('、'));
  upsertUser = jest.fn().mockResolvedValue({ id: 'o1', timezone: null });
  isDatabaseConfigured = jest.fn().mockReturnValue(true);
  upsertWeatherSubscription = jest.fn().mockResolvedValue({ id: 's1' });
  listWeatherSubscriptions = jest.fn().mockResolvedValue([]);
  disableWeatherSubscriptions = jest.fn().mockResolvedValue(1);
  nextWeatherRun = jest.fn().mockReturnValue(new Date('2026-07-18T00:00:00.000Z'));
  process.env.ENABLE_WEATHER_PUSH = pushEnabled ? 'true' : 'false';
  jest.doMock('../../../services/weather/index.js', () => ({
    resolveLocation, getWeatherByPlace, formatWeather, placeLabel,
  }));
  jest.doMock('../../../repositories/users.js', () => ({ upsertUser }));
  jest.doMock('../../../repositories/subscriptions.js', () => ({
    upsertWeatherSubscription, listWeatherSubscriptions, disableWeatherSubscriptions,
  }));
  jest.doMock('../../../services/database.js', () => ({ isDatabaseConfigured }));
  jest.doMock('../../../services/weather-subscription.js', () => ({ nextWeatherRun }));
  const { default: weatherHandler } = await import('../../../app/handlers/weather.js');
  return weatherHandler;
};

const makeContext = (text) => ({
  trimmedText: text,
  messages: [],
  hasCommand({ text: commandText, aliases }) {
    const content = text.toLowerCase();
    return [commandText, ...aliases].some((alias) => content.startsWith(alias.toLowerCase()));
  },
  pushText(value, actions = []) { this.messages.push({ type: 'text', text: value, actions }); return this; },
});

afterEach(() => {
  delete process.env.ENABLE_WEATHER;
  delete process.env.ENABLE_WEATHER_PUSH;
  ['../../../services/weather/index.js', '../../../repositories/users.js',
    '../../../repositories/subscriptions.js', '../../../services/database.js',
    '../../../services/weather-subscription.js'].forEach((mod) => jest.dontMock(mod));
  jest.resetModules();
});

test('ignores non-weather messages', async () => {
  const handler = await load();
  expect(handler(makeContext('今天心情不錯'))).toBe(false);
});

test('refuses when the feature is disabled', async () => {
  const handler = await load({ enabled: false });
  const context = await handler(makeContext('天氣 台北'));
  expect(context.messages[0].text).toBe('此功能目前已停用');
  expect(resolveLocation).not.toHaveBeenCalled();
});

test('asks for a location when none is given', async () => {
  const handler = await load();
  const context = await handler(makeContext('天氣'));
  expect(context.messages[0].text).toContain('請告訴我地點');
  expect(resolveLocation).not.toHaveBeenCalled();
});

test('replies with formatted weather for a single resolved place', async () => {
  const handler = await load();
  const context = await handler(makeContext('天氣 台北。'));
  expect(resolveLocation).toHaveBeenCalledWith('台北');
  expect(getWeatherByPlace).toHaveBeenCalledWith(PLACE);
  expect(context.messages[0].text).toContain('現在');
});

test('reports when the location is not found', async () => {
  const handler = await load();
  resolveLocation.mockResolvedValue(null);
  const context = await handler(makeContext('天氣 火星'));
  expect(context.messages[0].text).toContain('找不到這個地點');
});

test('does not serve stale data when the provider fails', async () => {
  const handler = await load();
  getWeatherByPlace.mockRejectedValue(new Error('provider down'));
  const context = await handler(makeContext('天氣 台北'));
  expect(context.messages[0].text).toContain('暫時無法取得天氣');
});

test('offers coord-bound choices when a name is ambiguous', async () => {
  const handler = await load();
  resolveLocation.mockResolvedValue({
    type: 'ambiguous',
    candidates: [
      {
        name: '嘉義', admin1: '嘉義市', country: '臺灣', latitude: 23.48, longitude: 120.45,
      },
      {
        name: '嘉義', admin1: '嘉義縣', country: '臺灣', latitude: 23.45, longitude: 120.25,
      },
    ],
  });
  const context = await handler(makeContext('天氣 嘉義'));
  const [message] = context.messages;
  expect(message.text).toContain('請選擇');
  expect(message.actions.map(({ data }) => data)).toEqual([
    '天氣座標 23.48 120.45 嘉義、嘉義市、臺灣',
    '天氣座標 23.45 120.25 嘉義、嘉義縣、臺灣',
  ]);
  expect(getWeatherByPlace).not.toHaveBeenCalled();
});

test('a coord postback fetches weather directly, skipping geocode', async () => {
  const handler = await load();
  const context = await handler(makeContext('天氣座標 23.48 120.45 嘉義、嘉義市、臺灣'));
  expect(resolveLocation).not.toHaveBeenCalled();
  expect(getWeatherByPlace).toHaveBeenCalledWith(expect.objectContaining({
    latitude: 23.48, longitude: 120.45, name: '嘉義、嘉義市、臺灣',
  }));
  expect(context.messages[0].text).toContain('現在');
});

test('routes an implicit weather intent with a leading date', async () => {
  const handler = await load();
  await handler(makeContext('今天天氣 嘉義'));
  expect(resolveLocation).toHaveBeenCalledWith('嘉義');
});

test('routes a trailing weather intent with the place first', async () => {
  const handler = await load();
  await handler(makeContext('台北天氣如何'));
  expect(resolveLocation).toHaveBeenCalledWith('台北');
});

test('does not hijack a chat sentence that merely mentions weather', async () => {
  const handler = await load();
  expect(handler(makeContext('我們來討論天氣系統的設計'))).toBe(false);
});

test('ignores an implicit intent when the feature is disabled', async () => {
  const handler = await load({ enabled: false });
  expect(handler(makeContext('今天天氣 嘉義'))).toBe(false);
});

test('subscribes to daily weather at a given hour', async () => {
  const handler = await load();
  await handler(makeContext('每日天氣 台北 8'));
  expect(resolveLocation).toHaveBeenCalledWith('台北');
  expect(upsertWeatherSubscription).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'o1', hour: 8, latitude: 25.04, longitude: 121.56,
  }));
});

test('subscribe uses the default hour when none is given', async () => {
  const handler = await load();
  await handler(makeContext('每日天氣 台北'));
  const [args] = upsertWeatherSubscription.mock.calls[0];
  expect(args.hour).toBe(7); // WEATHER_DAILY_DEFAULT_HOUR default
});

test('subscribe asks for a more specific place when ambiguous', async () => {
  const handler = await load();
  resolveLocation.mockResolvedValue({ type: 'ambiguous', candidates: [{}, {}] });
  const context = await handler(makeContext('每日天氣 嘉義'));
  expect(context.messages[0].text).toContain('不夠明確');
  expect(upsertWeatherSubscription).not.toHaveBeenCalled();
});

test('subscribe is refused when weather push is disabled', async () => {
  const again = await load({ pushEnabled: false });
  const context = await again(makeContext('每日天氣 台北'));
  expect(context.messages[0].text).toContain('尚未啟用');
  expect(upsertWeatherSubscription).not.toHaveBeenCalled();
});

test('unsubscribe disables all subscriptions', async () => {
  const handler = await load();
  const context = await handler(makeContext('取消每日天氣'));
  expect(disableWeatherSubscriptions).toHaveBeenCalledWith('o1');
  expect(context.messages[0].text).toContain('已取消');
});

test('lists current subscriptions', async () => {
  const handler = await load();
  listWeatherSubscriptions.mockResolvedValue([
    { location_label: '臺北市', hour: 8 },
    { location_label: '高雄市', hour: 20 },
  ]);
  const context = await handler(makeContext('我的天氣訂閱'));
  expect(context.messages[0].text).toContain('臺北市 08:00');
  expect(context.messages[0].text).toContain('高雄市 20:00');
});
