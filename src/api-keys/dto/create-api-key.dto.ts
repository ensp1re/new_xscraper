import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Name of the API key',
    example: 'Production API Key',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description:
      'Expiration date of the API key (not applicable for admin users, who have unlimited access)',
    example: '2023-12-31T23:59:59Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @ApiProperty({
    description:
      'Maximum number of calls allowed (not applicable for admin users, who have unlimited access)',
    example: 1000,
    required: false,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxCalls?: number;
}
