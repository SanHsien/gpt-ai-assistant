import pg from 'pg';
import config from '../config/index.js';

// 6.0 durable-only 基礎：Supabase Postgres 連線（`pg` 直連，支援交易與列鎖）。
// 未設定 `DATABASE_URL` 或 migration 未到最新版時，runtime preflight 會拒絕流量。
// Serverless 部署請用 Supabase 的 connection pooler 連線字串。

let pool = null;

// pooler 是 `*.pooler.supabase.com`，direct connection 是 `db.<ref>.supabase.co`——兩者都要強制驗證 CA。
const isSupabaseUrl = (value) => {
  try {
    const { hostname } = new URL(value);
    return hostname.endsWith('.supabase.com') || hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
};

const getSslOptions = () => {
  if (!isSupabaseUrl(config.DATABASE_URL)) return undefined;
  if (!config.DATABASE_SSL_CA) {
    throw new Error('DATABASE_SSL_CA is required for verified Supabase TLS');
  }
  return {
    ca: config.DATABASE_SSL_CA.replace(/\\n/g, '\n'),
    rejectUnauthorized: true,
  };
};

/**
 * @returns {boolean} 是否已設定 DATABASE_URL。
 */
export const isDatabaseConfigured = () => Boolean(config.DATABASE_URL);

/**
 * 取得（並快取）pg Pool；未設定 DATABASE_URL 時 fail closed。
 * @returns {import('pg').Pool}
 */
export const getPool = () => {
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to use the database');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      ssl: getSslOptions(),
    });
  }
  return pool;
};

/**
 * 執行參數化查詢（一律用參數，不字串拼接）。
 * @param {string} text
 * @param {Array<*>} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
export const query = (text, params) => getPool().query(text, params);

/**
 * 在單一 client 上執行交易；callback 丟錯時必定 rollback 並原樣拋出。
 * @param {(client: import('pg').PoolClient) => Promise<*>} fn
 * @returns {Promise<*>}
 */
export const withTransaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error; a broken connection may also reject rollback.
    }
    throw err;
  } finally {
    client.release();
  }
};

export default {
  isDatabaseConfigured, getPool, query, withTransaction,
};
