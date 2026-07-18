import { expect, test } from '@jest/globals';
import TemplateMessage from '../../../app/messages/template.js';

test('template buttons serialize links as LINE URI actions', () => {
  const message = new TemplateMessage({
    text: 'Connect',
    actions: [{ label: 'Authorize', uri: 'https://accounts.google.com/auth' }],
  });
  expect(message.template.actions[0]).toMatchObject({
    type: 'uri', label: 'Authorize', uri: 'https://accounts.google.com/auth',
  });
});

test('template buttons keep internal ids in postback data instead of visible text', () => {
  const message = new TemplateMessage({
    text: 'Confirm?',
    actions: [{
      label: '確認行程',
      data: '確認行程 65e39296-9da6-46c2-8ae7-1874ce286b95',
      displayText: '確認行程',
    }],
  });
  expect(message.template.actions[0]).toMatchObject({
    type: 'postback',
    label: '確認行程',
    data: '確認行程 65e39296-9da6-46c2-8ae7-1874ce286b95',
    displayText: '確認行程',
  });
  expect(message.template.actions[0]).not.toHaveProperty('text');
});
