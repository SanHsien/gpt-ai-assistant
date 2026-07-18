import { Buffer } from 'buffer';
import { issueSignedToken, presignUrl, put } from '@vercel/blob';
import config from '../config/index.js';

const SIGNED_URL_TTL_MS = (7 * 24 * 60 - 5) * 60 * 1000;

/**
 * 把 base64 圖片上傳到 private Vercel Blob，回傳限時 signed GET URL 給 LINE。
 * 用於 GPT Image 回傳 `b64_json` 而非 URL 的情況。
 *
 * 認證由 `@vercel/blob` 解析：優先用明確傳入的 `BLOB_READ_WRITE_TOKEN`；未設定時，
 * 在 Vercel 上會自動改用 OIDC（連結 Blob store 後注入的 `BLOB_STORE_ID` + 執行期 OIDC token）。
 * 因此在 Vercel 連結 store 的情況下通常不需要 `BLOB_READ_WRITE_TOKEN`；本機/非 Vercel 環境才需要。
 * @param {string} b64
 * @returns {Promise<string>}
 */
const uploadImage = async (b64) => {
  const buffer = Buffer.from(b64, 'base64');
  const pathname = `generated/${Date.now()}.png`;
  const options = {
    access: 'private',
    addRandomSuffix: true,
    contentType: 'image/png',
  };
  if (config.BLOB_READ_WRITE_TOKEN) options.token = config.BLOB_READ_WRITE_TOKEN;
  const blob = await put(pathname, buffer, options);
  const validUntil = Date.now() + SIGNED_URL_TTL_MS;
  const signedTokenOptions = {
    pathname: blob.pathname,
    operations: ['get'],
    validUntil,
  };
  if (config.BLOB_READ_WRITE_TOKEN) {
    signedTokenOptions.token = config.BLOB_READ_WRITE_TOKEN;
  }
  const signedToken = await issueSignedToken(signedTokenOptions);
  const { presignedUrl } = await presignUrl(signedToken, {
    access: 'private',
    operation: 'get',
    pathname: blob.pathname,
    validUntil,
  });
  return presignedUrl;
};

export default uploadImage;
