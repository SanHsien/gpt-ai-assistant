import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let geocodeLocation;
let geocodeCandidates;
let fetchForecast;

const FORECAST = {
  current: {
    temperature_2m: 30.4, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 12.6,
  },
  daily: {
    time: ['2026-07-16', '2026-07-17'],
    weather_code: [3, 61],
    temperature_2m_max: [33.1, 31.8],
    temperature_2m_min: [26.2, 25.9],
    precipitation_probability_max: [20, 80],
  },
};

const load = async () => {
  jest.resetModules();
  process.env.WEATHER_FORECAST_DAYS = '2';
  process.env.WEATHER_CACHE_TTL = '600';
  geocodeLocation = jest.fn().mockResolvedValue({
    name: '臺北市', admin1: '臺北市', country: '臺灣', latitude: 25.04, longitude: 121.56, timezone: 'Asia/Taipei',
  });
  fetchForecast = jest.fn().mockResolvedValue(FORECAST);
  geocodeCandidates = jest.fn().mockResolvedValue([{
    name: '臺北市', admin1: '臺北市', country: '臺灣', latitude: 25.04, longitude: 121.56, timezone: 'Asia/Taipei',
  }]);
  jest.doMock('../../services/weather/open-meteo.js', () => ({ geocodeLocation, geocodeCandidates, fetchForecast }));
  return import('../../services/weather/index.js');
};

afterEach(() => {
  delete process.env.WEATHER_FORECAST_DAYS;
  delete process.env.WEATHER_CACHE_TTL;
  jest.dontMock('../../services/weather/open-meteo.js');
  jest.resetModules();
});

test('describeWeatherCode maps WMO codes and falls back for unknowns', async () => {
  const { describeWeatherCode } = await load();
  expect(describeWeatherCode(0)).toContain('晴');
  expect(describeWeatherCode(61)).toContain('小雨');
  expect(describeWeatherCode(1234)).toContain('未知');
});

test('getWeather geocodes then fetches forecast and passes the day count', async () => {
  const { getWeather } = await load();
  const value = await getWeather('台北', { now: 1000 });
  expect(geocodeLocation).toHaveBeenCalledWith('台北');
  expect(fetchForecast).toHaveBeenCalledWith(expect.objectContaining({ latitude: 25.04, days: 2 }));
  expect(value.forecast).toBe(FORECAST);
});

test('getWeather serves a cache hit within the TTL without re-fetching', async () => {
  const { getWeather } = await load();
  await getWeather('台北', { now: 1000 });
  await getWeather('台北', { now: 1000 + 599 * 1000 }); // within 600s TTL
  expect(geocodeLocation).toHaveBeenCalledTimes(1);
  await getWeather('台北', { now: 1000 + 601 * 1000 }); // past TTL
  expect(geocodeLocation).toHaveBeenCalledTimes(2);
});

test('getWeather returns null for an unknown location', async () => {
  const { getWeather } = await load();
  geocodeLocation.mockResolvedValue(null);
  expect(await getWeather('nowhere-xyz', { now: 5 })).toBeNull();
  expect(fetchForecast).not.toHaveBeenCalled();
});

test('formatWeather shows the place, current conditions and each forecast day', async () => {
  const { getWeather, formatWeather } = await load();
  const value = await getWeather('台北', { now: 1 });
  const text = formatWeather(value);
  expect(text).toContain('臺北市');
  expect(text).toContain('現在');
  expect(text).toContain('30°C'); // rounded current temp
  expect(text).toContain('07-16');
  expect(text).toContain('07-17');
  expect(text).toContain('降雨 80%');
  expect(text).toContain('資料來源：Open-Meteo');
});

test('resolveLocation returns a single place when candidates agree', async () => {
  const { resolveLocation } = await load();
  const resolved = await resolveLocation('台北');
  expect(resolved.type).toBe('single');
  expect(resolved.place.name).toBe('臺北市');
});

test('resolveLocation flags ambiguity for same-name, different-area candidates', async () => {
  const { resolveLocation } = await load();
  geocodeCandidates.mockResolvedValue([
    {
      name: '嘉義', admin1: '嘉義市', country: '臺灣', latitude: 23.48, longitude: 120.45,
    },
    {
      name: '嘉義', admin1: '嘉義縣', country: '臺灣', latitude: 23.45, longitude: 120.25,
    },
  ]);
  const resolved = await resolveLocation('嘉義');
  expect(resolved.type).toBe('ambiguous');
  expect(resolved.candidates).toHaveLength(2);
});

test('resolveLocation returns null when there are no candidates', async () => {
  const { resolveLocation } = await load();
  geocodeCandidates.mockResolvedValue([]);
  expect(await resolveLocation('nowhere')).toBeNull();
});

test('getWeatherByPlace fetches by coords and caches by lat/lon', async () => {
  const { getWeatherByPlace } = await load();
  const place = { latitude: 23.48, longitude: 120.45, timezone: 'auto' };
  await getWeatherByPlace(place, { now: 1000 });
  await getWeatherByPlace(place, { now: 1000 + 599 * 1000 });
  expect(fetchForecast).toHaveBeenCalledTimes(1); // cache hit within TTL
});
