import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let search;

const load = async (data) => {
  jest.resetModules();
  process.env.NODE_ENV = 'production';
  process.env.SERPAPI_API_KEY = 'test-key';
  search = jest.fn().mockResolvedValue({ data });
  jest.doMock('../../services/serpapi.js', () => ({ search }));
  const mod = await import('../../utils/fetch-answer.js');
  return mod.default;
};

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.SERPAPI_API_KEY;
  jest.dontMock('../../services/serpapi.js');
  jest.resetModules();
});

test('keeps up to three sources with title, link, source and date', async () => {
  const fetchAnswer = await load({
    organic_results: [
      {
        title: 'A', link: 'https://a', snippet: 'sa', source: 'site-a', date: '2026-07-16',
      },
      { title: 'B', link: 'https://b', snippet: 'sb' },
      { title: 'C', link: 'https://c' },
      { title: 'D', link: 'https://d' },
    ],
  });
  const result = await fetchAnswer('q');
  expect(result.sources).toHaveLength(3);
  expect(result.sources[0]).toEqual({
    title: 'A', link: 'https://a', snippet: 'sa', source: 'site-a', date: '2026-07-16',
  });
  expect(result.answer).toBe('sa');
});

test('drops results without a title or link', async () => {
  const fetchAnswer = await load({
    organic_results: [{ snippet: 'no title' }, { title: 'ok', link: 'https://ok' }],
  });
  const result = await fetchAnswer('q');
  expect(result.sources).toEqual([{
    title: 'ok', link: 'https://ok', snippet: null, source: null, date: null,
  }]);
});

test('folds answer box and knowledge graph into the answer', async () => {
  const fetchAnswer = await load({
    answer_box: { answer: 'AB' },
    knowledge_graph: { title: 'KG', description: 'desc' },
    organic_results: [{ title: 'A', link: 'https://a', snippet: 'sa' }],
  });
  const result = await fetchAnswer('q');
  expect(result.answer).toContain('sa');
  expect(result.answer).toContain('AB');
  expect(result.answer).toContain('KG - desc');
});

test('returns empty when SerpAPI key is missing', async () => {
  jest.resetModules();
  process.env.NODE_ENV = 'production';
  delete process.env.SERPAPI_API_KEY;
  const { default: fetchAnswer } = await import('../../utils/fetch-answer.js');
  const result = await fetchAnswer('q');
  expect(result.answer).toBe('');
  expect(result.sources).toEqual([]);
});
