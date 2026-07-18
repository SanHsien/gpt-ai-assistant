import axios from 'axios';
import config from '../../config/index.js';

// Open-Meteo：免費、無需 API key、CC-BY 授權。固定官方網域，非使用者提供的 URL，無 SSRF 疑慮；
// 地點名以 query param 傳入，axios 會自動 encode。
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const TAIWAN_LOCATION_ALIASES = new Map([
  ['台北', '台北市'], ['臺北', '台北市'], ['新北', '新北市'], ['桃園', '桃園市'],
  ['台中', '台中市'], ['臺中', '台中市'], ['台南', '台南市'], ['臺南', '台南市'],
  ['高雄', '高雄市'], ['基隆', '基隆市'], ['新竹', '新竹市'], ['嘉義', '嘉義市'],
  ['苗栗', '苗栗縣'], ['彰化', '彰化縣'], ['南投', '南投縣'], ['雲林', '雲林縣'],
  ['屏東', '屏東縣'], ['宜蘭', '宜蘭縣'], ['花蓮', '花蓮縣'], ['台東', '台東縣'],
  ['臺東', '台東縣'], ['澎湖', '澎湖縣'], ['金門', '金門縣'], ['連江', '連江縣'],
  ['馬祖', '連江縣'],
]);

// Open-Meteo geocoding does not return Taiwan county-level records consistently. Keep only
// the two city/county name collisions that need deterministic disambiguation; townships such
// as Taibao or Minxiong still go through the provider when entered directly.
const TAIWAN_ADMIN_CENTERS = new Map([
  ['嘉義', [
    {
      name: '嘉義', admin1: '嘉義市', latitude: 23.4801, longitude: 120.4491,
    },
    {
      name: '嘉義', admin1: '嘉義縣', latitude: 23.4518, longitude: 120.2555,
    },
  ]],
  ['嘉義市', [{
    name: '嘉義市', admin1: null, latitude: 23.4801, longitude: 120.4491,
  }]],
  ['嘉義縣', [{
    name: '嘉義縣', admin1: null, latitude: 23.4518, longitude: 120.2555,
  }]],
  ['新竹', [
    {
      name: '新竹', admin1: '新竹市', latitude: 24.8138, longitude: 120.9675,
    },
    {
      name: '新竹', admin1: '新竹縣', latitude: 24.8387, longitude: 121.0177,
    },
  ]],
  ['新竹市', [{
    name: '新竹市', admin1: null, latitude: 24.8138, longitude: 120.9675,
  }]],
  ['新竹縣', [{
    name: '新竹縣', admin1: null, latitude: 24.8387, longitude: 121.0177,
  }]],
]);

const staticTaiwanPlaces = (name) => (TAIWAN_ADMIN_CENTERS.get(name.trim()) || []).map((place) => ({
  ...place,
  country: '臺灣',
  latitude: place.latitude,
  longitude: place.longitude,
  timezone: 'Asia/Taipei',
}));

const normalizeTaiwanPlace = (result) => {
  if (result.country_code !== 'TW') return result;
  const admin1 = /(?:臺灣省|台灣省|台湾省|\bor\b)/iu.test(result.admin1 || '')
    ? null
    : result.admin1;
  return {
    ...result,
    name: result.name.replace(/^台(?=[北中南東])/u, '臺'),
    admin1,
    country: '臺灣',
  };
};

const fetchGeocodeResult = async (name, countryCode = null) => {
  const { data } = await axios.get(GEOCODE_URL, {
    params: {
      name,
      count: 1,
      language: 'zh',
      format: 'json',
      ...(countryCode ? { countryCode } : {}),
    },
    timeout: config.APP_API_TIMEOUT,
  });
  return data.results?.[0] || null;
};

/**
 * 地名 → 座標與時區。取最相關的一筆；找不到回 null。
 * @param {string} name
 * @returns {Promise<{name, admin1, country, latitude, longitude, timezone}|null>}
 */
export const geocodeLocation = async (name) => {
  const query = name.trim();
  const staticPlaces = staticTaiwanPlaces(query);
  if (staticPlaces.length === 1) return staticPlaces[0];
  let result = await fetchGeocodeResult(query);
  const taiwanAlias = TAIWAN_LOCATION_ALIASES.get(query);
  if (!result && taiwanAlias) result = await fetchGeocodeResult(taiwanAlias, 'TW');
  if (!result) return null;
  const place = normalizeTaiwanPlace(result);
  return {
    name: place.name,
    admin1: place.admin1 ?? null,
    country: place.country ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone ?? 'auto',
  };
};

const toPlace = (place) => ({
  name: place.name,
  admin1: place.admin1 ?? null,
  country: place.country ?? null,
  latitude: place.latitude,
  longitude: place.longitude,
  timezone: place.timezone ?? 'auto',
});

/**
 * 取多個地名候選（同名不同行政區時用來追問）。找不到回空陣列。
 * @param {string} name
 * @param {number} [count]
 * @returns {Promise<Array<{name, admin1, country, latitude, longitude, timezone}>>}
 */
export const geocodeCandidates = async (name, count = 5) => {
  const query = name.trim();
  const staticPlaces = staticTaiwanPlaces(query);
  if (staticPlaces.length > 0) return staticPlaces.slice(0, count);
  const { data } = await axios.get(GEOCODE_URL, {
    params: {
      name: query, count, language: 'zh', format: 'json',
    },
    timeout: config.APP_API_TIMEOUT,
  });
  let results = data.results || [];
  const alias = TAIWAN_LOCATION_ALIASES.get(query);
  if (results.length === 0 && alias) {
    const { data: aliasData } = await axios.get(GEOCODE_URL, {
      params: {
        name: alias, count, language: 'zh', format: 'json', countryCode: 'TW',
      },
      timeout: config.APP_API_TIMEOUT,
    });
    results = aliasData.results || [];
  }
  return results.map((result) => toPlace(normalizeTaiwanPlace(result)));
};

/**
 * 依座標取當前天氣與每日預報。
 * @param {{ latitude, longitude, timezone, days }} params
 * @returns {Promise<Object>} Open-Meteo forecast 原始回應
 */
export const fetchForecast = async ({
  latitude, longitude, timezone, days,
}) => {
  const { data } = await axios.get(FORECAST_URL, {
    params: {
      latitude,
      longitude,
      timezone: timezone || 'auto',
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      forecast_days: days,
    },
    timeout: config.APP_API_TIMEOUT,
  });
  return data;
};

export default { geocodeLocation, geocodeCandidates, fetchForecast };
