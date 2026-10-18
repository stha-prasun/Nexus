import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS, DEFAULT_ROLE } from '../constants/auth.constants';
import type { RegisterDto } from '../dto/register.dto';
import { User } from '../entities/user.entity';

/**
 * Builds `User` entities from validated DTOs. Hashing is its only real job;
 * the ValidationPipe + DTO normalizer decorators already cleaned the input
 * (single source of truth), so this factory never re-normalizes. The role is
 * always `DEFAULT_ROLE` — registration never grants a role (§members 5.4).
 */
@Injectable()
export class UserFactory {
  constructor(@Inject(BCRYPT_ROUNDS) private readonly rounds: number) {}

  async create(dto: RegisterDto): Promise<User> {
    return new User({
      name: dto.name,
      email: dto.email,
      role: DEFAULT_ROLE,
      passwordHash: await bcrypt.hash(dto.password, this.rounds),
      emailVerifiedAt: null,
      createdAt: new Date(),
    });
  }
}
