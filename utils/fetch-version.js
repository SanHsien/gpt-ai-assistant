import axios from 'axios';
import config from '../config/index.js';

/**
 * @returns {Promise<string>}
 */
const fetchVersion = async () => {
  const { data } = await axios.get(
    'https://raw.githubusercontent.com/SanHsien/gpt-ai-assistant/main/package.json',
    { timeout: config.APP_API_TIMEOUT },
  );
  return data.version;
};

export default fetchVersion;
