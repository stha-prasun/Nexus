import { Transform } from 'class-transformer';

/**
 * Normalize an email address: trim, lowercase, then strip control characters.
 * Non-strings pass through untouched.
 */
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return value
      .trim()
      .toLowerCase()
      .replace(/\p{Cc}/gu, '');
  });
