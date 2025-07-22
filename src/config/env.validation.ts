import { plainToClass } from 'class-transformer';
import { IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsOptional()
  JWT_SECRET?: string = 'defaultSecret';

  @IsNumber()
  @IsOptional()
  JWT_EXPIRATION?: number = 3600;

  @IsNumber()
  @IsOptional()
  PORT?: number = 3000;

  @IsString()
  @IsOptional()
  DEFAULT_PROXY_URL?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  console.log('Validated config:', {
    PORT: validatedConfig.PORT,
    JWT_EXPIRATION: validatedConfig.JWT_EXPIRATION,
    HAS_JWT_SECRET: !!validatedConfig.JWT_SECRET,
    HAS_PROXY_URL: !!validatedConfig.DEFAULT_PROXY_URL,
  });

  return validatedConfig;
}
