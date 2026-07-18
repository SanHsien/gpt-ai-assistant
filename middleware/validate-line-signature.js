import config from '../config/index.js';
import { validateSignature } from '../utils/index.js';

const validateLineSignature = (req, res, next) => {
  const { LINE_CHANNEL_SECRET: secret } = config;
  if (!secret) {
    console.error('LINE_CHANNEL_SECRET is required to validate webhook signatures.');
    res.sendStatus(500);
    return;
  }

  const signature = req.header('x-line-signature');
  if (!signature || !validateSignature(req.rawBody || '', secret, signature)) {
    res.sendStatus(403);
    return;
  }
  next();
};

export default validateLineSignature;
