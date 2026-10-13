import { Transform } from 'class-transformer';

/** Trim leading/trailing whitespace; non-strings pass through untouched. */
export const Trim = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
