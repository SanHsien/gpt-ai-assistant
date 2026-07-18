import {
  EVENT_TYPE_MESSAGE,
  EVENT_TYPE_POSTBACK,
  MESSAGE_TYPE_AUDIO,
  MESSAGE_TYPE_FILE,
  MESSAGE_TYPE_STICKER,
  MESSAGE_TYPE_TEXT,
  MESSAGE_TYPE_IMAGE,
  SOURCE_TYPE_GROUP,
} from '../../services/line.js';

const AUDIO_FILE_EXTENSIONS = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm']);
const audioExtension = (fileName = '') => {
  const normalized = String(fileName).trim().toLowerCase();
  const dot = normalized.lastIndexOf('.');
  return dot >= 0 ? normalized.slice(dot) : '';
};

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
    return this.message?.type === MESSAGE_TYPE_AUDIO || this.isAudioFile;
  }

  get isAudioFile() {
    return this.message?.type === MESSAGE_TYPE_FILE
      && AUDIO_FILE_EXTENSIONS.has(audioExtension(this.message?.fileName));
  }

  get audioFileName() {
    if (!this.isAudioFile) return `${this.messageId}.m4a`;
    return String(this.message?.fileName).split(/[\\/]/).pop();
  }

  get fileSize() {
    return Number(this.message?.fileSize) || null;
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
