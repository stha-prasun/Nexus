import { Transform } from 'class-transformer';

/**
 * Normalize a person name: trim, collapse internal whitespace to a single
 * space, then strip control characters (log-injection hygiene). Non-strings
 * pass through untouched.
 */
export const NormalizeName = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\p{Cc}/gu, '');
  });
