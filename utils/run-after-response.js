import { waitUntil } from '@vercel/functions';

/**
 * 請平台在回應送出後仍保留函式生命週期，直到 promise 結束。
 * 不在 Vercel request context 時（本機 `npm run dev`、測試）waitUntil 會丟錯：
 * 此時 promise 本來就在既有 process 裡跑，直接忽略即可。
 * @param {Promise<*>} promise 已在執行中的工作
 * @returns {Promise<*>} 同一個 promise
 */
const runAfterResponse = (promise) => {
  try {
    waitUntil(promise);
  } catch {
    // 本機／測試環境沒有 request context，無需延長生命週期。
  }
  return promise;
};

export default runAfterResponse;
