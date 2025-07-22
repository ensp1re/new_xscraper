import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Username',
    example: 'admin',
  })
  @IsString()
  username: string;

  @ApiProperty({
    description: 'Password',
    example: 'admin123',
  })
  @IsString()
  @MinLength(6)
  password: string;
}
