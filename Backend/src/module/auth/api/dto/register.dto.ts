import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsStrongPassword,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail, NormalizeName } from '../../../../common/decorators';

/**
 * Registration grants nothing but the account itself — there is deliberately
 * **no `role` field** (the whitelist pipe silently strips any client-sent
 * `role`; the factory persists `DEFAULT_ROLE`). Role enters an account only
 * via invite accept or the seed script (§members 5.4).
 */
export class RegisterDto {
  @ApiProperty({ example: 'Ada Lovelace', minLength: 2, maxLength: 100 })
  @IsString()
  @NormalizeName()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\p{L}/u, { message: 'Name must contain at least one letter' })
  name!: string;

  @ApiProperty({ example: 'ada@example.com', maxLength: 254 })
  @IsString()
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @IsStrongPassword(
    {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message:
        'Password needs 8+ characters with upper, lower, number and symbol',
    },
  )
  password!: string;
}
