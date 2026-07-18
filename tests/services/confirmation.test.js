import {
  expect, jest, test,
} from '@jest/globals';
import {
  CONFIRMATION_STATES, CONFIRMATION_ACTIONS, isTerminal, transition, settle,
} from '../../services/confirmation.js';

const { DRAFT, CONFIRMED, CANCELLED } = CONFIRMATION_STATES;
const { CONFIRM, CANCEL } = CONFIRMATION_ACTIONS;

test('draft + confirm commits once and moves to confirmed', () => {
  expect(transition(DRAFT, CONFIRM)).toEqual({ state: CONFIRMED, commit: true, changed: true });
});

test('draft + cancel moves to cancelled without committing', () => {
  expect(transition(DRAFT, CANCEL)).toEqual({ state: CANCELLED, commit: false, changed: true });
});

test('re-confirming a confirmed draft is a no-op (no double write)', () => {
  expect(transition(CONFIRMED, CONFIRM)).toEqual({ state: CONFIRMED, commit: false, changed: false });
});

test('terminal states ignore further actions', () => {
  expect(transition(CONFIRMED, CANCEL)).toEqual({ state: CONFIRMED, commit: false, changed: false });
  expect(transition(CANCELLED, CONFIRM)).toEqual({ state: CANCELLED, commit: false, changed: false });
});

test('unknown actions do not change state', () => {
  expect(transition(DRAFT, 'poke')).toEqual({ state: DRAFT, commit: false, changed: false });
});

test('isTerminal reflects terminal states', () => {
  expect(isTerminal(DRAFT)).toBe(false);
  expect(isTerminal(CONFIRMED)).toBe(true);
  expect(isTerminal(CANCELLED)).toBe(true);
});

test('settle runs commitFn exactly once on the first confirm', async () => {
  const commitFn = jest.fn().mockResolvedValue(undefined);
  const first = await settle(DRAFT, CONFIRM, commitFn);
  expect(first.state).toBe(CONFIRMED);
  expect(commitFn).toHaveBeenCalledTimes(1);

  const again = await settle(CONFIRMED, CONFIRM, commitFn);
  expect(again.commit).toBe(false);
  expect(commitFn).toHaveBeenCalledTimes(1);
});

test('settle does not commit on cancel', async () => {
  const commitFn = jest.fn();
  await settle(DRAFT, CANCEL, commitFn);
  expect(commitFn).not.toHaveBeenCalled();
});
