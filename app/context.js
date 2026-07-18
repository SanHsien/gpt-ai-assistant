import config from '../config/index.js';
import { t } from '../locales/index.js';
import {
  MESSAGE_TYPE_IMAGE, MESSAGE_TYPE_TEXT, SOURCE_TYPE_GROUP, SOURCE_TYPE_USER,
} from '../services/line.js';
import {
  addMark,
  convertText,
  fetchAudio,
  fetchImage,
  fetchGroup,
  fetchUser,
  generateTranscription,
} from '../utils/index.js';
import { COMMAND_BOT_FORGET, COMMAND_BOT_RETRY } from './commands/index.js';
import { updateHistory } from './history/index.js';
import {
  ImageMessage, TemplateMessage, TextMessage,
} from './messages/index.js';
import { Bot, Source } from './models/index.js';
import { ensureBotSource } from '../repositories/bot-sources.js';

class Context {
  /**
   * @type {import('./models/index.js').Event}
   */
  event;

  /**
   * @type {Source}
   */
  source;

  /**
   * @type {string}
   */
  transcription;

  /**
   * @type {Array<import('./messages/index.js').Message>}
   */
  messages = [];

  /**
   * @param {import('./models/index.js').Event} event
   */
  constructor(event) {
    this.event = event;
  }

  get id() {
    if (this.event.isGroup) return this.event.source.groupId;
    return this.event.source.userId;
  }

  /**
   * @returns {string}
   */
  get replyToken() {
    return this.event.replyToken;
  }

  /**
   * @returns {string}
   */
  get groupId() {
    return this.event.groupId;
  }

  /**
   * @returns {string}
   */
  get userId() {
    return this.event.userId;
  }

  /**
   * @returns {string}
   */
  get trimmedText() {
    if (this.event.isText) {
      const text = this.event.text.replaceAll('　', ' ').replace(config.BOT_NAME, '').trim();
      return addMark(text);
    }
    if (this.event.isAudio) {
      const text = this.transcription.replace(config.BOT_NAME, '').trim();
      return addMark(text);
    }
    if (this.event.isImage) {
      return this.transcription.trim();
    }
    return '?';
  }

  get hasBotName() {
    if (this.event.isText) {
      const text = this.event.text.replaceAll('　', ' ').trim().toLowerCase();
      return text.startsWith(config.BOT_NAME.toLowerCase());
    }
    if (this.event.isAudio) {
      const text = this.transcription.toLowerCase();
      return text.startsWith(config.BOT_NAME.toLowerCase());
    }
    if (this.event.isImage) {
      const text = this.transcription.toLowerCase();
      return text.startsWith(config.BOT_NAME.toLowerCase());
    }
    return false;
  }

  async initialize() {
    try {
      await this.register();
    } catch (err) {
      return this.pushError(err);
    }
    if (this.event.isAudio) {
      if (!config.ENABLE_TRANSCRIPTION) return this.pushError(new Error(t('__ERROR_FEATURE_DISABLED')));
      try {
        await this.transcribeAudio();
      } catch (err) {
        return this.pushError(err);
      }
    }
    if (this.event.isImage) {
      if (!config.ENABLE_VISION) return this.pushError(new Error(t('__ERROR_FEATURE_DISABLED')));
      try {
        await this.transcribeImage();
      } catch (err) {
        return this.pushError(err);
      }
    }
    // Postback data may contain internal confirmation/event ids; do not leak them into chat history.
    if (!this.event.isPostback) {
      updateHistory(this.id, (history) => history.write(this.source.name, this.trimmedText));
    }
    return this;
  }

  async register() {
    try {
      let current;
      let name;
      if (this.event.isGroup) {
        current = await ensureBotSource({
          sourceKey: this.groupId,
          sourceType: SOURCE_TYPE_GROUP,
          defaultActivated: !config.BOT_DEACTIVATED,
          maxSources: config.APP_MAX_GROUPS,
        });
        await ensureBotSource({
          sourceKey: this.userId,
          sourceType: SOURCE_TYPE_USER,
          defaultActivated: !config.BOT_DEACTIVATED,
          maxSources: config.APP_MAX_USERS,
        });
        ({ groupName: name } = await fetchGroup(this.groupId));
      } else {
        current = await ensureBotSource({
          sourceKey: this.userId,
          sourceType: SOURCE_TYPE_USER,
          defaultActivated: !config.BOT_DEACTIVATED,
          maxSources: config.APP_MAX_USERS,
        });
        ({ displayName: name } = await fetchUser(this.userId));
      }
      this.source = new Source({
        type: current.source_type,
        name,
        bot: new Bot({ isActivated: current.is_activated }),
      });
    } catch (err) {
      if (err.code === 'SOURCE_LIMIT_REACHED') {
        throw new Error(t(err.sourceType === SOURCE_TYPE_GROUP
          ? '__ERROR_MAX_GROUPS_REACHED' : '__ERROR_MAX_USERS_REACHED'));
      }
      throw err;
    }
  }

  async transcribeAudio() {
    const buffer = await fetchAudio(this.event.messageId);
    const file = `${this.event.messageId}.m4a`;
    const { text } = await generateTranscription({ file, buffer });
    this.transcription = convertText(text);
  }

  async transcribeImage() {
    const base64String = await fetchImage(this.event.messageId);
    this.transcription = base64String;
  }

  /**
   * @param {Object} param
   * @param {string} param.text
   * @param {Array<string>} param.aliases
   * @returns {boolean}
   */
  hasCommand({
    text,
    aliases,
  }) {
    const content = this.trimmedText.toLowerCase();
    if (aliases.some((alias) => content.startsWith(alias.toLowerCase()))) return true;
    if (content.startsWith(text.toLowerCase())) return true;
    return false;
  }

  /**
   * @param {string} text
   * @param {Array<import('./commands/index.js').Command>} actions
   * @returns {Context}
   */
  pushText(text, actions = []) {
    if (!text) return this;
    const message = new TextMessage({
      type: MESSAGE_TYPE_TEXT,
      text: convertText(text),
    });
    message.setQuickReply(actions);
    this.messages.push(message);
    return this;
  }

  /**
   * @param {string} url
   * @param {Array<import('./commands/index.js').Command>} actions
   * @returns {Context}
   */
  pushImage(url, actions = []) {
    if (!url) return this;
    const message = new ImageMessage({
      type: MESSAGE_TYPE_IMAGE,
      originalContentUrl: url,
      previewImageUrl: url,
    });
    message.setQuickReply(actions);
    this.messages.push(message);
    return this;
  }

  /**
   * @param {string} url
   * @param {Array<import('./commands/index.js').Command>} buttons
   * @param {Array<import('./commands/index.js').Command>} actions
   * @returns {Context}
   */
  pushTemplate(text, buttons = [], actions = []) {
    if (!text) return this;
    const message = new TemplateMessage({
      text,
      actions: buttons,
    });
    message.setQuickReply(actions);
    this.messages.push(message);
    return this;
  }

  /**
   * @param {Error|Object} err
   * @returns {Context}
   */
  pushError(err) {
    this.error = err;
    console.log(this.error.message);
    if (err.code === 'ECONNABORTED') {
      if (config.ERROR_MESSAGE_DISABLED) return this;
      return this.pushText(t('__ERROR_ECONNABORTED'), [COMMAND_BOT_RETRY, COMMAND_BOT_FORGET]);
    }
    if (err.response?.status >= 500) {
      if (config.ERROR_MESSAGE_DISABLED) return this;
      return this.pushText(t('__ERROR_UNKNOWN'), [COMMAND_BOT_RETRY, COMMAND_BOT_FORGET]);
    }
    if (err.config?.baseURL) this.pushText(`${err.config.method.toUpperCase()} ${err.config.baseURL}${err.config.url}`);
    if (err.response) this.pushText(`Request failed with status code ${err.response.status}`);
    this.pushText(err.message);
    return this;
  }
}

export default Context;
