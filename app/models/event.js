import {
  EVENT_TYPE_MESSAGE,
  EVENT_TYPE_POSTBACK,
  MESSAGE_TYPE_AUDIO,
  MESSAGE_TYPE_STICKER,
  MESSAGE_TYPE_TEXT,
  MESSAGE_TYPE_IMAGE,
  SOURCE_TYPE_GROUP,
} from '../../services/line.js';

class Event {
  type;

  replyToken;

  source;

  message;

  postback;

  constructor({
    type,
    replyToken,
    source,
    message,
    postback,
  }) {
    this.type = type;
    this.replyToken = replyToken;
    this.source = source;
    this.message = message;
    this.postback = postback;
  }

  /**
   * @returns {boolean}
   */
  get isMessage() {
    return this.type === EVENT_TYPE_MESSAGE;
  }

  get isPostback() {
    return this.type === EVENT_TYPE_POSTBACK;
  }

  /**
   * @returns {boolean}
   */
  get isGroup() {
    return this.source.type === SOURCE_TYPE_GROUP;
  }

  /**
   * @returns {boolean}
   */
  get isText() {
    return this.isPostback || this.message?.type === MESSAGE_TYPE_TEXT;
  }

  /**
   * @returns {boolean}
   */
  get isSticker() {
    return this.message?.type === MESSAGE_TYPE_STICKER;
  }

  /**
   * @returns {boolean}
   */
  get isAudio() {
    return this.message?.type === MESSAGE_TYPE_AUDIO;
  }

  /**
   * @returns {boolean}
   */
  get isImage() {
    return this.message?.type === MESSAGE_TYPE_IMAGE;
  }

  /**
   * @returns {string}
   */
  get groupId() {
    return this.source.groupId;
  }

  /**
   * @returns {string}
   */
  get userId() {
    return this.source.userId;
  }

  /**
   * @returns {string}
   */
  get messageId() {
    return this.message?.id;
  }

  /**
   * @returns {string}
   */
  get text() {
    return this.isPostback ? this.postback?.data : this.message?.text;
  }
}

export default Event;
