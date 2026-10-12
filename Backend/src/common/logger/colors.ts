const ESC = '\u001b[';

export const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
} as const;

export type ColorName = keyof typeof CODES;

const paint = (code: number, text: string): string =>
  `${ESC}${code}m${text}${ESC}0m`;

/**
 * Color output is disabled when piping to a file, when NO_COLOR is set, or
 * when stdout is not a TTY — so `npm run start:dev > log.txt` stays clean.
 */
export const colorEnabled = (): boolean => {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) {
    return process.env.FORCE_COLOR !== '0';
  }
  return Boolean(process.stdout.isTTY);
};

export const colorize = (text: string, ...names: ColorName[]): string => {
  if (!colorEnabled() || names.length === 0) return text;
  return names.reduce((acc, name) => paint(CODES[name], acc), text);
};

export const green = (text: string): string => colorize(text, 'green');
export const yellow = (text: string): string => colorize(text, 'yellow');
export const red = (text: string): string => colorize(text, 'red');
export const dim = (text: string): string => colorize(text, 'dim');
export const cyan = (text: string): string => colorize(text, 'cyan');
export const gray = (text: string): string => colorize(text, 'gray');
export const bold = (text: string): string => colorize(text, 'bold');
