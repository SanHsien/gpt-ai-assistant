import config from '../config/index.js';
import { createChatCompletion } from './openai.js';
import { parseEventDraft } from './schedule-parser.js';
import { recordCompletionRun } from './run-trace.js';

const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'event_draft',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: ['string', 'null'] },
        start: { type: ['string', 'null'] },
        end: { type: ['string', 'null'] },
        allDay: { type: 'boolean' },
        timezone: { type: ['string', 'null'] },
        location: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        recurrence: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                freq: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] },
                interval: { type: ['integer', 'null'] },
                count: { type: ['integer', 'null'] },
                until: { type: ['string', 'null'] },
              },
              required: ['freq', 'interval', 'count', 'until'],
            },
          ],
        },
        knownDate: { type: ['string', 'null'] },
        knownTime: { type: ['string', 'null'] },
        knownEndDate: { type: ['string', 'null'] },
        knownEndTime: { type: ['string', 'null'] },
        missingFields: {
          type: 'array',
          items: { type: 'string', enum: ['title', 'date', 'time', 'endDate', 'endTime'] },
        },
      },
      required: [
        'title', 'start', 'end', 'allDay', 'timezone', 'location', 'notes', 'recurrence',
        'knownDate', 'knownTime', 'knownEndDate', 'knownEndTime', 'missingFields',
      ],
    },
  },
};

// 行程解析與聊天的參數需求不同：
// - 聊天的 OPENAI_COMPLETION_MAX_TOKENS 預設只有 64，塞不下一份完整的行程 JSON。
// - temperature 固定 0，同一句話每次都要解析出同一個結果。
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
    capability: 'schedule-parse',
    model: data.model,
    usage: data.usage,
    durationMs: Date.now() - startedAt,
  });
  return data.choices?.[0]?.message?.content ?? '';
};

/**
 * 自然語言 → 已驗證的 event draft。模型輸出一律經 schemas/event-draft.js 驗證後才回傳。
 * @param {{ text: string, timezone?: string|null, now?: Date }} params
 * @returns {Promise<{ valid: boolean, errors: string[], value: Object|null }>}
 */
export const parseSchedule = ({
  text, timezone = null, now = new Date(), mode = 'create', baseDraft = null,
}) => (
  parseEventDraft(text, {
    now, timezone, complete, mode, baseDraft,
  })
);

export default { parseSchedule };
