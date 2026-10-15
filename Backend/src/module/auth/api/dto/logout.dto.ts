import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Revoke every session for this user instead of only the current device',
  })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
