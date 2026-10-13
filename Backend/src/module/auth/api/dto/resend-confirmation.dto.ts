import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../../../common/decorators';

export class ResendConfirmationDto {
  @ApiProperty({ example: 'ada@example.com', maxLength: 254 })
  @IsString()
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;
}
