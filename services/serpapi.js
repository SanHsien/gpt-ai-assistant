import axios from 'axios';
import config from '../config/index.js';
import { handleFulfilled, handleRejected, handleRequest } from './utils/index.js';

const client = axios.create({
  baseURL: 'https://serpapi.com',
  timeout: config.SERPAPI_TIMEOUT,
  headers: {
    'Accept-Encoding': 'gzip, deflate, compress',
  },
});

client.interceptors.request.use((c) => {
  c.params = {
    key: config.SERPAPI_API_KEY,
    ...c.params,
  };
  return handleRequest(c);
});

client.interceptors.response.use(handleFulfilled, (err) => {
  if (err.response?.data?.error) {
    err.message = err.response.data.error;
  }
  return handleRejected(err);
});

const COUNTRY_CODE_PATTERN = /^[a-z]{2}$/;

/**
 * `gl` 只接受 ISO 3166-1 alpha-2 代碼（台灣是 `tw`）。填國名會讓 SerpAPI 回
 * 400 `Unsupported \`Taiwan\` country - gl parameter`，而那個訊息不會告訴使用者
 * 該填什麼——上游 issue #356 就是卡在這裡。與其把原始 400 丟給使用者，不如在
 * 送出前擋下來並說清楚。
 */
export const normalizeCountryCode = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!COUNTRY_CODE_PATTERN.test(normalized)) {
    throw new Error(
      `SERPAPI_LOCATION 需要 ISO 3166-1 alpha-2 國家代碼（例如台灣是 tw），目前是 "${value}"。`,
    );
  }
  return normalized;
};

const search = ({
  gl = config.SERPAPI_LOCATION,
  q,
}) => client.get('/search', {
  params: {
    gl: normalizeCountryCode(gl),
    q,
  },
});

export {
  search,
};

export default null;
