// 上游 PR／issue 兩個面向的契約測試。
// 每一條擋的都是「這個面向在沒有人決定的情況下悄悄不再被檢查」的一種方式。
// 測試不打網路：`gh` 一律注入。

import { expect, test } from '@jest/globals';
import {
  collectNewTickets,
  loadBaseline,
  renderTicketMarkdown,
  upstreamSlug,
} from '../tools/check-upstream-updates.js';

const baselineWith = (overrides = {}) => ({
  repo: 'https://github.com/example/product.git',
  branch: 'main',
  reviewedThrough: 'a'.repeat(40),
  reviewedDate: '2026-08-29',
  reviewedPrThrough: 9,
  reviewedIssueThrough: 8,
  ...overrides,
});

const fakeGh = (payload) => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  };
  gh.calls = calls;
  return gh;
};

test('查詢一律送 --state all', () => {
  // 開了又關、沒有合併的 PR 永遠不會出現在 commit 軸上。
  const gh = fakeGh([{ number: 10, title: '未合併就關閉' }]);

  collectNewTickets(baselineWith(), 'pr', { gh });

  const args = gh.calls[0];
  expect(args[args.indexOf('--state') + 1]).toBe('all');
});

test('已審視編號以下的項目不會被重複列出', () => {
  const gh = fakeGh([
    { number: 9, title: '已審視過' },
    { number: 11, title: '新的' },
  ]);

  const tickets = collectNewTickets(baselineWith(), 'pr', { gh });

  expect(tickets.map((ticket) => ticket.number)).toEqual([11]);
});

test('gh 失敗回 null 而不是空清單', () => {
  // 「沒查到」不可以在綠色報告裡長得跟「沒有」一樣。
  expect(collectNewTickets(baselineWith(), 'issue', { gh: () => null })).toBeNull();
});

test('gh 輸出解析不了也回 null', () => {
  expect(collectNewTickets(baselineWith(), 'pr', { gh: () => 'not json' })).toBeNull();
});

test('baseline 沒有指向 GitHub repo 時回 null', () => {
  const tickets = collectNewTickets(
    baselineWith({ repo: 'https://gitlab.com/example/product.git' }),
    'pr',
    { gh: fakeGh([]) },
  );

  expect(tickets).toBeNull();
});

test('列舉不到時報告要寫「未檢查」', () => {
  expect(renderTicketMarkdown(baselineWith(), null, null)).toContain('未檢查');
});

test('報告涵蓋兩個面向並印出各自的已審視編號', () => {
  const report = renderTicketMarkdown(baselineWith(), [], []);

  expect(report).toContain('## 上游 Pull requests');
  expect(report).toContain('## 上游 Issues');
  expect(report).toContain('`#9`');
  expect(report).toContain('`#8`');
});

test('upstreamSlug 認得 git 實際會產生的幾種 URL 形狀', () => {
  expect(upstreamSlug('https://github.com/example/product.git')).toBe('example/product');
  expect(upstreamSlug('https://github.com/example/product')).toBe('example/product');
  expect(upstreamSlug('git@github.com:example/product.git')).toBe('example/product');
  expect(upstreamSlug('https://gitlab.com/example/product.git')).toBeNull();
});

test('落地的 baseline 真的帶著兩個數字', () => {
  // 只有紀錄、沒有人讀，不算檢查；這條釘住那兩個欄位存在且是數字。
  const baseline = loadBaseline();

  expect(typeof baseline.reviewedPrThrough).toBe('number');
  expect(typeof baseline.reviewedIssueThrough).toBe('number');
});
