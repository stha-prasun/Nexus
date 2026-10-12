import { AppLogger } from './logger';

const ESC = String.fromCharCode(27);

describe('AppLogger', () => {
  const ENV_KEYS = [
    'LOG_LEVEL',
    'LOG_JSON',
    'NO_COLOR',
    'FORCE_COLOR',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  let write: jest.SpyInstance;

  const output = (): string =>
    write.mock.calls.map((call) => String(call[0])).join('');

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NO_COLOR = '1';
    write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    write.mockRestore();
  });

  it('formats timestamp, level, context, message and fields', () => {
    new AppLogger().child('http').info('server ready', { port: 3000 });

    expect(output()).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} INFO {2}\[http\] server ready port=3000\n$/,
    );
  });

  it('quotes field values that contain spaces', () => {
    new AppLogger().child('db').warn('slow query', { sql: 'SELECT 1' });
    new AppLogger().child('db').warn('slow', { sql: 'SELECT * FROM t' });

    expect(output()).toContain('sql="SELECT * FROM t"');
    expect(output()).not.toContain('sql=SELECT *');
  });

  it('drops undefined field values', () => {
    new AppLogger().child('http').info('ready', {
      port: undefined,
      host: '0.0.0.0',
    });

    expect(output()).toContain('host=0.0.0.0');
    expect(output()).not.toContain('port=');
  });

  it('filters below the configured LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'warn';
    const log = new AppLogger().child('app');

    log.debug('debug hidden');
    log.info('info hidden');
    log.warn('warn visible');
    log.error('error visible');

    const text = output();
    expect(text).not.toContain('hidden');
    expect(text).toContain('warn visible');
    expect(text).toContain('error visible');
  });

  it('writes nothing at LOG_LEVEL=silent', () => {
    process.env.LOG_LEVEL = 'silent';
    new AppLogger().child('app').error('boom');
    expect(output()).toBe('');
  });

  it('falls back to info for an unknown LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'verbose';
    const log = new AppLogger().child('app');
    log.debug('hidden');
    log.info('visible');
    expect(output()).not.toContain('hidden');
    expect(output()).toContain('visible');
  });

  it('emits one JSON object per line in LOG_JSON mode', () => {
    process.env.LOG_JSON = 'true';
    new AppLogger().child('http').info('served', { route: '/health' });

    const parsed = JSON.parse(output().trim());
    expect(parsed).toMatchObject({
      level: 'info',
      context: 'http',
      msg: 'served',
      route: '/health',
    });
    expect(typeof parsed.time).toBe('string');
  });

  it('colorizes the level with green, yellow and red when enabled', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    const log = new AppLogger().child('app');

    log.info('ok');
    log.warn('careful');
    log.error('boom');

    const text = output();
    expect(text).toContain(`${ESC}[32m`); // info → green
    expect(text).toContain(`${ESC}[33m`); // warn → yellow
    expect(text).toContain(`${ESC}[31m`); // error → red
  });

  it('appends the trailer on the following line', () => {
    const trailer = '├── postgres SELECT 1   3.10ms   25%';
    new AppLogger().child('http').info('200 GET /health', undefined, trailer);

    expect(output()).toContain(`200 GET /health\n${trailer}\n`);
  });

  it('supports Nest-style log(message, context)', () => {
    new AppLogger().log('Nest application successfully started', 'AppModule');

    expect(output()).toContain(
      '[AppModule] Nest application successfully started',
    );
    expect(output()).toContain(' INFO ');
  });

  it('keeps multi-line stack traces on a single line via fields', () => {
    new AppLogger().error('request failed', 'AppModule', 'Error: boom\n  at x');

    const text = output();
    expect(text).toContain('[AppModule]');
    expect(text).toContain('stack=');
    expect(text.split('\n')).toHaveLength(2); // line + trailing newline only
  });
});
