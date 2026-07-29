import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@jest/globals';

const rollback = readFileSync(
  resolve(process.cwd(), 'db/rollbacks/0020_calendar_google_origin_baseline.sql'),
  'utf8',
);

test('0020 rollback cancels reminders and removes inbound events before dropping provenance', () => {
  const cancelAt = rollback.indexOf("jobs.idempotency_key like 'line-reminder:'");
  const deleteAt = rollback.indexOf('delete from events');
  const dropColumnAt = rollback.indexOf('drop column if exists inbound_origin');

  expect(cancelAt).toBeGreaterThan(-1);
  expect(deleteAt).toBeGreaterThan(cancelAt);
  expect(dropColumnAt).toBeGreaterThan(deleteAt);
});
