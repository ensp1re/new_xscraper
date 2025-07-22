import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class TwitterAccountDto {
  @ApiProperty({
    description: 'Twitter username',
    example: 'twitteruser123',
  })
  @IsString()
  username: string;

  @ApiProperty({
    description: 'Account password',
    example: 'securePassword123',
  })
  @IsString()
  password: string;

  @ApiProperty({
    description: 'Email associated with the account',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: '2FA secret key',
    example: 'L6WMEK36OOKIKD6U',
  })
  @IsString()
  '2fa': string;

  @ApiPropertyOptional({
    description: 'Whether the account is usable',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  usable?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the account has cookies stored',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  hasCookies?: boolean;
}
