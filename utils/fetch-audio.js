import { fetchContent } from '../services/line.js';

const AUDIO_CONTENT_TYPE_EXTENSIONS = new Map([
  ['audio/mpeg', '.mp3'],
  ['audio/mp3', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/x-m4a', '.m4a'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/webm', '.webm'],
  ['video/webm', '.webm'],
]);

const detectAudioExtension = ({ contentType, buffer }) => {
  const normalizedType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  const fromHeader = AUDIO_CONTENT_TYPE_EXTENSIONS.get(normalizedType);
  if (fromHeader) return fromHeader;

  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return '.wav';
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3'
    || (buffer[0] === 0xff && buffer[1] >= 0xe0)) return '.mp3';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return '.m4a';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return '.webm';
  return '.m4a';
};

/**
 * @param {string} messageId
 * @returns {Promise<{buffer: Buffer, extension: string}>}
 */
const fetchAudio = async (messageId) => {
  const { data, headers } = await fetchContent({ messageId });
  const buffer = Buffer.from(data, 'binary');
  return {
    buffer,
    extension: detectAudioExtension({
      contentType: headers?.['content-type'] || headers?.get?.('content-type'),
      buffer,
    }),
  };
};

export { detectAudioExtension };
export default fetchAudio;
