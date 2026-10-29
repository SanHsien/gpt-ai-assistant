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

// 把 IPv6 字串展開成 8 個 16-bit 群組（支援 :: 縮寫與尾端點分十進位 IPv4）。
const expandIpv6 = (ip) => {
  let addr = ip.toLowerCase().split('%')[0];
  const dotted = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    addr = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = addr.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const fill = addr.includes('::') ? new Array(8 - headGroups.length - tailGroups.length).fill('0') : [];
  return [...headGroups, ...fill, ...tailGroups].map((g) => parseInt(g, 16));
};

const embeddedV4 = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

// URL 會把 [::ffff:127.0.0.1] 正規化成 ::ffff:7f00:1，所以必須以數值判斷而不是比對字串形式。
const isPrivateIpv6 = (ip) => {
  const g = expandIpv6(ip);
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:0:0/96 IPv4-translated
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard-only
  if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: 與 ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateIpv4(embeddedV4(g[6], g[7])); // IPv4-mapped
  if (g.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible（已淘汰）
  if (g[0] === 0x64 && g[1] === 0xff9b) { // NAT64
    return g[2] !== 0 || g.slice(3, 6).some((x) => x !== 0) || isPrivateIpv4(embeddedV4(g[6], g[7]));
  }
  if (g[0] === 0x2002) return isPrivateIpv4(embeddedV4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo／文件用
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local（已淘汰）
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
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
