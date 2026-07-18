import { expect, test } from '@jest/globals';
import isPrivateIp from '../utils/is-private-ip.js';
import assertSafeUrl from '../utils/assert-safe-url.js';
import fetchUrl, { convertHtmlToText } from '../utils/fetch-url.js';

test('isPrivateIp flags private / loopback / reserved IPv4', () => {
  ['10.0.0.1', '127.0.0.1', '169.254.1.1', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0']
    .forEach((ip) => expect(isPrivateIp(ip)).toBe(true));
});

test('isPrivateIp allows public IPv4', () => {
  ['8.8.8.8', '1.1.1.1', '172.32.0.1', '203.0.114.1']
    .forEach((ip) => expect(isPrivateIp(ip)).toBe(false));
});

test('isPrivateIp handles IPv6 loopback / ULA / link-local / mapped', () => {
  ['::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']
    .forEach((ip) => expect(isPrivateIp(ip)).toBe(true));
  ['2001:4860:4860::8888', '::ffff:8.8.8.8']
    .forEach((ip) => expect(isPrivateIp(ip)).toBe(false));
});

test('isPrivateIp treats non-IP strings as unsafe', () => {
  expect(isPrivateIp('not-an-ip')).toBe(true);
  expect(isPrivateIp('')).toBe(true);
});

test('assertSafeUrl rejects non-http(s) schemes', async () => {
  await expect(assertSafeUrl('ftp://example.com/x')).rejects.toThrow();
  // eslint-disable-next-line no-script-url
  await expect(assertSafeUrl('javascript:alert(1)')).rejects.toThrow();
  await expect(assertSafeUrl('not a url')).rejects.toThrow();
});

test('assertSafeUrl rejects literal private / loopback hosts', async () => {
  await expect(assertSafeUrl('http://127.0.0.1/x')).rejects.toThrow();
  await expect(assertSafeUrl('http://10.1.2.3/x')).rejects.toThrow();
  await expect(assertSafeUrl('http://[::1]/x')).rejects.toThrow();
});

test('assertSafeUrl accepts a literal public IP host', async () => {
  await expect(assertSafeUrl('https://8.8.8.8/')).resolves.toEqual({ hostname: '8.8.8.8' });
});

test('fetchUrl refuses unsafe URLs before making any request', async () => {
  await expect(fetchUrl('http://127.0.0.1/')).rejects.toThrow();
});

test('HTML conversion excludes script elements with tag whitespace', () => {
  const html = '<p>safe</p><script >ignored()</script ><p>text</p>';
  expect(convertHtmlToText(html)).toBe('safe text');
});

test('HTML conversion decodes entities only once', () => {
  expect(convertHtmlToText('<p>&amp;lt;script&amp;gt;</p>')).toBe('&lt;script&gt;');
});
