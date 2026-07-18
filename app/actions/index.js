import Action from './action.js';
import MessageAction from './message.js';
import PostbackAction from './postback.js';
import UriAction from './uri.js';

const createAction = (action) => {
  if (action.uri) return new UriAction(action);
  if (action.data) return new PostbackAction(action);
  return new MessageAction(action);
};

export {
  Action,
  createAction,
  MessageAction,
  PostbackAction,
  UriAction,
};
