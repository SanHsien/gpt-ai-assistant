import { ACTION_TYPE_POSTBACK } from '../../services/line.js';
import Action from './action.js';

class PostbackAction extends Action {
  type = ACTION_TYPE_POSTBACK;

  label;

  data;

  displayText;

  constructor({
    label, data, displayText,
  }) {
    super();
    this.label = label;
    this.data = data;
    if (displayText) this.displayText = displayText;
  }
}

export default PostbackAction;
