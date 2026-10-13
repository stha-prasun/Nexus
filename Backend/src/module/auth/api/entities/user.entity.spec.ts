import { User } from './user.entity';

const buildUser = (
  overrides: Partial<ConstructorParameters<typeof User>[0]> = {},
) =>
  new User({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'Dev',
    passwordHash: 'hashed',
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

describe('User', () => {
  it('exposes props via getters', () => {
    const user = buildUser({ id: 7 });

    expect(user.id).toBe(7);
    expect(user.name).toBe('Ada Lovelace');
    expect(user.email).toBe('ada@example.com');
    expect(user.role).toBe('Dev');
    expect(user.passwordHash).toBe('hashed');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  describe('isVerified', () => {
    it('is false when emailVerifiedAt is null', () => {
      expect(buildUser().isVerified).toBe(false);
    });

    it('is true when emailVerifiedAt is set', () => {
      expect(buildUser({ emailVerifiedAt: new Date() }).isVerified).toBe(true);
    });
  });

  describe('markEmailVerified', () => {
    it('sets emailVerifiedAt on an unverified account', () => {
      const user = buildUser();
      const at = new Date('2026-02-01T12:00:00Z');

      user.markEmailVerified(at);

      expect(user.emailVerifiedAt).toEqual(at);
      expect(user.isVerified).toBe(true);
    });

    it('is a no-op when already verified', () => {
      const original = new Date('2026-01-15T00:00:00Z');
      const user = buildUser({ emailVerifiedAt: original });

      user.markEmailVerified(new Date('2026-03-01T00:00:00Z'));

      expect(user.emailVerifiedAt).toEqual(original);
    });

    it('defaults the timestamp to now', () => {
      const user = buildUser();
      const before = Date.now();

      user.markEmailVerified();

      expect(user.emailVerifiedAt?.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});
