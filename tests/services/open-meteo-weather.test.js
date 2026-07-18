import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let get;

const load = async () => {
  jest.resetModules();
  get = jest.fn();
  jest.doMock('axios', () => ({
    __esModule: true,
    default: { get },
  }));
  jest.doMock('../../config/index.js', () => ({
    __esModule: true,
    default: { APP_API_TIMEOUT: 10000 },
  }));
  return import('../../services/weather/open-meteo.js');
};

afterEach(() => {
  jest.dontMock('axios');
  jest.dontMock('../../config/index.js');
  jest.resetModules();
});

test('retries a common Taiwan shorthand with city and country context', async () => {
  const { geocodeLocation } = await load();
  get
    .mockResolvedValueOnce({ data: {} })
    .mockResolvedValueOnce({
      data: {
        results: [{
          name: '台北市',
          admin1: '臺灣省 or 台灣省',
          country: '台湾',
          country_code: 'TW',
          latitude: 25.05306,
          longitude: 121.52639,
          timezone: 'Asia/Taipei',
        }],
      },
    });

  await expect(geocodeLocation('台北')).resolves.toEqual({
    name: '臺北市',
    admin1: null,
    country: '臺灣',
    latitude: 25.05306,
    longitude: 121.52639,
    timezone: 'Asia/Taipei',
  });
  expect(get).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
    params: expect.objectContaining({ name: '台北市', countryCode: 'TW' }),
  }));
});

test('does not invent a fallback for an unknown non-Taiwan location', async () => {
  const { geocodeLocation } = await load();
  get.mockResolvedValue({ data: {} });
  await expect(geocodeLocation('nowhere-xyz')).resolves.toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
});

test('uses deterministic Taiwan city/county choices when the provider omits county records', async () => {
  const { geocodeCandidates, geocodeLocation } = await load();
  await expect(geocodeCandidates('嘉義')).resolves.toEqual([
    expect.objectContaining({ name: '嘉義', admin1: '嘉義市', country: '臺灣' }),
    expect.objectContaining({ name: '嘉義', admin1: '嘉義縣', country: '臺灣' }),
  ]);
  await expect(geocodeLocation('嘉義縣')).resolves.toEqual(expect.objectContaining({
    name: '嘉義縣', country: '臺灣', timezone: 'Asia/Taipei',
  }));
  expect(get).not.toHaveBeenCalled();
});
