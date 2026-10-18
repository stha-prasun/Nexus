import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  const dto = (): RegisterDto => {
    const instance = new RegisterDto();
    instance.name = 'Ada Lovelace';
    instance.email = 'ada@example.com';
    instance.password = 'Str0ng!Pass';
    return instance;
  };

  it('validates with no role field present', () => {
    expect(validateSync(dto())).toEqual([]);
  });

  it('has no role property at all — a client-sent `role` is an unknown field the whitelist strips', () => {
    expect('role' in new RegisterDto()).toBe(false);
  });

  it('still rejects an invalid email and a weak password', () => {
    const weak = dto();
    weak.email = 'not-an-email';
    weak.password = 'short';
    const errors = validateSync(weak);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'email',
      'password',
    ]);
  });
});
