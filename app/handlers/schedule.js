import { randomUUID } from 'node:crypto';
import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import {
  createConfirmation,
  getLatestPendingClarification,
  getLatestPendingConfirmation,
  getLatestPendingWorkflow,
  settleConfirmation,
  updateConfirmationDraft,
} from '../../repositories/confirmations.js';
import { hasCalendarAccount } from '../../repositories/calendar-accounts.js';
import {
  completeEvent,
  completeEventByProviderId,
  deleteEvent,
  deleteEventByProviderId,
  enqueueEventSyncRetry,
  getEvent,
  getEventByReferenceForUpdate,
  listEventConflicts,
  listEvents,
  listSyncFailedEvents,
} from '../../repositories/events.js';
import { getUserByKey, upsertUser } from '../../repositories/users.js';
import { CONFIRMATION_ACTIONS, CONFIRMATION_STATES } from '../../services/confirmation.js';
import { isDatabaseConfigured, withTransaction } from '../../services/database.js';
import {
  createGoogleAuthorizationUrl,
  completeGoogleEvent,
  deleteGoogleEvent,
  isGoogleCalendarConfigured,
  listGoogleEvents,
  toGoogleEvent,
  unlinkGoogleCalendar,
} from '../../services/google-calendar.js';
import { parseSchedule } from '../../services/schedule.js';
import {
  COMMAND_BOT_GOOGLE_CALENDAR,
  COMMAND_BOT_GOOGLE_UNLINK,
  COMMAND_BOT_SCHEDULE,
  COMMAND_BOT_SCHEDULE_CANCEL,
  COMMAND_BOT_SCHEDULE_COMPLETE,
  COMMAND_BOT_SCHEDULE_CONFIRM,
  COMMAND_BOT_SCHEDULE_DELETE,
  COMMAND_BOT_SCHEDULE_EDIT,
  COMMAND_BOT_SCHEDULE_LIST,
  COMMAND_BOT_SCHEDULE_SYNC_DISMISS,
  COMMAND_BOT_SCHEDULE_SYNC_FAILED,
  COMMAND_BOT_SCHEDULE_SYNC_RETRY,
  COMMAND_BOT_TIMEZONE,
} from '../commands/index.js';

const SCHEDULE_COMMANDS = [
  COMMAND_BOT_GOOGLE_CALENDAR,
  COMMAND_BOT_GOOGLE_UNLINK,
  COMMAND_BOT_TIMEZONE,
  COMMAND_BOT_SCHEDULE_LIST,
  COMMAND_BOT_SCHEDULE_SYNC_FAILED,
  COMMAND_BOT_SCHEDULE_SYNC_RETRY,
  COMMAND_BOT_SCHEDULE_SYNC_DISMISS,
  COMMAND_BOT_SCHEDULE_COMPLETE,
  COMMAND_BOT_SCHEDULE_DELETE,
  COMMAND_BOT_SCHEDULE_EDIT,
  COMMAND_BOT_SCHEDULE_CONFIRM,
  COMMAND_BOT_SCHEDULE_CANCEL,
  COMMAND_BOT_SCHEDULE,
];

const IMPLICIT_SCHEDULE_DATE = /^(?:(?:\d{4}[/-])?\d{1,2}[/-]\d{1,2}|(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|今天|明天|後天|大後天|今晚|明早|明晚|(?:(?:本|這|下)(?:個)?)?(?:星期|週|周)[一二三四五六日天])/u;
const QUESTION_ENDING = /[?？]\s*$/u;
const QUESTION_PHRASE = /(?:嗎|呢|如何|怎麼|為什麼|多少|幾[點號]|哪(?:天|裡|個)|會不會|是不是|是否)\s*[?？]?$/u;
const NON_EVENT_DETAIL = /^(?:[+*/=]|是(?:多少|什麼|幾)|等於|多少|幾號|怎麼|如何|為什麼|可不可以|能不能)/u;

const isImplicitSchedule = (text) => {
  const value = text.trim();
  if (QUESTION_ENDING.test(value) || QUESTION_PHRASE.test(value)) return false;
  const date = value.match(IMPLICIT_SCHEDULE_DATE)?.[0];
  if (!date) return false;
  const detail = value.slice(date.length).trim();
  return detail.length >= 2 && !NON_EVENT_DETAIL.test(detail);
};

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => (
  SCHEDULE_COMMANDS.some((command) => context.hasCommand(command))
  || (config.ENABLE_SCHEDULE && isImplicitSchedule(context.trimmedText))
);

/**
 * 去掉觸發指令（含 alias）後剩下的內容。
 */
const stripCommand = (text, command) => {
  const lower = text.toLowerCase();
  const prefix = [command.text, ...command.aliases]
    .find((alias) => lower.startsWith(alias.toLowerCase()));
  return (prefix ? text.slice(prefix.length) : text).trim();
};

const stripTrailingMarks = (text) => text.replace(/[。！？.!?]+$/u, '').trim();

const confirmationAction = (command, token) => ({
  label: command.label,
  data: `${command.text} ${token}`,
  displayText: command.text,
});

const isValidTimezone = (timezone) => {
  try {
    // 無效的 IANA 名稱會讓 Intl 丟 RangeError。
    Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

const formatDateTime = (value, timezone, allDay) => new Intl.DateTimeFormat('zh-TW', {
  timeZone: timezone,
  dateStyle: 'medium',
  ...(allDay ? {} : { timeStyle: 'short' }),
}).format(new Date(value));

/**
 * 行程摘要。draft 用 start/end，DB 取回的 event 用 start_at/end_at，兩者都吃。
 */
const formatSummary = ({
  title, start, start_at: startAt, end, end_at: endAt, allDay, all_day: allDayColumn, location,
}, timezone) => {
  const isAllDay = allDay ?? allDayColumn ?? false;
  const lines = [title];
  const from = start ?? startAt;
  const to = end ?? endAt;
  lines.push(`${formatDateTime(from, timezone, isAllDay)}${isAllDay ? `（${t('__TEXT_SCHEDULE_ALL_DAY')}）` : ''}`);
  if (to) lines.push(`至 ${formatDateTime(to, timezone, isAllDay)}`);
  if (location) lines.push(location);
  return lines.join('\n');
};

const eventToDraft = (event) => ({
  title: event.title,
  start: event.start_at,
  end: event.end_at ?? null,
  allDay: event.all_day === true,
  timezone: event.timezone ?? null,
  location: event.location ?? null,
  notes: event.notes ?? null,
  recurrence: event.recurrence ?? null,
});

const clarificationText = (missingFields) => {
  const first = missingFields[0];
  const keys = {
    title: '__TEXT_SCHEDULE_CLARIFY_TITLE',
    date: '__TEXT_SCHEDULE_CLARIFY_DATE',
    time: '__TEXT_SCHEDULE_CLARIFY_TIME',
    endDate: '__TEXT_SCHEDULE_CLARIFY_END_DATE',
    endTime: '__TEXT_SCHEDULE_CLARIFY_END_TIME',
    changes: '__TEXT_SCHEDULE_EDIT_PROMPT',
  };
  return t(keys[first] || '__ERROR_SCHEDULE_PARSE');
};

const pushDraftConfirmation = async (context, owner, timezone, workflow, draft) => {
  const conflicts = await listEventConflicts(owner.id, draft, {
    excludeEventId: workflow.operation === 'update' ? workflow.target_event_id : null,
  });
  const heading = workflow.operation === 'update'
    ? t('__TEXT_SCHEDULE_EDIT_CONFIRM')
    : t('__TEXT_SCHEDULE_CONFIRM');
  const warning = conflicts.length > 0 ? `${t('__TEXT_SCHEDULE_CONFLICT_WARNING')}\n` : '';
  // 語音建行程：回顯轉錄原文，讓使用者分辨「聽錯」與「解析錯」，確認前即可發現。
  const heard = context.event?.isAudio && context.transcription
    ? `${t('__TEXT_SCHEDULE_HEARD')(context.transcription.trim())}\n`
    : '';
  context.pushTemplate(
    `${heard}${warning}${heading}\n${formatSummary(draft, timezone)}`,
    [
      confirmationAction(COMMAND_BOT_SCHEDULE_CONFIRM, workflow.token),
      confirmationAction(COMMAND_BOT_SCHEDULE_CANCEL, workflow.token),
    ],
  );
  return context;
};

const setTimezone = async (context, owner) => {
  const requested = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_TIMEZONE));
  if (!requested) {
    context.pushText(t('__TEXT_TIMEZONE_USAGE'));
    return context;
  }
  if (!isValidTimezone(requested)) {
    context.pushText(t('__ERROR_TIMEZONE_INVALID'));
    return context;
  }
  await upsertUser({ channelUserKey: context.userId, timezone: requested });
  context.pushText(`${t('__TEXT_TIMEZONE_SET')} ${requested}`);
  return context;
};

const listUpcoming = async (context, owner, timezone) => {
  const events = config.ENABLE_GOOGLE_CALENDAR
    ? await listGoogleEvents(owner.id, { timeMin: new Date().toISOString(), maxResults: 6 })
    : await listEvents(owner.id, { from: new Date().toISOString(), limit: 6 });
  if (events.length === 0) {
    context.pushText(t('__TEXT_SCHEDULE_LIST_EMPTY'));
    return context;
  }
  const body = events
    .map((event, i) => `${i + 1}. ${formatSummary(event, timezone).replace(/\n/g, ' ')}`)
    .join('\n');
  // 每筆兩個 action，六筆共十二個，保持在 LINE quick reply 的 13 項上限內。
  const actions = events.flatMap((event, i) => ([
    {
      label: `${t('__LABEL_SCHEDULE_COMPLETE')} ${i + 1}`,
      data: `${COMMAND_BOT_SCHEDULE_COMPLETE.text} ${event.id}`,
      displayText: `${COMMAND_BOT_SCHEDULE_COMPLETE.text} ${i + 1}`,
    },
    {
      label: `${t('__LABEL_SCHEDULE_DELETE')} ${i + 1}`,
      data: `${COMMAND_BOT_SCHEDULE_DELETE.text} ${event.id}`,
      displayText: `${t('__LABEL_SCHEDULE_DELETE_EVENT')} ${i + 1}`,
    },
  ]));
  context.pushText(`${t('__TEXT_SCHEDULE_LIST_HEADER')}\n${body}`, actions);
  return context;
};

const editScheduledEvent = async (context, owner, timezone) => {
  const id = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_SCHEDULE_EDIT));
  if (!id) {
    const events = await listEvents(owner.id, { from: new Date().toISOString(), limit: 6 });
    if (events.length === 0) {
      context.pushText(t('__TEXT_SCHEDULE_LIST_EMPTY'));
      return context;
    }
    const body = events
      .map((event, i) => `${i + 1}. ${formatSummary(event, timezone).replace(/\n/g, ' ')}`)
      .join('\n');
    const actions = events.map((event, i) => ({
      label: `${t('__LABEL_SCHEDULE_EDIT')} ${i + 1}`,
      data: `${COMMAND_BOT_SCHEDULE_EDIT.text} ${event.id}`,
      displayText: `${COMMAND_BOT_SCHEDULE_EDIT.text} ${i + 1}`,
    }));
    context.pushText(`${t('__TEXT_SCHEDULE_EDIT_LIST_HEADER')}\n${body}`, actions);
    return context;
  }
  const event = await getEvent(owner.id, id);
  if (!event || event.status !== 'confirmed') {
    context.pushText(t('__TEXT_SCHEDULE_EDIT_NOTFOUND'));
    return context;
  }
  const token = randomUUID();
  await createConfirmation({
    ownerId: owner.id,
    token,
    draft: eventToDraft(event),
    expiresAt: new Date(Date.now() + config.SCHEDULE_CONFIRM_TTL * 1000),
    operation: 'update',
    targetEventId: event.id,
    expectedVersion: event.version,
    missingFields: ['changes'],
  });
  context.pushText(t('__TEXT_SCHEDULE_EDIT_PROMPT'), [
    confirmationAction(COMMAND_BOT_SCHEDULE_CANCEL, token),
  ]);
  return context;
};

const listFailedSyncs = async (context, owner, timezone) => {
  const events = await listSyncFailedEvents(owner.id, 6);
  if (events.length === 0) {
    context.pushText(t('__TEXT_SCHEDULE_SYNC_FAILED_EMPTY'));
    return context;
  }
  const body = events
    .map((event, i) => `${i + 1}. ${formatSummary(event, timezone).replace(/\n/g, ' ')}`)
    .join('\n');
  const actions = events.flatMap((event, i) => ([
    {
      label: `${t('__LABEL_SCHEDULE_RETRY_SYNC')} ${i + 1}`,
      data: `${COMMAND_BOT_SCHEDULE_SYNC_RETRY.text} ${event.id}`,
      displayText: COMMAND_BOT_SCHEDULE_SYNC_RETRY.text,
    },
    {
      label: `${t('__LABEL_SCHEDULE_DELETE')} ${i + 1}`,
      data: `${COMMAND_BOT_SCHEDULE_DELETE.text} ${event.id}`,
      displayText: t('__LABEL_SCHEDULE_DELETE_EVENT'),
    },
  ]));
  context.pushText(`${t('__TEXT_SCHEDULE_SYNC_FAILED_HEADER')}\n${body}`, actions);
  return context;
};

const retryGoogleSync = async (context, owner) => {
  const id = stripTrailingMarks(stripCommand(
    context.trimmedText,
    COMMAND_BOT_SCHEDULE_SYNC_RETRY,
  ));
  if (!id) {
    context.pushText(t('__TEXT_SCHEDULE_SYNC_RETRY_USAGE'));
    return context;
  }
  const event = await getEvent(owner.id, id);
  if (!event || event.status !== 'confirmed' || event.sync_status !== 'error') {
    if (event?.sync_status === 'synced') {
      context.pushText(t('__TEXT_SCHEDULE_SYNC_ALREADY_DONE'));
    } else if (event?.sync_status === 'pending') {
      context.pushText(t('__TEXT_SCHEDULE_SYNC_IN_PROGRESS'));
    } else {
      context.pushText(t('__TEXT_SCHEDULE_SYNC_NOTFOUND'));
    }
    return context;
  }
  const queued = await enqueueEventSyncRetry({
    ownerId: owner.id,
    eventId: event.id,
    notificationTarget: context.id,
  });
  if (!queued) context.pushText(t('__TEXT_SCHEDULE_SYNC_IN_PROGRESS'));
  // 不發「已重試」的過渡訊息；成功或最終失敗才通知。
  return context;
};

const dismissFailedSync = async (context, owner) => {
  const id = stripTrailingMarks(stripCommand(
    context.trimmedText,
    COMMAND_BOT_SCHEDULE_SYNC_DISMISS,
  ));
  const event = id ? await getEvent(owner.id, id) : null;
  if (!event || event.sync_status !== 'error') {
    context.pushText(t('__TEXT_SCHEDULE_SYNC_NOTFOUND'));
    return context;
  }
  // 同步失敗本來就只通知一次；此操作不改行程、不刪資料。
  context.pushText(t('__TEXT_SCHEDULE_SYNC_DISMISSED'));
  return context;
};

const completeScheduledEvent = async (context, owner) => {
  const id = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_SCHEDULE_COMPLETE));
  if (!id) {
    context.pushText(t('__TEXT_SCHEDULE_COMPLETE_USAGE'));
    return context;
  }
  let completed;
  if (config.ENABLE_GOOGLE_CALENDAR) {
    const result = await withTransaction(async (client) => {
      const executor = client.query.bind(client);
      const localEvent = await getEventByReferenceForUpdate(owner.id, id, executor);
      if (!localEvent) return { found: false, completed: false };
      // client-specified id 可涵蓋「Google 已建立、但 provider id 尚未 checkpoint」的狀況。
      const providerEventId = localEvent.provider_event_id || toGoogleEvent(localEvent).id;
      await completeGoogleEvent(owner.id, providerEventId);
      return {
        found: true,
        completed: Boolean(await completeEvent(owner.id, localEvent.id, executor)),
      };
    });
    completed = result.completed;
    if (!result.found) {
      completed = await completeGoogleEvent(owner.id, id);
      if (completed) await completeEventByProviderId(owner.id, id);
    }
  } else {
    completed = Boolean(await completeEvent(owner.id, id));
  }
  context.pushText(completed
    ? t('__TEXT_SCHEDULE_COMPLETED')
    : t('__TEXT_SCHEDULE_COMPLETE_NOTFOUND'));
  return context;
};

const removeEvent = async (context, owner) => {
  const id = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_SCHEDULE_DELETE));
  if (!id) {
    context.pushText(t('__TEXT_SCHEDULE_DELETE_USAGE'));
    return context;
  }
  let deleted;
  if (!config.ENABLE_GOOGLE_CALENDAR) {
    deleted = await deleteEvent(owner.id, id);
  } else {
    const result = await withTransaction(async (client) => {
      const executor = client.query.bind(client);
      const localEvent = await getEventByReferenceForUpdate(owner.id, id, executor);
      if (!localEvent) return { found: false, deleted: false };
      const providerEventId = localEvent.provider_event_id || toGoogleEvent(localEvent).id;
      await deleteGoogleEvent(owner.id, providerEventId);
      return {
        found: true,
        deleted: await deleteEvent(owner.id, localEvent.id, executor),
      };
    });
    deleted = result.deleted;
    if (!result.found) {
      const remoteDeleted = await deleteGoogleEvent(owner.id, id);
      const localDeleted = await deleteEventByProviderId(owner.id, id);
      deleted = remoteDeleted || localDeleted;
    }
  }
  context.pushText(deleted ? t('__TEXT_SCHEDULE_DELETED') : t('__TEXT_SCHEDULE_DELETE_NOTFOUND'));
  return context;
};

const settle = async (context, owner, timezone, isConfirm) => {
  const command = isConfirm ? COMMAND_BOT_SCHEDULE_CONFIRM : COMMAND_BOT_SCHEDULE_CANCEL;
  const requestedToken = stripTrailingMarks(stripCommand(context.trimmedText, command));
  // 帶 token 的按鈕只結算自己那張卡；沒帶 token 的裸指令才退回最新草稿。
  const pending = requestedToken ? null : await (
    isConfirm
      ? getLatestPendingConfirmation(owner.id)
      : getLatestPendingWorkflow(owner.id)
  );
  const token = requestedToken || pending?.token;
  if (!token) {
    context.pushText(t('__TEXT_SCHEDULE_NOTHING_PENDING'));
    return context;
  }
  // 實際的 exactly-once 由 settleConfirmation 的 row lock 保證。
  const result = await settleConfirmation({
    ownerId: owner.id,
    token,
    action: isConfirm ? CONFIRMATION_ACTIONS.CONFIRM : CONFIRMATION_ACTIONS.CANCEL,
    notificationTarget: context.id,
  });
  if (!result) {
    context.pushText(t('__TEXT_SCHEDULE_NOTHING_PENDING'));
    return context;
  }
  if (result.state === CONFIRMATION_STATES.CONFIRMED && result.event) {
    if (result.syncQueued) return context;
    const message = result.operation === 'update'
      ? t('__TEXT_SCHEDULE_UPDATED')
      : t('__TEXT_SCHEDULE_CREATED');
    context.pushText(`${message}\n${formatSummary(result.event, timezone)}`);
    return context;
  }
  if (result.state === 'conflict') {
    context.pushText(t('__TEXT_SCHEDULE_EDIT_CONFLICT'));
    return context;
  }
  context.pushText(t('__TEXT_SCHEDULE_CANCELLED'));
  return context;
};

const connectGoogleCalendar = async (context, owner) => {
  if (!isGoogleCalendarConfigured()) {
    context.pushText(t('__ERROR_FEATURE_DISABLED'));
    return context;
  }
  const uri = await createGoogleAuthorizationUrl(owner.id);
  context.pushTemplate(t('__TEXT_GOOGLE_CALENDAR_CONNECT'), [{
    label: t('__LABEL_GOOGLE_CALENDAR_CONNECT'),
    uri,
  }]);
  return context;
};

const disconnectGoogleCalendar = async (context, owner) => {
  if (!isGoogleCalendarConfigured()) {
    context.pushText(t('__ERROR_FEATURE_DISABLED'));
    return context;
  }
  const unlinked = await unlinkGoogleCalendar(owner.id);
  context.pushText(t(unlinked ? '__TEXT_GOOGLE_CALENDAR_UNLINKED' : '__TEXT_GOOGLE_CALENDAR_NOT_LINKED'));
  return context;
};

const createDraft = async (context, owner, timezone) => {
  const text = stripCommand(context.trimmedText, COMMAND_BOT_SCHEDULE);
  if (!text) {
    context.pushText(t('__TEXT_SCHEDULE_USAGE'));
    return context;
  }
  const result = await parseSchedule({ text, timezone });
  const {
    valid, value, needsClarification = false, missingFields = [],
  } = result;
  const token = randomUUID();
  if (needsClarification && value) {
    await createConfirmation({
      ownerId: owner.id,
      token,
      draft: value,
      expiresAt: new Date(Date.now() + config.SCHEDULE_CONFIRM_TTL * 1000),
      operation: 'create',
      missingFields,
    });
    context.pushText(clarificationText(missingFields), [
      confirmationAction(COMMAND_BOT_SCHEDULE_CANCEL, token),
    ]);
    return context;
  }
  if (!valid) {
    context.pushText(t('__ERROR_SCHEDULE_PARSE'));
    return context;
  }
  await createConfirmation({
    ownerId: owner.id,
    token,
    draft: value,
    expiresAt: new Date(Date.now() + config.SCHEDULE_CONFIRM_TTL * 1000),
  });
  return pushDraftConfirmation(context, owner, timezone, { token, operation: 'create' }, value);
};

const continueClarification = async (context, owner, timezone, pending) => {
  const operation = pending.operation || 'create';
  const result = await parseSchedule({
    text: context.trimmedText,
    timezone,
    mode: operation,
    baseDraft: pending.draft,
  });
  if (result.needsClarification && result.value) {
    await updateConfirmationDraft({
      ownerId: owner.id,
      token: pending.token,
      draft: result.value,
      missingFields: result.missingFields,
    });
    context.pushText(clarificationText(result.missingFields), [
      confirmationAction(COMMAND_BOT_SCHEDULE_CANCEL, pending.token),
    ]);
    return context;
  }
  if (!result.valid) {
    context.pushText(t('__ERROR_SCHEDULE_PARSE'));
    return context;
  }
  await updateConfirmationDraft({
    ownerId: owner.id,
    token: pending.token,
    draft: result.value,
    missingFields: [],
  });
  return pushDraftConfirmation(context, owner, timezone, pending, result.value);
};

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const executeCommand = async (context) => {
  // 行程需要 durable 儲存；沒有 DB 時不假裝成功。
  if (!config.ENABLE_SCHEDULE || !isDatabaseConfigured()) {
    context.pushText(t('__ERROR_FEATURE_DISABLED'));
    return context;
  }
  try {
    const owner = await upsertUser({
      channelUserKey: context.userId,
      channelTarget: config.ENABLE_REMINDERS ? context.userId : null,
    });
    const timezone = owner.timezone || config.SCHEDULE_DEFAULT_TIMEZONE;

    if (context.hasCommand(COMMAND_BOT_GOOGLE_UNLINK)) {
      return await disconnectGoogleCalendar(context, owner);
    }
    if (context.hasCommand(COMMAND_BOT_GOOGLE_CALENDAR)) {
      return await connectGoogleCalendar(context, owner);
    }
    if (context.hasCommand(COMMAND_BOT_TIMEZONE)) return await setTimezone(context, owner);
    if (config.ENABLE_GOOGLE_CALENDAR) {
      if (!isGoogleCalendarConfigured()) {
        context.pushText(t('__ERROR_FEATURE_DISABLED'));
        return context;
      }
      if (!await hasCalendarAccount(owner.id)) {
        return await connectGoogleCalendar(context, owner);
      }
    }
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_LIST)) return await listUpcoming(context, owner, timezone);
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_SYNC_FAILED)) {
      return await listFailedSyncs(context, owner, timezone);
    }
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_SYNC_RETRY)) {
      return await retryGoogleSync(context, owner);
    }
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_SYNC_DISMISS)) {
      return await dismissFailedSync(context, owner);
    }
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_COMPLETE)) {
      return await completeScheduledEvent(context, owner);
    }
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_DELETE)) return await removeEvent(context, owner);
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_EDIT)) {
      return await editScheduledEvent(context, owner, timezone);
    }
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_CONFIRM)) return await settle(context, owner, timezone, true);
    if (context.hasCommand(COMMAND_BOT_SCHEDULE_CANCEL)) return await settle(context, owner, timezone, false);
    return await createDraft(context, owner, timezone);
  } catch (err) {
    context.pushError(err);
  }
  return context;
};

const resumePendingClarification = async (context) => {
  try {
    const owner = await getUserByKey(context.userId);
    if (!owner) return false;
    const pending = await getLatestPendingClarification(owner.id);
    if (!pending) return false;
    const timezone = owner.timezone || config.SCHEDULE_DEFAULT_TIMEZONE;
    return await continueClarification(context, owner, timezone, pending);
  } catch (err) {
    context.pushError(err);
    return context;
  }
};

const exec = (context) => {
  if (check(context)) return executeCommand(context);
  if (!config.ENABLE_SCHEDULE || !isDatabaseConfigured()) return false;
  return resumePendingClarification(context);
};

export default exec;
