import axios from 'axios';
import config from '../config/index.js';

const deploy = () => axios.post(config.VERCEL_DEPLOY_HOOK_URL);

export default deploy;
