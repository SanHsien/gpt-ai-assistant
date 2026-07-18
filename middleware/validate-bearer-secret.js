import crypto from 'node:crypto';

export const validateBearerSecret = (authorization, secret) => {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(String(authorization || ''));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

export default validateBearerSecret;
