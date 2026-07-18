import config from '../config/index.js';
import { createChatCompletion } from './openai.js';
import { recordCompletionRun } from './run-trace.js';
import {
  alignDateTimeToDate,
  extractJson,
  localDateTimeToIso,
  resolveRelativeDate,
  resolveWeekEndDate,
  resolveWeekdayDate,
} from './schedule-parser.js';
import { validateTaskDraft } from '../schemas/task-draft.js';

const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'task_draft',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        // dueAt 是 ISO 8601；沒有明確期限就 null，任務不追問。
        dueAt: { type: ['string', 'null'] },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
      },
      required: ['title', 'dueAt', 'priority'],
    },
  },
};

const buildMessages = ({ text, now, timezone }) => {
  const dateHint = resolveWeekdayDate({ text, now, timezone })
    || resolveRelativeDate({ text, now, timezone })
    || resolveWeekEndDate({ text, now, timezone });
  const system = [
    '你是一個把中文自然語言轉成待辦任務 JSON 的解析器。',
    '只輸出 JSON，不要多餘文字。允許欄位：title、dueAt、priority。',
    'title 是任務事由（去掉時間詞後的核心內容）。',
    'dueAt 是期限，用 ISO 8601；相對日期以使用者時區與「現在」為基準解析。',
    '沒有明確期限時 dueAt 為 null，不要臆造時間。只有日期沒有時間時，用當天 09:00。',
    'priority：出現「重要／緊急／急／優先／馬上」等 → high；「有空／不急／隨便／低優先」等 → low；其餘一律 normal。',
    ...(dateHint ? [`日期解消提示：原文「${dateHint.phrase}」在使用者時區對應 ${dateHint.date}，必須使用這個日期。`] : []),
    `現在時間：${now.toISOString()}。使用者時區：${timezone || '未提供'}。`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
};

const complete = async (messages) => {
  const startedAt = Date.now();
  const { data } = await createChatCompletion({
    messages,
    temperature: 0,
    maxTokens: config.SCHEDULE_MAX_TOKENS,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stop: [],
    responseFormat,
  });
  await recordCompletionRun({
    capability: 'task-parse',
    model: data.model,
    usage: data.usage,
    durationMs: Date.now() - startedAt,
  });
  return data.choices?.[0]?.message?.content ?? '';
};

/**
 * 自然語言 → 已驗證的 task draft（title + 可選 dueAt）。
 * 解析不到有效 JSON 時，退回把整段文字當 title 的無期限任務——任務不阻塞、不追問。
 * @param {{ text: string, timezone?: string|null, now?: Date }} params
 * @returns {Promise<{ valid: boolean, errors: string[], value: Object|null }>}
 */
// #標籤 用正則確定性提取（省 token、可靠），並從交給模型的文字中移除。
const extractTags = (text) => {
  const tags = [];
  const stripped = text
    .replace(/#([^\s#。！？.!?,，；;：:]+)/gu, (_, tag) => {
      const normalized = tag.normalize('NFKC').trim();
      if (normalized) tags.push(normalized);
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { tags, stripped };
};

export const parseTaskDraft = async ({ text, timezone = null, now = new Date() }) => {
  const { tags, stripped } = extractTags(text);
  const forModel = stripped || text;
  const output = await complete(buildMessages({ text: forModel, now, timezone }));
  const json = extractJson(output ?? '');
  const dateHint = resolveWeekdayDate({ text: forModel, now, timezone })
    || resolveRelativeDate({ text: forModel, now, timezone })
    || resolveWeekEndDate({ text: forModel, now, timezone });
  let dueAt = json?.dueAt;
  if (dateHint) {
    dueAt = dueAt != null
      ? alignDateTimeToDate(dueAt, dateHint.date, timezone)
      : localDateTimeToIso(dateHint.date, '09:00', timezone);
  }
  const base = (!json || typeof json.title !== 'string' || json.title.trim() === '')
    // 模型沒給可用 title：去掉標籤後的文字就是任務內容，維持可用。
    ? { title: forModel }
    : {
      title: json.title,
      ...(dueAt != null ? { dueAt } : {}),
      ...(json.priority != null ? { priority: json.priority } : {}),
    };
  return validateTaskDraft({ ...base, ...(tags.length > 0 ? { tags } : {}) });
};

export default { parseTaskDraft };
