import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  IsEnum,
} from 'class-validator';

export class UpdateApiKeyDto {
  @ApiProperty({
    description: 'Name of the API key',
    example: 'Production API Key',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Status of the API key',
    enum: ['active', 'expired', 'revoked'],
    example: 'active',
    required: false,
  })
  @IsEnum(['active', 'expired', 'revoked'])
  @IsOptional()
  status?: 'active' | 'expired' | 'revoked';

  @ApiProperty({
    description: 'Expiration date of the API key',
    example: '2023-12-31T23:59:59Z',
    required: false,
    nullable: true,
  })
  @IsDateString()
  @IsOptional()
  expiresAt?: string | null;

  @ApiProperty({
    description: 'Maximum number of calls allowed',
    example: 1000,
    required: false,
    nullable: true,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxCalls?: number | null;
}
