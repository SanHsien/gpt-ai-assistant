import dns from 'dns';
import { isIP } from 'net';
import { promisify } from 'util';
import isPrivateIp from './is-private-ip.js';

const lookup = promisify(dns.lookup);

/**
 * 檢查外部 URL 是否可安全連線（SSRF 防護）：僅允許 http/https；主機若為字面 IP 直接判斷，
 * 若為網域則解析 DNS 並檢查「所有」解析出的 IP 皆非私有/迴環/link-local/保留位址。
 * 通過回傳 { hostname }；不通過丟出 Error。
 *
 * ⚠️ 殘留風險：不防 DNS rebinding（解析後到實際連線之間位址可能改變），也不追蹤 redirect
 * （fetch 端以 maxRedirects: 0 規避 redirect-based SSRF）。此函式為預設關閉功能的深度防禦之一。
 *
 * @param {string} rawUrl
 * @returns {Promise<{ hostname: string }>}
 */
const assertSafeUrl = async (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('URL host resolves to a blocked address');
    return { hostname };
  }
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error('URL host could not be resolved');
  if (addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('URL host resolves to a blocked address');
  }
  return { hostname };
};

export default assertSafeUrl;
