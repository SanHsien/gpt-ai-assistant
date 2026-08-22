import { expect, test } from '@jest/globals';

import { normalizeCountryCode } from '../services/serpapi.js';

test('a two-letter code passes through, normalised', () => {
  expect(normalizeCountryCode('TW')).toBe('tw');
  expect(normalizeCountryCode(' tw ')).toBe('tw');
});

test('a country name is rejected with the format it should have used', () => {
  // SerpAPI answers `gl=Taiwan` with `400 Unsupported \`Taiwan\` country`, which
  // never says what to put instead (upstream issue #356). The message here does.
  expect(() => normalizeCountryCode('Taiwan')).toThrow(/SERPAPI_LOCATION/);
  expect(() => normalizeCountryCode('Taiwan')).toThrow(/tw/);
});

test('an empty or missing value is rejected rather than silently searched', () => {
  expect(() => normalizeCountryCode('')).toThrow(/SERPAPI_LOCATION/);
  expect(() => normalizeCountryCode(undefined)).toThrow(/SERPAPI_LOCATION/);
});
