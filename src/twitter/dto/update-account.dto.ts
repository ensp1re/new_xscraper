import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateAccountDto {
  @ApiPropertyOptional({
    description: 'Account password',
    example: 'newSecurePassword123',
  })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({
    description: 'Email associated with the account',
    example: 'newuser@example.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: '2FA secret key',
    example: 'L6WMEK36OOKIKD6U',
  })
  @IsString()
  @IsOptional()
  '2fa'?: string;

  @ApiPropertyOptional({
    description: 'Whether the account is usable',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  usable?: boolean;
}
