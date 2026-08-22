import axios from 'axios';
import FormData from 'form-data';
import config from '../config/index.js';
import { handleFulfilled, handleRejected, handleRequest } from './utils/index.js';

export const ROLE_SYSTEM = 'system';
export const ROLE_AI = 'assistant';
export const ROLE_HUMAN = 'user';

export const FINISH_REASON_STOP = 'stop';
export const FINISH_REASON_LENGTH = 'length';

export const IMAGE_SIZE_256 = '256x256';
export const IMAGE_SIZE_512 = '512x512';
export const IMAGE_SIZE_1024 = '1024x1024';

export const MODEL_GPT_3_5_TURBO = 'gpt-3.5-turbo';
export const MODEL_GPT_4_OMNI = 'gpt-4o';
export const MODEL_WHISPER_1 = 'whisper-1';
export const MODEL_GPT_4O_MINI_TRANSCRIBE = 'gpt-4o-mini-transcribe';
export const MODEL_DALL_E_3 = 'dall-e-3';

const client = axios.create({
  baseURL: config.OPENAI_BASE_URL,
  timeout: config.OPENAI_TIMEOUT,
  headers: {
    'Accept-Encoding': 'gzip, deflate, compress',
  },
});

client.interceptors.request.use((c) => {
  c.headers.Authorization = `Bearer ${config.OPENAI_API_KEY}`;
  return handleRequest(c);
});

client.interceptors.response.use(handleFulfilled, (err) => {
  if (err.response?.data?.error?.message) {
    err.message = err.response.data.error.message;
  }
  return handleRejected(err);
});

const hasImage = ({ messages }) => (
  messages.some(({ content }) => (
    Array.isArray(content) && content.some((item) => item.image_url)
  ))
);

const createChatCompletion = ({
  model = config.OPENAI_COMPLETION_MODEL,
  messages,
  temperature = config.OPENAI_COMPLETION_TEMPERATURE,
  maxTokens = config.OPENAI_COMPLETION_MAX_TOKENS,
  frequencyPenalty = config.OPENAI_COMPLETION_FREQUENCY_PENALTY,
  presencePenalty = config.OPENAI_COMPLETION_PRESENCE_PENALTY,
  stop = config.OPENAI_COMPLETION_STOP_SEQUENCES,
  responseFormat = null,
}) => {
  const resolvedModel = hasImage({ messages }) ? config.OPENAI_VISION_MODEL : model;
  // GPT-5 是 reasoning 模型，Chat Completions 對它換了一組參數：token 上限叫
  // `max_completion_tokens`（送 `max_tokens` 會被拒），而 frequency/presence
  // penalty 不再接受。送舊參數不是「被忽略」而是整個請求 400，所以要分流。
  // 取自上游 PR #365（memochou1993/gpt-ai-assistant），依本 fork 多出的 stop /
  // response_format 欄位改寫。
  const isReasoningModel = /^gpt-5/.test(resolvedModel);
  const body = {
    model: resolvedModel,
    messages,
    temperature,
    ...(isReasoningModel
      ? { max_completion_tokens: maxTokens }
      : {
        max_tokens: maxTokens,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
      }),
    stop,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
  return client.post('/v1/chat/completions', body);
};

const createImage = ({
  model = config.OPENAI_IMAGE_GENERATION_MODEL,
  prompt,
  size = config.OPENAI_IMAGE_GENERATION_SIZE,
  quality = config.OPENAI_IMAGE_GENERATION_QUALITY,
  n = 1,
}) => {
  // set image size to 1024 when using the DALL-E 3 model and the requested size is 256 or 512.
  if (model === MODEL_DALL_E_3 && [IMAGE_SIZE_256, IMAGE_SIZE_512].includes(size)) {
    size = IMAGE_SIZE_1024;
  }

  return client.post('/v1/images/generations', {
    model,
    prompt,
    size,
    quality,
    n,
  }, {
    timeout: config.OPENAI_IMAGE_GENERATION_TIMEOUT,
  });
};

const createAudioTranscriptions = ({
  buffer,
  file,
  model = config.OPENAI_TRANSCRIPTION_MODEL,
}) => {
  const formData = new FormData();
  formData.append('file', buffer, file);
  formData.append('model', model);
  return client.post('/v1/audio/transcriptions', formData.getBuffer(), {
    headers: formData.getHeaders(),
  });
};

export {
  createAudioTranscriptions,
  createChatCompletion,
  createImage,
};
