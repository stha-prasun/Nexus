import * as bcrypt from 'bcrypt';
import type { RegisterDto } from '../dto/register.dto';
import { UserFactory } from './user.factory';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

const mockedHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;

describe('UserFactory', () => {
  const dto: RegisterDto = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'Sup3r!Secret',
    role: 'Dev',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHash.mockResolvedValue('$2b$12$hashvalue' as never);
  });

  it('hashes the password with the configured rounds', async () => {
    const factory = new UserFactory(12);

    await factory.create(dto);

    expect(mockedHash).toHaveBeenCalledWith('Sup3r!Secret', 12);
  });

  it('constructs a User from the DTO values', async () => {
    const factory = new UserFactory(10);

    const user = await factory.create(dto);

    expect(user.id).toBeUndefined();
    expect(user.name).toBe('Ada Lovelace');
    expect(user.email).toBe('ada@example.com');
    expect(user.role).toBe('Dev');
    expect(user.passwordHash).toBe('$2b$12$hashvalue');
    expect(user.isVerified).toBe(false);
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('does not re-normalize input (pipe already did)', async () => {
    const factory = new UserFactory(12);
    const rawish = {
      ...dto,
      name: '  Grace   Hopper  ',
      email: 'Grace@Example.com',
    };

    const user = await factory.create(rawish);

    expect(user.name).toBe('  Grace   Hopper  ');
    expect(user.email).toBe('Grace@Example.com');
    expect(mockedHash).toHaveBeenCalledWith(dto.password, 12);
  });
});
