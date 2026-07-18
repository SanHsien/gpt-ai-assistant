import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let upsertUser;
let createConfirmation;
let getLatestPendingConfirmation;
let getLatestPendingClarification;
let getLatestPendingWorkflow;
let updateConfirmationDraft;
let settleConfirmation;
let isDatabaseConfigured;
let parseSchedule;
let enqueueEventSyncRetry;
let listEvents;
let listEventConflicts;
let listSyncFailedEvents;
let completeEvent;
let completeEventByProviderId;
let getEvent;
let getEventByReference;
let getEventByReferenceForUpdate;
let deleteEvent;
let deleteEventByProviderId;
let hasCalendarAccount;
let createGoogleAuthorizationUrl;
let completeGoogleEvent;
let deleteGoogleEvent;
let isGoogleCalendarConfigured;
let listGoogleEvents;
let syncGoogleCalendarEvent;
let getUserByKey;
let withTransaction;

const DRAFT = {
  title: '看診',
  start: '2026-07-15T15:00:00+08:00',
  timezone: 'Asia/Taipei',
};

const load = async ({
  enabled = true,
  databaseConfigured = true,
  googleEnabled = false,
  googleConfigured = true,
  googleConnected = true,
} = {}) => {
  jest.resetModules();
  process.env.ENABLE_SCHEDULE = enabled ? 'true' : 'false';
  process.env.ENABLE_GOOGLE_CALENDAR = googleEnabled ? 'true' : 'false';
  upsertUser = jest.fn().mockResolvedValue({ id: 'owner-1', timezone: null });
  getUserByKey = jest.fn().mockResolvedValue(null);
  createConfirmation = jest.fn().mockResolvedValue({ id: 'c1' });
  getLatestPendingConfirmation = jest.fn().mockResolvedValue({ id: 'c1', token: 'tok-1' });
  getLatestPendingClarification = jest.fn().mockResolvedValue(null);
  getLatestPendingWorkflow = jest.fn().mockResolvedValue({ id: 'c1', token: 'tok-1' });
  updateConfirmationDraft = jest.fn().mockResolvedValue({ id: 'c1' });
  settleConfirmation = jest.fn();
  isDatabaseConfigured = jest.fn().mockReturnValue(databaseConfigured);
  parseSchedule = jest.fn().mockResolvedValue({ valid: true, errors: [], value: DRAFT });
  enqueueEventSyncRetry = jest.fn().mockResolvedValue({
    event: { id: 'ev-failed', version: 2 }, job: { id: 'job-manual-1' },
  });
  listEvents = jest.fn().mockResolvedValue([]);
  listEventConflicts = jest.fn().mockResolvedValue([]);
  listSyncFailedEvents = jest.fn().mockResolvedValue([]);
  completeEvent = jest.fn().mockResolvedValue({ id: 'ev-1' });
  completeEventByProviderId = jest.fn().mockResolvedValue({ id: 'ev-1' });
  getEvent = jest.fn().mockResolvedValue(null);
  getEventByReference = jest.fn().mockResolvedValue(null);
  getEventByReferenceForUpdate = jest.fn((ownerId, reference) => (
    getEventByReference(ownerId, reference)
  ));
  deleteEvent = jest.fn().mockResolvedValue(true);
  deleteEventByProviderId = jest.fn().mockResolvedValue(true);
  hasCalendarAccount = jest.fn().mockResolvedValue(googleConnected);
  createGoogleAuthorizationUrl = jest.fn().mockResolvedValue('https://accounts.google.com/auth');
  completeGoogleEvent = jest.fn().mockResolvedValue(true);
  deleteGoogleEvent = jest.fn().mockResolvedValue(true);
  isGoogleCalendarConfigured = jest.fn().mockReturnValue(googleConfigured);
  listGoogleEvents = jest.fn().mockResolvedValue([]);
  syncGoogleCalendarEvent = jest.fn().mockResolvedValue(undefined);
  const client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  jest.doMock('../../../repositories/users.js', () => ({ getUserByKey, upsertUser }));
  jest.doMock('../../../repositories/confirmations.js', () => ({
    createConfirmation,
    getLatestPendingClarification,
    getLatestPendingConfirmation,
    getLatestPendingWorkflow,
    settleConfirmation,
    updateConfirmationDraft,
  }));
  jest.doMock('../../../repositories/events.js', () => ({
    completeEvent,
    completeEventByProviderId,
    getEvent,
    getEventByReference,
    getEventByReferenceForUpdate,
    enqueueEventSyncRetry,
    listEventConflicts,
    listEvents,
    listSyncFailedEvents,
    deleteEvent,
    deleteEventByProviderId,
  }));
  jest.doMock('../../../repositories/calendar-accounts.js', () => ({ hasCalendarAccount }));
  jest.doMock('../../../services/database.js', () => ({ isDatabaseConfigured, withTransaction }));
  jest.doMock('../../../services/schedule.js', () => ({ parseSchedule }));
  jest.doMock('../../../services/google-calendar.js', () => ({
    completeGoogleEvent,
    createGoogleAuthorizationUrl,
    deleteGoogleEvent,
    isGoogleCalendarConfigured,
    listGoogleEvents,
    syncGoogleCalendarEvent,
    toGoogleEvent: (event) => ({ id: `gpta${event.id.replaceAll('-', '')}` }),
  }));
  const { default: scheduleHandler } = await import('../../../app/handlers/schedule.js');
  return scheduleHandler;
};

const makeContext = (text, extras = {}) => ({
  id: 'U-delivery-target',
  userId: 'U-line-id',
  trimmedText: text,
  event: extras.event,
  transcription: extras.transcription,
  messages: [],
  hasCommand({ text: commandText, aliases }) {
    const content = text.toLowerCase();
    return [commandText, ...aliases].some((alias) => content.startsWith(alias.toLowerCase()));
  },
  pushText(value, actions = []) { this.messages.push({ type: 'text', text: value, actions }); return this; },
  pushTemplate(value, buttons) {
    this.messages.push({ type: 'template', text: value, buttons });
    return this;
  },
  pushError(err) { this.error = err; return this; },
});

afterEach(() => {
  delete process.env.ENABLE_SCHEDULE;
  delete process.env.ENABLE_GOOGLE_CALENDAR;
  jest.dontMock('../../../repositories/users.js');
  jest.dontMock('../../../repositories/confirmations.js');
  jest.dontMock('../../../repositories/events.js');
  jest.dontMock('../../../repositories/calendar-accounts.js');
  jest.dontMock('../../../services/database.js');
  jest.dontMock('../../../services/schedule.js');
  jest.dontMock('../../../services/google-calendar.js');
  jest.resetModules();
});

test('ignores messages that are not schedule commands', async () => {
  const scheduleHandler = await load();
  await expect(scheduleHandler(makeContext('今天天氣如何'))).resolves.toBe(false);
});

test.each([
  '7/20 借保貸交信用卡',
  '2026/7/20 借保貸交信用卡',
  '7月20日 借保貸交信用卡',
  '明天下午三點看診',
  '星期五下午三點看診',
  '下星期五下午三點看診',
  '下個星期五下午三點看診',
  '這個星期二繳信用卡',
  '這週二繳信用卡',
  '每天晚上十點四十分 RC 週期提醒驗收',
  '每週五下午三點整理週報',
])('treats an explicit date-led statement as an implicit schedule: %s', async (text) => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext(text));
  expect(parseSchedule).toHaveBeenCalledWith({ text, timezone: 'Asia/Taipei' });
  expect(context.messages[0].type).toBe('template');
});

test.each([
  '7/20 是多少？',
  '7/20 + 3/20',
  '明天會下雨嗎？',
])('does not intercept a date-led question or calculation: %s', async (text) => {
  const scheduleHandler = await load();
  await expect(scheduleHandler(makeContext(text))).resolves.toBe(false);
  expect(parseSchedule).not.toHaveBeenCalled();
});

test('does not intercept implicit schedules when scheduling is disabled', async () => {
  const scheduleHandler = await load({ enabled: false });
  expect(scheduleHandler(makeContext('7/20 借保貸交信用卡'))).toBe(false);
  expect(upsertUser).not.toHaveBeenCalled();
});

test('refuses to work when the feature is off, without touching the database', async () => {
  const scheduleHandler = await load({ enabled: false });
  const context = await scheduleHandler(makeContext('記行程 明天下午三點看診'));
  expect(context.messages[0].text).toBe('此功能目前已停用');
  expect(upsertUser).not.toHaveBeenCalled();
});

test('refuses to work when no database is configured', async () => {
  const scheduleHandler = await load({ databaseConfigured: false });
  const context = await scheduleHandler(makeContext('記行程 明天下午三點看診'));
  expect(context.messages[0].text).toBe('此功能目前已停用');
  expect(createConfirmation).not.toHaveBeenCalled();
});

test('an unconnected Google Calendar user receives a one-time authorization link', async () => {
  const scheduleHandler = await load({ googleEnabled: true, googleConnected: false });
  const context = await scheduleHandler(makeContext('記行程 明天下午三點看診'));
  expect(parseSchedule).not.toHaveBeenCalled();
  expect(createGoogleAuthorizationUrl).toHaveBeenCalledWith('owner-1');
  expect(context.messages[0]).toMatchObject({
    type: 'template',
    buttons: [{ label: '前往 Google 授權', uri: 'https://accounts.google.com/auth' }],
  });
});

test.each([
  '連結 Google 行事曆',
  '連結Google行事曆',
  '連接 Google 行事曆',
  '連接Google行事曆',
  '綁定Google行事曆',
  '授權Google行事曆',
])('the Google Calendar command "%s" creates a fresh authorization link', async (command) => {
  const scheduleHandler = await load({ googleEnabled: true });
  const context = await scheduleHandler(makeContext(command));
  expect(createGoogleAuthorizationUrl).toHaveBeenCalledWith('owner-1');
  expect(context.messages[0].buttons[0].uri).toMatch(/^https:\/\//);
});

test('parses a draft and asks for confirmation instead of writing the event', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('記行程 明天下午三點跟王醫師看診'));

  expect(parseSchedule).toHaveBeenCalledWith({
    text: '明天下午三點跟王醫師看診',
    timezone: 'Asia/Taipei',
  });
  expect(createConfirmation).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'owner-1',
    draft: DRAFT,
  }));
  const { token } = createConfirmation.mock.calls[0][0];
  const [message] = context.messages;
  expect(message.type).toBe('template');
  expect(message.text).toContain('看診');
  expect(message.buttons.map(({ data, displayText }) => ({ data, displayText }))).toEqual([
    { data: `確認行程 ${token}`, displayText: '確認行程' },
    { data: `取消行程 ${token}`, displayText: '取消行程' },
  ]);
  expect(settleConfirmation).not.toHaveBeenCalled();
});

test('shows the recurrence rule in the confirmation summary', async () => {
  const scheduleHandler = await load();
  parseSchedule.mockResolvedValue({
    valid: true,
    errors: [],
    value: {
      ...DRAFT,
      recurrence: { freq: 'DAILY', interval: 2, count: 3 },
    },
  });
  const context = await scheduleHandler(makeContext('記行程 每兩天晚上十點例行檢查'));
  expect(context.messages[0].text).toContain('重複：每 2 天，共 3 次');
});

test('voice-created schedule flows through the same draft/confirm path and echoes the transcription', async () => {
  const scheduleHandler = await load();
  // 語音訊息經轉錄後 trimmedText 即文字；schedule handler 無 isText 閘門，走同一 event-draft 流程。
  const context = await scheduleHandler(makeContext('記行程 明天下午三點看診', {
    event: { isAudio: true },
    transcription: '記行程 明天下午三點看診',
  }));
  expect(parseSchedule).toHaveBeenCalledWith({
    text: '明天下午三點看診',
    timezone: 'Asia/Taipei',
  });
  const [message] = context.messages;
  expect(message.type).toBe('template');
  // 回顯聽到的原文，讓使用者在確認前分辨「聽錯」與「解析錯」。
  expect(message.text).toContain('🎤');
  expect(message.text).toContain('我聽到');
  expect(message.text).toContain('記行程 明天下午三點看診');
});

test('text-created schedule does not add a voice echo line', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('記行程 明天下午三點看診'));
  expect(context.messages[0].text).not.toContain('🎤');
});

test('accepts the concise 行程 prefix for a relative reminder event', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('行程 5分鐘後的測試通知'));

  expect(parseSchedule).toHaveBeenCalledWith({
    text: '5分鐘後的測試通知',
    timezone: 'Asia/Taipei',
  });
  expect(context.messages[0].type).toBe('template');
});

test('asks for a fuller sentence when the command carries no description', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('記行程'));
  expect(context.messages[0].text).toContain('請把行程說完整');
  expect(parseSchedule).not.toHaveBeenCalled();
});

test('reports a parse failure without creating a confirmation', async () => {
  const scheduleHandler = await load();
  parseSchedule.mockResolvedValue({ valid: false, errors: ['title is required'], value: null });
  const context = await scheduleHandler(makeContext('記行程 嗯'));
  expect(context.messages[0].text).toContain('看不懂');
  expect(createConfirmation).not.toHaveBeenCalled();
});

test('stores a partial draft and asks one focused clarification question', async () => {
  const scheduleHandler = await load();
  parseSchedule.mockResolvedValue({
    valid: false,
    needsClarification: true,
    errors: [],
    missingFields: ['time'],
    value: {
      title: '看診', start: null, allDay: false, timezone: 'Asia/Taipei',
    },
  });
  const context = await scheduleHandler(makeContext('記行程 明天下午看診'));
  expect(createConfirmation).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'owner-1',
    missingFields: ['time'],
    operation: 'create',
  }));
  expect(context.messages[0].text).toContain('幾點');
});

test('continues a durable clarification from the next natural-language message', async () => {
  const scheduleHandler = await load();
  getUserByKey.mockResolvedValue({ id: 'owner-1', timezone: 'Asia/Taipei' });
  getLatestPendingClarification.mockResolvedValue({
    token: 'clarify-1',
    operation: 'create',
    draft: {
      title: '看診', start: null, allDay: false, timezone: 'Asia/Taipei',
    },
    missing_fields: ['time'],
  });
  const completed = {
    title: '看診', start: '2026-07-16T15:00:00+08:00', allDay: false, timezone: 'Asia/Taipei',
  };
  parseSchedule.mockResolvedValue({ valid: true, errors: [], value: completed });
  const context = await scheduleHandler(makeContext('下午三點'));
  expect(parseSchedule).toHaveBeenCalledWith(expect.objectContaining({
    text: '下午三點',
    baseDraft: expect.objectContaining({ title: '看診' }),
  }));
  expect(updateConfirmationDraft).toHaveBeenCalledWith({
    ownerId: 'owner-1', token: 'clarify-1', draft: completed, missingFields: [],
  });
  expect(context.messages[0].type).toBe('template');
});

test('lists local events as edit choices without exposing ids in display text', async () => {
  const scheduleHandler = await load();
  listEvents.mockResolvedValue([{
    id: 'ev-1', title: '看診', start_at: '2026-07-20T07:00:00Z', all_day: false, version: 2,
  }]);
  const context = await scheduleHandler(makeContext('修改行程'));
  expect(context.messages[0].actions).toEqual([{
    label: '修改 1', data: '修改行程 ev-1', displayText: '修改行程 1',
  }]);
});

test('starts an optimistic edit workflow for the selected event', async () => {
  const scheduleHandler = await load();
  getEvent.mockResolvedValue({
    id: 'ev-1',
    title: '看診',
    start_at: '2026-07-20T07:00:00Z',
    end_at: null,
    all_day: false,
    timezone: 'Asia/Taipei',
    version: 3,
    status: 'confirmed',
  });
  const context = await scheduleHandler(makeContext('修改行程 ev-1'));
  expect(createConfirmation).toHaveBeenCalledWith(expect.objectContaining({
    operation: 'update', targetEventId: 'ev-1', expectedVersion: 3, missingFields: ['changes'],
  }));
  expect(context.messages[0].text).toContain('直接說要修改的內容');
});

test('warns before confirming an overlapping event', async () => {
  const scheduleHandler = await load();
  listEventConflicts.mockResolvedValue([{ id: 'other-event' }]);
  const context = await scheduleHandler(makeContext('記行程 明天下午三點看診'));
  expect(context.messages[0].text).toContain('與既有行程重疊');
});

test('confirming settles the pending draft and reports the created event', async () => {
  const scheduleHandler = await load();
  settleConfirmation.mockResolvedValue({
    state: 'confirmed',
    changed: true,
    event: { title: '看診', start_at: '2026-07-15T07:00:00.000Z', all_day: false },
  });
  const context = await scheduleHandler(makeContext('確認行程'));
  expect(settleConfirmation).toHaveBeenCalledWith({
    ownerId: 'owner-1', token: 'tok-1', action: 'confirm', notificationTarget: 'U-delivery-target',
  });
  expect(context.messages[0].text).toContain('已建立行程');
});

test('a confirmation button settles its own token instead of the latest draft', async () => {
  const scheduleHandler = await load();
  settleConfirmation.mockResolvedValue({
    state: 'confirmed',
    changed: true,
    event: { title: '舊草稿', start_at: '2026-07-15T07:00:00.000Z', all_day: false },
  });
  await scheduleHandler(makeContext('確認行程 old-token-123。'));
  expect(getLatestPendingConfirmation).not.toHaveBeenCalled();
  expect(settleConfirmation).toHaveBeenCalledWith({
    ownerId: 'owner-1', token: 'old-token-123', action: 'confirm', notificationTarget: 'U-delivery-target',
  });
});

test('a queued Google sync sends no transitional creation message', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  settleConfirmation.mockResolvedValue({
    state: 'confirmed',
    changed: true,
    syncQueued: true,
    event: {
      id: 'ev-1', title: '看診', start_at: '2026-07-15T07:00:00.000Z', all_day: false,
    },
  });
  const context = await scheduleHandler(makeContext('確認行程'));
  expect(context.messages).toEqual([]);
});

test('cancelling settles the pending draft without creating an event', async () => {
  const scheduleHandler = await load();
  settleConfirmation.mockResolvedValue({ state: 'cancelled', changed: true, event: null });
  const context = await scheduleHandler(makeContext('取消行程'));
  expect(settleConfirmation).toHaveBeenCalledWith({
    ownerId: 'owner-1', token: 'tok-1', action: 'cancel', notificationTarget: 'U-delivery-target',
  });
  expect(context.messages[0].text).toContain('已取消');
});

test('a bare cancel command also cancels an incomplete clarification workflow', async () => {
  const scheduleHandler = await load();
  getLatestPendingWorkflow.mockResolvedValue({ id: 'c1', token: 'clarify-1' });
  settleConfirmation.mockResolvedValue({ state: 'cancelled', changed: true, event: null });
  await scheduleHandler(makeContext('取消行程'));
  expect(getLatestPendingConfirmation).not.toHaveBeenCalled();
  expect(settleConfirmation).toHaveBeenCalledWith(expect.objectContaining({
    token: 'clarify-1', action: 'cancel',
  }));
});

test('says there is nothing to confirm when no draft is pending', async () => {
  const scheduleHandler = await load();
  getLatestPendingConfirmation.mockResolvedValue(null);
  const context = await scheduleHandler(makeContext('確認行程'));
  expect(context.messages[0].text).toContain('沒有待確認的行程');
  expect(settleConfirmation).not.toHaveBeenCalled();
});

test('sets a valid IANA timezone on the user', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('設定時區 Asia/Tokyo。'));
  expect(upsertUser).toHaveBeenLastCalledWith({ channelUserKey: 'U-line-id', timezone: 'Asia/Tokyo' });
  expect(context.messages[0].text).toContain('Asia/Tokyo');
});

test('rejects an invalid timezone without persisting it', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('設定時區 Mars/Olympus。'));
  expect(context.messages[0].text).toContain('無效的時區');
  // 只呼叫過一次 upsertUser（開場解析 owner），沒有第二次寫入時區。
  expect(upsertUser).toHaveBeenCalledTimes(1);
});

test('asks for the timezone when none is given', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('設定時區'));
  expect(context.messages[0].text).toContain('請一起帶上時區');
  expect(upsertUser).toHaveBeenCalledTimes(1);
});

test('lists upcoming events with complete and delete shortcuts bound to each id', async () => {
  const scheduleHandler = await load();
  listEvents.mockResolvedValue([
    {
      id: 'ev-1', title: '看診', start_at: '2026-07-20T07:00:00.000Z', all_day: false,
    },
    {
      id: 'ev-2', title: '開會', start_at: '2026-07-21T02:00:00.000Z', all_day: false,
    },
  ]);
  const context = await scheduleHandler(makeContext('我的行程'));
  expect(listEvents).toHaveBeenCalledWith('owner-1', expect.objectContaining({ limit: 6 }));
  const [message] = context.messages;
  expect(message.text).toContain('看診');
  expect(message.text).toContain('開會');
  // 內部 id 只放 postback data；聊天畫面顯示操作與當次列表序號。
  expect(message.actions.map(({ data, displayText }) => ({ data, displayText }))).toEqual([
    { data: '完成行程 ev-1', displayText: '完成行程 1' },
    { data: '刪行程 ev-1', displayText: '刪除行程 1' },
    { data: '完成行程 ev-2', displayText: '完成行程 2' },
    { data: '刪行程 ev-2', displayText: '刪除行程 2' },
  ]);
});

test('marks a local event complete and cancels its pending reminder', async () => {
  const scheduleHandler = await load();
  const context = await scheduleHandler(makeContext('完成行程 ev-1。'));
  expect(completeEvent).toHaveBeenCalledWith('owner-1', 'ev-1');
  expect(context.messages[0].text).toContain('標記為完成');
});

test('marks a Google event and its local mapping complete', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  getEventByReference.mockResolvedValue({
    id: '65e39296-9da6-46c2-8ae7-1874ce286b95',
    provider_event_id: 'gpta5a7fc4c865a84f8dbf11e0de6269c597',
  });
  const context = await scheduleHandler(makeContext(
    '完成行程 gpta5a7fc4c865a84f8dbf11e0de6269c597',
  ));
  expect(completeGoogleEvent).toHaveBeenCalledWith(
    'owner-1',
    'gpta5a7fc4c865a84f8dbf11e0de6269c597',
  );
  expect(completeEvent).toHaveBeenCalledWith(
    'owner-1',
    '65e39296-9da6-46c2-8ae7-1874ce286b95',
    expect.any(Function),
  );
  expect(completeEventByProviderId).not.toHaveBeenCalled();
  expect(context.messages[0].text).toContain('標記為完成');
});

test('completes a not-yet-checkpointed local event and probes its deterministic Google id', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  getEventByReference.mockResolvedValue({ id: 'ev-local', provider_event_id: null });
  const context = await scheduleHandler(makeContext('完成行程 ev-local'));
  expect(completeGoogleEvent).toHaveBeenCalledWith('owner-1', 'gptaevlocal');
  expect(completeEvent).toHaveBeenCalledWith('owner-1', 'ev-local', expect.any(Function));
  expect(context.messages[0].text).toContain('標記為完成');
});

test('says the list is empty when there are no upcoming events', async () => {
  const scheduleHandler = await load();
  listEvents.mockResolvedValue([]);
  const context = await scheduleHandler(makeContext('我的行程'));
  expect(context.messages[0].text).toContain('沒有即將到來的行程');
});

test('deletes the event named by the delete shortcut', async () => {
  const scheduleHandler = await load();
  deleteEvent.mockResolvedValue(true);
  const context = await scheduleHandler(makeContext('刪行程 ev-1。'));
  expect(deleteEvent).toHaveBeenCalledWith('owner-1', 'ev-1');
  expect(context.messages[0].text).toContain('已刪除行程');
});

test('reports when the event to delete is already gone', async () => {
  const scheduleHandler = await load();
  deleteEvent.mockResolvedValue(false);
  const context = await scheduleHandler(makeContext('刪行程 ev-x。'));
  expect(context.messages[0].text).toContain('找不到那筆行程');
});

test('deletes a failed local event and clears any deterministic Google orphan', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  getEventByReference.mockResolvedValue({
    id: 'ev-local', provider_event_id: null, sync_status: 'error',
  });
  const context = await scheduleHandler(makeContext('刪行程 ev-local'));
  expect(deleteGoogleEvent).toHaveBeenCalledWith('owner-1', 'gptaevlocal');
  expect(deleteEvent).toHaveBeenCalledWith('owner-1', 'ev-local', expect.any(Function));
  expect(context.messages[0].text).toContain('已刪除行程');
});

test('lists failed sync events with retry and delete shortcuts', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  listSyncFailedEvents.mockResolvedValue([{
    id: 'ev-failed', title: '看診', start_at: '2026-07-20T07:00:00.000Z', all_day: false,
  }]);
  const context = await scheduleHandler(makeContext('同步失敗行程'));
  expect(listSyncFailedEvents).toHaveBeenCalledWith('owner-1', 6);
  expect(context.messages[0].actions.map(({ data, displayText }) => ({ data, displayText }))).toEqual([
    { data: '重試同步 ev-failed', displayText: '重試同步' },
    { data: '刪行程 ev-failed', displayText: '刪除行程' },
  ]);
});

test('manual retry creates a fresh durable sync cycle and waits for the final status', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  getEvent.mockResolvedValue({
    id: 'ev-failed', version: 1, status: 'confirmed', sync_status: 'error', provider_event_id: null,
  });
  const context = await scheduleHandler(makeContext('重試同步 ev-failed'));
  expect(enqueueEventSyncRetry).toHaveBeenCalledWith({
    ownerId: 'owner-1', eventId: 'ev-failed', notificationTarget: 'U-delivery-target',
  });
  expect(context.messages).toEqual([]);
});

test('a duplicate retry while the event is pending does not enqueue another cycle', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  getEvent.mockResolvedValue({
    id: 'ev-failed', version: 2, status: 'confirmed', sync_status: 'pending',
  });
  const context = await scheduleHandler(makeContext('重試同步 ev-failed'));
  expect(enqueueEventSyncRetry).not.toHaveBeenCalled();
  expect(context.messages[0].text).toContain('正在同步');
});

test('postponing a failed sync keeps the local event and does not enqueue anything', async () => {
  const scheduleHandler = await load({ googleEnabled: true });
  getEvent.mockResolvedValue({ id: 'ev-failed', sync_status: 'error' });
  const context = await scheduleHandler(makeContext('暫不處理 ev-failed'));
  expect(deleteEvent).not.toHaveBeenCalled();
  expect(enqueueEventSyncRetry).not.toHaveBeenCalled();
  expect(context.messages[0].text).toContain('已保留');
  expect(context.messages[0].text).toContain('不會再自動詢問');
});
