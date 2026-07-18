import config from '../../config/index.js';
import { JOB_KINDS } from '../../constants/jobs.js';
import { t } from '../../locales/index.js';
import { enqueueJob } from '../../repositories/jobs.js';
import {
  completeTask,
  createTask,
  deleteTaskAndReturn,
  getTask,
  listTasks,
  markTaskSyncPending,
  reopenTask,
} from '../../repositories/tasks.js';
import { upsertUser } from '../../repositories/users.js';
import { isDatabaseConfigured, withTransaction } from '../../services/database.js';
import { hasTasksScope, isGoogleTasksEnabled } from '../../services/google-tasks.js';
import { parseTaskDraft } from '../../services/task-parser.js';
import {
  COMMAND_BOT_TASK,
  COMMAND_BOT_TASK_DELETE,
  COMMAND_BOT_TASK_DONE,
  COMMAND_BOT_TASK_LIST,
  COMMAND_BOT_TASK_REOPEN,
} from '../commands/index.js';

// 每頁最多 6 筆：LINE quick reply 上限 13 = 6 筆 × 2 個動作 + 1 個「下一頁」。
const PAGE_SIZE = config.TASK_LIST_LIMIT;

const TASK_COMMANDS = [
  COMMAND_BOT_TASK_LIST,
  COMMAND_BOT_TASK_REOPEN,
  COMMAND_BOT_TASK_DONE,
  COMMAND_BOT_TASK_DELETE,
  COMMAND_BOT_TASK,
];

const PRIORITY_LABELS = { high: '🔴', low: '⚪' };

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => TASK_COMMANDS.some((command) => context.hasCommand(command));

const stripCommand = (text, command) => {
  const lower = text.toLowerCase();
  const prefix = [command.text, ...command.aliases]
    .find((alias) => lower.startsWith(alias.toLowerCase()));
  return (prefix ? text.slice(prefix.length) : text).trim();
};

const stripTrailingMarks = (text) => text.replace(/[。！？.!?]+$/u, '').trim();

// 若已啟用 Google Tasks 且帳號有 tasks scope，把任務變更入列同步 job（durable outbox、冪等鍵）。
// 同步失敗只影響 Google 端，本機任務一律保留。
const canSyncTasks = (ownerId) => (
  isGoogleTasksEnabled() && hasTasksScope(ownerId)
);

const enqueueTaskSyncJob = (ownerId, task, action, executor) => {
  const job = {
    kind: JOB_KINDS.GOOGLE_TASKS_SYNC,
    payload: {
      ownerId,
      taskId: task.id,
      action,
      ...(action === 'delete' ? { providerTaskId: task.provider_task_id } : {}),
    },
    idempotencyKey: `google-tasks-sync:${task.id}:${task.version}:${action}`,
    maxAttempts: config.WORKER_MAX_ATTEMPTS,
  };
  return executor ? enqueueJob(job, executor) : enqueueJob(job);
};

const enqueueTaskSync = async (ownerId, task, action) => {
  if (!task || !(await canSyncTasks(ownerId))) return false;
  if (action === 'upsert') await markTaskSyncPending(ownerId, task.id);
  await enqueueTaskSyncJob(ownerId, task, action);
  return true;
};

const formatDueDate = (value, timezone) => new Intl.DateTimeFormat('zh-TW', {
  timeZone: timezone,
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const formatTaskLine = (task, timezone) => {
  const mark = PRIORITY_LABELS[task.priority] ? `${PRIORITY_LABELS[task.priority]} ` : '';
  const tags = (task.tags || []).length > 0 ? ` ${task.tags.map((tag) => `#${tag}`).join(' ')}` : '';
  if (!task.due_at) return `${mark}${task.title}${tags}`;
  const overdue = new Date(task.due_at).getTime() < Date.now();
  const due = `（${formatDueDate(task.due_at, timezone)}${overdue ? ` ${t('__LABEL_TASK_OVERDUE')}` : ''}）`;
  return `${mark}${task.title}${due}${tags}`;
};

const timezoneParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
};

const timezoneOffset = (date, timezone) => {
  const parts = timezoneParts(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
};

const localMidnightUtc = (timezone, baseDate, plusDays = 0) => {
  const { year, month, day } = timezoneParts(baseDate, timezone);
  const wallClock = Date.UTC(year, month - 1, day + plusDays);
  let instant = new Date(wallClock - timezoneOffset(new Date(wallClock), timezone));
  instant = new Date(wallClock - timezoneOffset(instant, timezone));
  return instant;
};

// 週一為一週開始、週日為結束（台灣慣例）。回傳到本週日還有幾天。
const localWeekday = (date, timezone) => {
  const { year, month, day } = timezoneParts(date, timezone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const FILTER_ALIASES = {
  今天: 'today',
  今日: 'today',
  明天: 'tomorrow',
  明日: 'tomorrow',
  本週: 'week',
  這週: 'week',
  本周: 'week',
  這周: 'week',
  本星期: 'week',
  這星期: 'week',
  這個星期: 'week',
  下週: 'nextWeek',
  下周: 'nextWeek',
  下星期: 'nextWeek',
  下個星期: 'nextWeek',
  逾期: 'overdue',
  過期: 'overdue',
  已完成: 'done',
  完成: 'done',
  today: 'today',
  tomorrow: 'tomorrow',
  'this week': 'week',
  'next week': 'nextWeek',
  overdue: 'overdue',
  completed: 'done',
  done: 'done',
  今日中: 'today',
  今週: 'week',
  来週: 'nextWeek',
  期限切れ: 'overdue',
  完了済み: 'done',
};

const detectFilter = (text) => FILTER_ALIASES[text.toLowerCase()] || null;

const filterDueRange = (filter, timezone, now = new Date()) => {
  if (filter === 'overdue') return { dueAfter: null, dueBefore: now };
  if (filter === 'today') {
    return {
      dueAfter: localMidnightUtc(timezone, now),
      dueBefore: localMidnightUtc(timezone, now, 1),
    };
  }
  if (filter === 'tomorrow') {
    return {
      dueAfter: localMidnightUtc(timezone, now, 1),
      dueBefore: localMidnightUtc(timezone, now, 2),
    };
  }
  if (filter === 'week') {
    const weekday = localWeekday(now, timezone);
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return {
      dueAfter: localMidnightUtc(timezone, now, mondayOffset),
      dueBefore: localMidnightUtc(timezone, now, mondayOffset + 7),
    };
  }
  if (filter === 'nextWeek') {
    const weekday = localWeekday(now, timezone);
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return {
      dueAfter: localMidnightUtc(timezone, now, mondayOffset + 7),
      dueBefore: localMidnightUtc(timezone, now, mondayOffset + 14),
    };
  }
  return { dueAfter: null, dueBefore: null };
};

const FILTER_HEADERS = {
  today: '__TEXT_TASK_LIST_TODAY',
  tomorrow: '__TEXT_TASK_LIST_TOMORROW',
  week: '__TEXT_TASK_LIST_WEEK',
  nextWeek: '__TEXT_TASK_LIST_NEXT_WEEK',
  overdue: '__TEXT_TASK_LIST_OVERDUE',
  done: '__TEXT_TASK_LIST_DONE',
};

// 解析 `我的任務` 後面的參數：`今天`／`明天`／`本週`／`下週`／`逾期`／`已完成`／`#標籤`，
// 以及分頁 sentinel `…@<offset>`（由「下一頁」按鈕帶回）。
const parseListArg = (raw) => {
  const [filterPart, offsetPart] = stripTrailingMarks(raw).split('@');
  const offset = Number.isInteger(Number(offsetPart)) && Number(offsetPart) > 0 ? Number(offsetPart) : 0;
  const trimmed = filterPart.trim();
  if (!trimmed) return { filter: null, offset, valid: true };
  if (trimmed.startsWith('#')) {
    const tag = trimmed.slice(1).trim();
    return { tag: tag || null, offset, valid: Boolean(tag) };
  }
  const filter = detectFilter(trimmed);
  return { filter, offset, valid: Boolean(filter) };
};

const createNewTask = async (context, owner, timezone) => {
  // Context 會為自然語句補句號；先移除，避免句號成為 title 或 #標籤的一部分。
  const text = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_TASK));
  if (!text) {
    context.pushText(t('__TEXT_TASK_USAGE'));
    return context;
  }
  const { valid, value } = await parseTaskDraft({ text, timezone });
  if (!valid) {
    context.pushText(t('__TEXT_TASK_USAGE'));
    return context;
  }
  const task = await createTask(owner.id, value);
  const syncQueued = await enqueueTaskSync(owner.id, task, 'upsert');
  const line = value.dueAt ? `${value.title}（${formatDueDate(value.dueAt, timezone)}）` : value.title;
  const scope = syncQueued ? '__TEXT_TASK_SYNC_SCOPE' : '__TEXT_TASK_STORAGE_SCOPE';
  context.pushText(`${t('__TEXT_TASK_CREATED')}\n${line}\n${t(scope)}`);
  return context;
};

// 未完成任務每筆兩個動作：完成、刪除。
const openTaskActions = (task, index) => ([
  {
    label: `${t('__LABEL_TASK_DONE')} ${index + 1}`,
    data: `${COMMAND_BOT_TASK_DONE.text} ${task.id}`,
    displayText: `${COMMAND_BOT_TASK_DONE.text} ${index + 1}`,
  },
  {
    label: `${t('__LABEL_TASK_DELETE')} ${index + 1}`,
    data: `${COMMAND_BOT_TASK_DELETE.text} ${task.id}`,
    displayText: `${COMMAND_BOT_TASK_DELETE.text} ${index + 1}`,
  },
]);

// 已完成任務每筆兩個動作：重開、刪除。
const doneTaskActions = (task, index) => ([
  {
    label: `${t('__LABEL_TASK_REOPEN')} ${index + 1}`,
    data: `${COMMAND_BOT_TASK_REOPEN.text} ${task.id}`,
    displayText: `${COMMAND_BOT_TASK_REOPEN.text} ${index + 1}`,
  },
  {
    label: `${t('__LABEL_TASK_DELETE')} ${index + 1}`,
    data: `${COMMAND_BOT_TASK_DELETE.text} ${task.id}`,
    displayText: `${COMMAND_BOT_TASK_DELETE.text} ${index + 1}`,
  },
]);

const listTasksView = async (context, owner, timezone) => {
  const rawArg = stripCommand(context.trimmedText, COMMAND_BOT_TASK_LIST);
  const {
    filter = null, tag = null, offset, valid,
  } = parseListArg(rawArg);
  if (!valid) {
    context.pushText(t('__TEXT_TASK_LIST_USAGE'));
    return context;
  }
  const status = filter === 'done' ? 'done' : 'open';
  const { dueAfter, dueBefore } = filterDueRange(filter, timezone);
  // 多取一筆判斷是否還有下一頁。
  const rows = await listTasks(owner.id, {
    status, dueAfter, dueBefore, tag, limit: PAGE_SIZE + 1, offset,
  });
  const hasMore = rows.length > PAGE_SIZE;
  const tasks = rows.slice(0, PAGE_SIZE);
  if (tasks.length === 0) {
    context.pushText(t(filter || tag ? '__TEXT_TASK_FILTER_EMPTY' : '__TEXT_TASK_LIST_EMPTY'));
    return context;
  }

  let header;
  if (tag) header = `${t('__TEXT_TASK_LIST_TAG')} #${tag}`;
  else header = t(filter ? FILTER_HEADERS[filter] : '__TEXT_TASK_LIST_HEADER');
  const body = tasks
    .map((task, i) => `${offset + i + 1}. ${formatTaskLine(task, timezone)}`)
    .join('\n');

  const makeActions = status === 'done' ? doneTaskActions : openTaskActions;
  const actions = tasks.flatMap((task, i) => makeActions(task, i));
  if (hasMore) {
    // sentinel：把原篩選（去掉舊分頁後綴）與新 offset 編回同一個 `我的任務` 指令。
    const filterArg = rawArg.split('@')[0].trim();
    actions.push({
      label: t('__LABEL_TASK_NEXT_PAGE'),
      data: `${COMMAND_BOT_TASK_LIST.text} ${filterArg}@${offset + PAGE_SIZE}`,
      displayText: t('__LABEL_TASK_NEXT_PAGE'),
    });
  }
  context.pushText(`${header}\n${body}`, actions);
  return context;
};

const reopenTaskById = async (context, owner) => {
  const id = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_TASK_REOPEN));
  if (!id) {
    context.pushText(t('__TEXT_TASK_REOPEN_USAGE'));
    return context;
  }
  const task = await reopenTask(owner.id, id);
  if (task) {
    const syncQueued = await enqueueTaskSync(owner.id, task, 'upsert');
    const scope = syncQueued ? '__TEXT_TASK_SYNC_SCOPE' : '__TEXT_TASK_STORAGE_SCOPE';
    context.pushText(`${t('__TEXT_TASK_REOPENED')}\n${task.title}\n${t(scope)}`);
    return context;
  }
  const existing = await getTask(owner.id, id);
  context.pushText(existing ? t('__TEXT_TASK_REOPEN_ALREADY') : t('__TEXT_TASK_NOTFOUND'));
  return context;
};

const markTaskDone = async (context, owner) => {
  const id = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_TASK_DONE));
  if (!id) {
    context.pushText(t('__TEXT_TASK_DONE_USAGE'));
    return context;
  }
  const task = await completeTask(owner.id, id);
  if (task) {
    await enqueueTaskSync(owner.id, task, 'upsert');
    context.pushText(`${t('__TEXT_TASK_DONE')}\n${task.title}`);
    return context;
  }
  // 冪等：completeTask 只作用於 open。null 時分辨是「已完成」還是「不存在」。
  const existing = await getTask(owner.id, id);
  context.pushText(existing ? t('__TEXT_TASK_DONE_ALREADY') : t('__TEXT_TASK_NOTFOUND'));
  return context;
};

const removeTask = async (context, owner) => {
  const id = stripTrailingMarks(stripCommand(context.trimmedText, COMMAND_BOT_TASK_DELETE));
  if (!id) {
    context.pushText(t('__TEXT_TASK_DELETE_USAGE'));
    return context;
  }
  const syncEnabled = await canSyncTasks(owner.id);
  const removed = syncEnabled
    ? await withTransaction(async (client) => {
      const executor = client.query.bind(client);
      const task = await deleteTaskAndReturn(owner.id, id, executor);
      // DELETE 會等待同步 worker 的列鎖；若遠端剛建立完成，RETURNING 可取得最新 provider id。
      if (task?.provider_task_id) {
        await enqueueTaskSyncJob(owner.id, task, 'delete', executor);
      }
      return task;
    })
    : await deleteTaskAndReturn(owner.id, id);
  context.pushText(removed ? t('__TEXT_TASK_DELETED') : t('__TEXT_TASK_NOTFOUND'));
  return context;
};

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    // 任務需要 durable 儲存；沒有 DB 時不假裝成功。
    if (!config.ENABLE_TASKS || !isDatabaseConfigured()) {
      context.pushText(t('__ERROR_FEATURE_DISABLED'));
      return context;
    }
    try {
      const owner = await upsertUser({ channelUserKey: context.userId });
      const timezone = owner.timezone || config.SCHEDULE_DEFAULT_TIMEZONE;

      if (context.hasCommand(COMMAND_BOT_TASK_LIST)) return await listTasksView(context, owner, timezone);
      if (context.hasCommand(COMMAND_BOT_TASK_REOPEN)) return await reopenTaskById(context, owner);
      if (context.hasCommand(COMMAND_BOT_TASK_DONE)) return await markTaskDone(context, owner);
      if (context.hasCommand(COMMAND_BOT_TASK_DELETE)) return await removeTask(context, owner);
      return await createNewTask(context, owner, timezone);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
