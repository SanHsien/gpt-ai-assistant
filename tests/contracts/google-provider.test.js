import { expect, test } from '@jest/globals';
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_PROVIDER_CONTRACT,
  GOOGLE_TASKS_SCOPE,
  decideCalendarInbound,
  decideTaskInbound,
  googleAuthorizationScopes,
} from '../../contracts/google-provider.js';

test('authorization scopes add Tasks only when enabled', () => {
  expect(googleAuthorizationScopes()).toEqual([GOOGLE_CALENDAR_SCOPE]);
  expect(googleAuthorizationScopes({ tasksEnabled: true })).toEqual([
    GOOGLE_CALENDAR_SCOPE,
    GOOGLE_TASKS_SCOPE,
  ]);
});

test('calendar contract rejects unsupported or conflicting inbound updates', () => {
  expect(decideCalendarInbound({ event: null })).toBe('not_found');
  expect(decideCalendarInbound({ event: { status: 'completed' } })).toBe('not_confirmed');
  expect(decideCalendarInbound({ event: { status: 'confirmed', recurrence: {} } })).toBe('recurring');
  expect(decideCalendarInbound({
    event: { status: 'confirmed', recurrence: null, sync_status: 'pending' },
  })).toBe('local_pending');
  expect(decideCalendarInbound({
    event: {
      status: 'confirmed', recurrence: null, sync_status: 'synced', provider_updated_at: '2026-07-18T02:00:00Z',
    },
    providerUpdatedAt: '2026-07-18T01:00:00Z',
  })).toBe('stale');
});

test('task contract keeps local pending writes authoritative', () => {
  expect(decideTaskInbound({ task: null })).toBe('not_found');
  expect(decideTaskInbound({ task: { sync_status: 'pending' } })).toBe('local_pending');
  expect(decideTaskInbound({ task: { sync_status: 'synced' } })).toBe('apply');
});

test('unsupported round trips remain explicit', () => {
  expect(GOOGLE_PROVIDER_CONTRACT.calendar.inbound.allDay).toBe(false);
  expect(GOOGLE_PROVIDER_CONTRACT.calendar.inbound.recurrenceExceptions).toBe(false);
  expect(GOOGLE_PROVIDER_CONTRACT.tasks.inbound.dueDate).toBe(false);
  expect(GOOGLE_PROVIDER_CONTRACT.tasks.inbound.createFromGoogle).toBe(false);
});
