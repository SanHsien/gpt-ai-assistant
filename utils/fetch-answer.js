import config from '../config/index.js';
import { search } from '../services/serpapi.js';

class SearchResult {
  answer;

  sources;

  constructor({ answer = '', sources = [] } = {}) {
    this.answer = answer;
    this.sources = sources;
  }
}

const MAX_SOURCES = 3;

const fetchAnswer = async (q) => {
  if (config.APP_ENV !== 'production' || !config.SERPAPI_API_KEY) return new SearchResult();
  const res = await search({ q });
  const {
    answer_box: answerBox, knowledge_graph: knowledgeGraph, organic_results: organicResults,
  } = res.data;
  let answer = organicResults?.[0]?.snippet || '';
  if (answerBox?.answer) answer += answerBox.answer;
  if (answerBox?.result) answer += answerBox.result;
  if (answerBox?.snippet) answer += answerBox.snippet;
  if (knowledgeGraph?.description) answer += `${knowledgeGraph.title} - ${knowledgeGraph.description}`;
  // 保留來源（標題／連結／來源站／時間／摘要），供回覆附上可驗證出處。
  const sources = (organicResults || [])
    .filter((result) => result?.title && result?.link)
    .slice(0, MAX_SOURCES)
    .map((result) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet ?? null,
      source: result.source ?? null,
      date: result.date ?? null,
    }));
  return new SearchResult({ answer, sources });
};

export default fetchAnswer;
