import { validateSync } from 'class-validator';
import { REGISTERABLE_ROLES, ROLES } from '../constants/auth.constants';
import { RegisterDto } from './register.dto';

describe('RegisterDto role', () => {
  const dto = (role: unknown): RegisterDto => {
    const instance = new RegisterDto();
    instance.name = 'Ada Lovelace';
    instance.email = 'ada@example.com';
    instance.password = 'Str0ng!Pass';
    instance.role = role as RegisterDto['role'];
    return instance;
  };

  const roleErrors = (role: unknown): number =>
    validateSync(dto(role)).filter((error) => error.property === 'role').length;

  it.each(REGISTERABLE_ROLES)('accepts the registerable role %s', (role) => {
    expect(roleErrors(role)).toBe(0);
  });

  it("rejects 'Admin' — provisioned internally, never self-registered", () => {
    expect(roleErrors('Admin')).toBeGreaterThan(0);
  });

  it('rejects unknown values', () => {
    expect(roleErrors('Owner')).toBeGreaterThan(0);
    expect(roleErrors('')).toBeGreaterThan(0);
  });

  it('REGISTERABLE_ROLES is a subset of ROLES and HR is registerable', () => {
    for (const role of REGISTERABLE_ROLES) {
      expect(ROLES).toContain(role);
    }
    expect(REGISTERABLE_ROLES).toContain('HR');
  });
});
