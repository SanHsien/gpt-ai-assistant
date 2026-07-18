import crypto from 'node:crypto';
import config from '../config/index.js';

const getKey = () => {
  if (!config.DATA_ENCRYPTION_KEY) {
    throw new Error('DATA_ENCRYPTION_KEY is required for durable private data');
  }
  const key = Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
};

/**
 * 將 LINE channel user id 轉成 deployment-scoped 穩定代碼，DB 不保存原始 id。
 * @param {string} channelUserId
 * @returns {string}
 */
export const deriveChannelUserKey = (channelUserId) => {
  if (typeof channelUserId !== 'string' || channelUserId.length === 0) {
    throw new Error('channelUserId is required');
  }
  return `v1:${crypto.createHmac('sha256', getKey())
    .update('channel-user:v1\0')
    .update(channelUserId)
    .digest('hex')}`;
};

/**
 * @param {*} value
 * @returns {{ v: number, alg: string, iv: string, tag: string, data: string }}
 */
export const encryptJson = (value) => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('job payload must be JSON serializable');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(encoded, 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
};

/**
 * @param {{ v: number, alg: string, iv: string, tag: string, data: string }} envelope
 * @returns {*}
 */
export const decryptJson = (envelope) => {
  if (envelope?.v !== 1 || envelope?.alg !== 'A256GCM') {
    throw new Error('unsupported encrypted payload');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decoded = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(decoded);
};

export default { deriveChannelUserKey, encryptJson, decryptJson };
