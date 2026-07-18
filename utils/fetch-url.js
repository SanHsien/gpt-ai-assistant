import axios from 'axios';
import { convert } from 'html-to-text';
import config from '../config/index.js';
import assertSafeUrl from './assert-safe-url.js';

export const convertHtmlToText = (html) => convert(html, {
  wordwrap: false,
  selectors: [
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'img', format: 'skip' },
    { selector: 'a', options: { ignoreHref: true } },
  ],
})
  .replace(/\s+/g, ' ')
  .trim();

/**
 * SSRF-safe 抓取網頁純文字：先過 assertSafeUrl，再以 http/https 抓取，禁止 redirect，
 * 限制大小與時間，僅接受 text/html 或 text/plain，回傳截斷後的純文字。
 * @param {string} rawUrl
 * @returns {Promise<string>}
 */
const fetchUrl = async (rawUrl) => {
  await assertSafeUrl(rawUrl);
  const { data, headers } = await axios.get(rawUrl, {
    timeout: config.URL_FETCH_TIMEOUT,
    maxRedirects: 0,
    maxContentLength: config.URL_FETCH_MAX_BYTES,
    responseType: 'text',
    transitional: { clarifyTimeoutError: true },
    headers: { Accept: 'text/html,text/plain' },
  });
  const contentType = String(headers['content-type'] || '');
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    throw new Error('Unsupported content type');
  }
  const text = contentType.includes('text/html')
    ? convertHtmlToText(String(data))
    : String(data).trim();
  return text.slice(0, config.URL_FETCH_MAX_CHARS);
};

export default fetchUrl;
