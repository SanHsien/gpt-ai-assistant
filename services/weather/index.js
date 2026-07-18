import config from '../../config/index.js';
import { fetchForecast, geocodeCandidates, geocodeLocation } from './open-meteo.js';

// WMO weather code → 簡潔中文＋emoji。
const WEATHER_CODES = {
  0: '☀️ 晴',
  1: '🌤️ 大致晴朗',
  2: '⛅ 局部多雲',
  3: '☁️ 陰',
  45: '🌫️ 有霧',
  48: '🌫️ 霧凇',
  51: '🌦️ 毛毛雨',
  53: '🌦️ 毛毛雨',
  55: '🌦️ 強毛毛雨',
  56: '🌧️ 凍毛毛雨',
  57: '🌧️ 凍毛毛雨',
  61: '🌧️ 小雨',
  63: '🌧️ 中雨',
  65: '🌧️ 大雨',
  66: '🌧️ 凍雨',
  67: '🌧️ 凍雨',
  71: '🌨️ 小雪',
  73: '🌨️ 中雪',
  75: '🌨️ 大雪',
  77: '🌨️ 雪粒',
  80: '🌦️ 陣雨',
  81: '🌦️ 陣雨',
  82: '⛈️ 強陣雨',
  85: '🌨️ 陣雪',
  86: '🌨️ 強陣雪',
  95: '⛈️ 雷雨',
  96: '⛈️ 雷雨夾冰雹',
  99: '⛈️ 強雷雨夾冰雹',
};

export const describeWeatherCode = (code) => WEATHER_CODES[code] || '❓ 未知';

// 同地點＋預報天數在 TTL 內共用快取，避免多人重複打 provider。
const cache = new Map();
const cacheKey = (name, days) => `${name.trim().toLowerCase()}|${days}`;

/**
 * 查地點天氣（geocode → forecast），帶短期快取。找不到地點回 null。
 * @param {string} locationName
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ place, forecast }|null>}
 */
export const getWeather = async (locationName, { now = Date.now() } = {}) => {
  const days = config.WEATHER_FORECAST_DAYS;
  const key = cacheKey(locationName, days);
  const hit = cache.get(key);
  if (hit && now - hit.at < config.WEATHER_CACHE_TTL * 1000) return hit.value;

  const place = await geocodeLocation(locationName);
  if (!place) return null;
  const forecast = await fetchForecast({ ...place, days });
  const value = { place, forecast };
  cache.set(key, { at: now, value });
  return value;
};

export const placeLabel = (place) => (
  [place.name, place.admin1, place.country]
    .filter((part, i, arr) => part && arr.indexOf(part) === i)
    .join('、')
);

/**
 * 解析地名。同名但分屬不同行政區時回 ambiguous 讓使用者選，不靜默選錯。
 * @param {string} name
 * @returns {Promise<{ type: 'single', place } | { type: 'ambiguous', candidates } | null>}
 */
export const resolveLocation = async (name) => {
  const candidates = await geocodeCandidates(name);
  if (candidates.length === 0) return null;
  const top = candidates[0];
  // 只把「與最相關結果同名、但行政區不同」的候選視為需要追問。
  const rivals = candidates.filter((candidate) => candidate.name === top.name);
  const areas = new Set(rivals.map((candidate) => `${candidate.admin1 || ''}|${candidate.country || ''}`));
  if (rivals.length >= 2 && areas.size >= 2) {
    return { type: 'ambiguous', candidates: rivals.slice(0, 4) };
  }
  return { type: 'single', place: top };
};

/**
 * 用已知座標的 place 直接查天氣（追問選定後走這裡，跳過 geocode）。座標快取。
 * @param {{ latitude, longitude, timezone, name }} place
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ place, forecast }>}
 */
export const getWeatherByPlace = async (place, { now = Date.now() } = {}) => {
  const days = config.WEATHER_FORECAST_DAYS;
  const key = `${place.latitude},${place.longitude}|${days}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < config.WEATHER_CACHE_TTL * 1000) return hit.value;
  const forecast = await fetchForecast({ ...place, days });
  const value = { place, forecast };
  cache.set(key, { at: now, value });
  return value;
};

/**
 * 把 getWeather 結果格式化成 LINE 文字（含資料地點與「現在」標註）。
 * @param {{ place, forecast }} value
 * @returns {string}
 */
export const formatWeather = ({ place, forecast }) => {
  const current = forecast.current || {};
  const daily = forecast.daily || {};
  const lines = [`${placeLabel(place)} 天氣`];
  lines.push(
    `現在：${describeWeatherCode(current.weather_code)} ${Math.round(current.temperature_2m)}°C`
    + `（濕度 ${current.relative_humidity_2m}%、風速 ${Math.round(current.wind_speed_10m)} km/h）`,
  );
  (daily.time || []).forEach((date, i) => {
    const desc = describeWeatherCode(daily.weather_code[i]);
    const max = Math.round(daily.temperature_2m_max[i]);
    const min = Math.round(daily.temperature_2m_min[i]);
    const pop = daily.precipitation_probability_max?.[i];
    lines.push(`${date.slice(5)} ${desc} ${min}–${max}°C${pop != null ? `、降雨 ${pop}%` : ''}`);
  });
  lines.push('資料來源：Open-Meteo');
  return lines.join('\n');
};

export default {
  describeWeatherCode,
  getWeather,
  resolveLocation,
  getWeatherByPlace,
  placeLabel,
  formatWeather,
};
