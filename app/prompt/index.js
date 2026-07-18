import config from '../../config/index.js';
import Prompt from './prompt.js';

const prompts = new Map();

/**
 * @param {string} userId
 * @returns {Prompt}
 */
const getPrompt = (userId) => {
  const prompt = prompts.get(userId);
  if (!prompt) return new Prompt();
  if (config.APP_MAX_PROMPT_AGE > 0 && Date.now() - prompt.updatedAt > config.APP_MAX_PROMPT_AGE * 1000) {
    prompts.delete(userId);
    return new Prompt();
  }
  return prompt;
};

/**
 * @param {string} userId
 * @param {Prompt} prompt
 */
const setPrompt = (userId, prompt) => {
  prompts.set(userId, prompt);
};

/**
 * @param {string} userId
 */
const removePrompt = (userId) => {
  prompts.delete(userId);
};

const printPrompts = () => {
  if (Array.from(prompts.keys()).length < 1) return;
  const content = Array.from(prompts.keys()).map((userId) => `\n=== ${userId.slice(0, 6)} ===\n${getPrompt(userId)}\n`).join('');
  console.info(content);
};

export {
  Prompt,
  getPrompt,
  setPrompt,
  removePrompt,
  printPrompts,
};

export default prompts;
