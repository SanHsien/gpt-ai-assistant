import { expect, test } from '@jest/globals';
import { validateBearerSecret } from '../../middleware/validate-bearer-secret.js';

test('bearer secret validation fails closed and accepts only an exact value', () => {
  expect(validateBearerSecret('Bearer secret-value', null)).toBe(false);
  expect(validateBearerSecret('', 'secret-value')).toBe(false);
  expect(validateBearerSecret('Bearer wrong-value', 'secret-value')).toBe(false);
  expect(validateBearerSecret('Bearer secret-value-extra', 'secret-value')).toBe(false);
  expect(validateBearerSecret('Bearer secret-value', 'secret-value')).toBe(true);
});
