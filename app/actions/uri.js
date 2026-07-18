import { ACTION_TYPE_URI } from '../../services/line.js';
import Action from './action.js';

class UriAction extends Action {
  type = ACTION_TYPE_URI;

  label;

  uri;

  constructor({ label, uri }) {
    super();
    this.label = label;
    this.uri = uri;
  }
}

export default UriAction;
