import { getPool } from '../services/database.js';

const { REMINDER_CRON_SECRET, REMINDER_CRON_URL } = process.env;

if (!REMINDER_CRON_SECRET || REMINDER_CRON_SECRET.length < 32) {
  throw new Error('REMINDER_CRON_SECRET must contain at least 32 characters');
}

let endpoint;
try {
  endpoint = new URL(REMINDER_CRON_URL);
} catch {
  throw new Error('REMINDER_CRON_URL must be a valid HTTPS URL');
}
if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/cron/reminders') {
  throw new Error('REMINDER_CRON_URL must be an HTTPS /cron/reminders endpoint');
}

const pool = getPool();

const upsertVaultSecret = async (name, value, description) => {
  const existing = await pool.query('SELECT id FROM vault.secrets WHERE name = $1', [name]);
  if (existing.rows[0]) {
    await pool.query(
      'SELECT vault.update_secret($1, $2, $3, $4)',
      [existing.rows[0].id, value, name, description],
    );
    return;
  }
  await pool.query('SELECT vault.create_secret($1, $2, $3)', [value, name, description]);
};

try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pg_cron');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pg_net');
  await pool.query('CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault');
  await upsertVaultSecret(
    'gpt_ai_assistant_reminder_url',
    endpoint.toString(),
    'gpt-ai-assistant reminder worker URL',
  );
  await upsertVaultSecret(
    'gpt_ai_assistant_reminder_secret',
    REMINDER_CRON_SECRET,
    'gpt-ai-assistant reminder worker bearer secret',
  );
  const command = `SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gpt_ai_assistant_reminder_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gpt_ai_assistant_reminder_secret')
    ),
    body := jsonb_build_object('scheduledAt', now()),
    timeout_milliseconds := 50000
  )`;
  await pool.query(
    "SELECT cron.schedule('gpt-ai-assistant-reminders', '* * * * *', $1)",
    [command],
  );
  console.log('configured gpt-ai-assistant-reminders');
} finally {
  await pool.end();
}
