export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

export const GOOGLE_PROVIDER_CONTRACT = Object.freeze({
  calendar: Object.freeze({
    outbound: Object.freeze({
      create: true, update: true, complete: true, delete: true,
    }),
    inbound: Object.freeze({
      updateTimedNonRecurring: true,
      deleteMapped: true,
      createFromGoogle: false,
      allDay: false,
      recurrenceExceptions: false,
    }),
  }),
  tasks: Object.freeze({
    outbound: Object.freeze({
      create: true, update: true, complete: true, reopen: true, delete: true,
    }),
    inbound: Object.freeze({
      updateMapped: true,
      deleteMapped: true,
      createFromGoogle: false,
      dueDate: false,
    }),
  }),
});

export const googleAuthorizationScopes = ({ tasksEnabled = false } = {}) => (
  tasksEnabled
    ? [GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE]
    : [GOOGLE_CALENDAR_SCOPE]
);

const toMs = (value) => (value == null ? null : new Date(value).getTime());

export const decideCalendarInbound = ({ event, providerUpdatedAt }) => {
  if (!event) return 'not_found';
  if (event.status !== 'confirmed') return 'not_confirmed';
  if (event.recurrence) return 'recurring';
  if (event.sync_status !== 'synced') return 'local_pending';
  const incoming = toMs(providerUpdatedAt);
  const seen = toMs(event.provider_updated_at);
  if (incoming != null && seen != null && incoming <= seen) return 'stale';
  return 'apply';
};

export const decideTaskInbound = ({ task }) => {
  if (!task) return 'not_found';
  if (task.sync_status !== 'synced') return 'local_pending';
  return 'apply';
};

export default GOOGLE_PROVIDER_CONTRACT;
