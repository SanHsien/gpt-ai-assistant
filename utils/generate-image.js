import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { createImage } from '../services/openai.js';
import uploadImage from './upload-image.js';

class Image {
  url;

  constructor({
    url,
  }) {
    this.url = url;
  }
}

/**
 * @param {Object} param
 * @param {string} param.prompt
 * @returns {Promise<Image>}
 */
const generateImage = async ({
  prompt,
}) => {
  if (config.APP_ENV !== 'production') return new Image({ url: MOCK_TEXT_OK });
  const { data } = await createImage({ prompt });
  const [image] = data.data;
  // DALL-E returns a URL; GPT Image returns base64 that LINE needs exposed through Blob.
  if (image?.url) return new Image({ url: image.url });
  if (image?.b64_json) return new Image({ url: await uploadImage(image.b64_json) });
  return new Image({});
};

export default generateImage;
