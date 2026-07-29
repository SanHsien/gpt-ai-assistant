import config from '../config/index.js';
import { JOB_KINDS } from '../constants/jobs.js';
import { enqueueJob } from '../repositories/jobs.js';

const jobKey = (eventId, suffix, version) => (
  `line-reminder:${eventId}:${suffix}:${version}`
);

/**
 * Cancel every pending reminder for an event, including lead and recurring jobs.
 * @param {string} eventId
 * @param {Function} executor
 */
export const cancelPendingEventReminders = async (eventId, executor) => {
  await executor(
    `UPDATE jobs SET status = 'done', lease_until = null, lease_token = null, updated_at = now()
     WHERE status = 'pending' AND idempotency_key LIKE $1`,
    [`line-reminder:${eventId}:%`],
  );
};

/**
 * Schedule the at-time and configured lead reminders for one occurrence.
 * @param {{ ownerId: string, event: Object, channelTarget: Object, remindAt: Date,
 *   occurrenceStart?: string|null, occurrenceIndex?: number|null, executor?: Function }} params
 * @returns {Promise<{ startJobId: string|null, queued: number }>}
 */
export const scheduleEventReminders = async ({
  ownerId,
  event,
  channelTarget,
  remindAt,
  occurrenceStart = null,
  occurrenceIndex = null,
  executor,
}) => {
  const now = Date.now();
  const occurrenceKey = occurrenceIndex == null ? '' : `occ${occurrenceIndex}:`;
  const candidates = [
    { leadMinutes: null, runAt: remindAt, suffix: `${occurrenceKey}start` },
    ...config.REMINDER_OFFSETS.map((leadMinutes) => ({
      leadMinutes,
      runAt: new Date(remindAt.getTime() - leadMinutes * 60 * 1000),
      suffix: `${occurrenceKey}lead${leadMinutes}`,
    })),
  ];
  const validCandidates = candidates.filter((candidate) => (
    Number.isFinite(candidate.runAt.getTime()) && candidate.runAt.getTime() > now
  ));
  let startJobId = null;
  let queued = 0;
  // executor may be one transaction client; node-postgres forbids overlapping query() calls.
  for (const candidate of validCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const job = await enqueueJob({
      kind: JOB_KINDS.LINE_REMINDER,
      payload: {
        ownerId,
        eventId: event.id,
        channelTarget,
        ...(candidate.leadMinutes == null ? {} : { leadMinutes: candidate.leadMinutes }),
        ...(occurrenceStart == null ? {} : { occurrenceStart, occurrenceIndex }),
      },
      runAt: candidate.runAt,
      idempotencyKey: jobKey(event.id, candidate.suffix, event.version),
      maxAttempts: config.WORKER_MAX_ATTEMPTS,
    }, executor);
    if (job) {
      queued += 1;
      if (candidate.leadMinutes == null) startJobId = job.id;
    }
  }
  return {
    startJobId,
    queued,
  };
};

export default { cancelPendingEventReminders, scheduleEventReminders };
