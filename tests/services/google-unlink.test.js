import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let getCalendarAccount;
let deleteCalendarAccount;
let revokeCredentials;
let setCredentials;

const load = async ({ account = { credentials: { refresh_token: 'r' } } } = {}) => {
  jest.resetModules();
  process.env.ENABLE_GOOGLE_CALENDAR = 'true';
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://x/cb';
  getCalendarAccount = jest.fn().mockResolvedValue(account);
  deleteCalendarAccount = jest.fn().mockResolvedValue(true);
  revokeCredentials = jest.fn().mockResolvedValue({});
  setCredentials = jest.fn();
  jest.doMock('google-auth-library', () => ({
    OAuth2Client: class {
      // eslint-disable-next-line class-methods-use-this
      setCredentials(...args) { return setCredentials(...args); }

      // eslint-disable-next-line class-methods-use-this
      revokeCredentials(...args) { return revokeCredentials(...args); }
    },
  }));
  jest.doMock('../../repositories/calendar-accounts.js', () => ({
    getCalendarAccount, deleteCalendarAccount,
  }));
  jest.doMock('../../repositories/events.js', () => ({}));
  jest.doMock('../../repositories/jobs.js', () => ({ enqueueJob: jest.fn() }));
  return import('../../services/google-calendar.js');
};

afterEach(() => {
  delete process.env.ENABLE_GOOGLE_CALENDAR;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  jest.dontMock('google-auth-library');
  jest.dontMock('../../repositories/calendar-accounts.js');
  jest.dontMock('../../repositories/events.js');
  jest.dontMock('../../repositories/jobs.js');
  jest.resetModules();
});

test('unlink revokes the Google token and deletes the local account', async () => {
  const { unlinkGoogleCalendar } = await load();
  expect(await unlinkGoogleCalendar('owner-1')).toBe(true);
  expect(setCredentials).toHaveBeenCalledWith({ refresh_token: 'r' });
  expect(revokeCredentials).toHaveBeenCalled();
  expect(deleteCalendarAccount).toHaveBeenCalledWith('owner-1');
});

test('unlink still deletes the local account when revocation fails', async () => {
  const { unlinkGoogleCalendar } = await load();
  revokeCredentials.mockRejectedValue(Object.assign(new Error('invalid_token'), { response: { status: 400 } }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(await unlinkGoogleCalendar('owner-1')).toBe(true);
  expect(deleteCalendarAccount).toHaveBeenCalledWith('owner-1');
  jest.restoreAllMocks();
});

test('unlink is a no-op when nothing is linked', async () => {
  const { unlinkGoogleCalendar } = await load({ account: null });
  expect(await unlinkGoogleCalendar('owner-1')).toBe(false);
  expect(revokeCredentials).not.toHaveBeenCalled();
  expect(deleteCalendarAccount).not.toHaveBeenCalled();
});
