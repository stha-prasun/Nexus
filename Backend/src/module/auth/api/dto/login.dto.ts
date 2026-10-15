import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail } from '../../../../common/decorators';

export class LoginDto {
  @ApiProperty({ example: 'ada@example.com', maxLength: 254 })
  @IsString()
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  /** No strength policy on login — the policy can change, passwords can't. */
  @ApiProperty({ minLength: 1, maxLength: 72 })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;

  @ApiProperty({
    description: 'Extend the session to the remember TTL (7d) instead of 24h',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
