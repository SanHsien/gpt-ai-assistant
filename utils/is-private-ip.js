/* eslint-disable no-bitwise */ // IP / CIDR 遮罩運算需要位元運算，此檔刻意允許。
import { isIP } from 'net';

const ipv4ToLong = (ip) => ip
  .split('.')
  .reduce((acc, octet) => (acc * 256) + Number(octet), 0);

const inV4Range = (ip, cidr) => {
  const [range, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
};

// 私有 / 迴環 / link-local / 保留 IPv4 範圍（阻擋 SSRF 目標）。
const V4_BLOCKED = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

const isPrivateIpv4 = (ip) => V4_BLOCKED.some((cidr) => inV4Range(ip, cidr));

const isPrivateIpv6 = (ip) => {
  const addr = ip.toLowerCase();
  if (addr === '::' || addr === '::1') return true; // unspecified / loopback
  // IPv4-mapped（::ffff:a.b.c.d）→ 取出 IPv4 再判斷
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const head = addr.split(':')[0];
  const group = head ? parseInt(head, 16) : 0;
  if ((group & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((group & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
};

/**
 * 判斷一個 IP 字串是否為私有 / 迴環 / link-local / 保留位址（不應被 SSRF-safe fetch 連線）。
 * @param {string} ip
 * @returns {boolean}
 */
const isPrivateIp = (ip) => {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // 不是合法 IP → 保守視為不安全
};

export default isPrivateIp;
