import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ApiKeysService } from '../../api-keys/api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      this.logger.warn('API key missing in request');
      throw new UnauthorizedException('API key is required');
    }

    try {
      const { isValid, apiKey: keyDetails } =
        await this.apiKeysService.validateApiKey(apiKey);

      if (!isValid) {
        this.logger.warn(`Invalid API key: ${apiKey.substring(0, 8)}...`);
        throw new UnauthorizedException('Invalid or expired API key');
      }

      request.user = {
        id: keyDetails.userId,
        isAdmin: keyDetails.isAdmin,
        apiKeyId: keyDetails.id,
        unlimited: keyDetails.isAdmin,
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(
        `API key validation error: ${error.message}`,
        error.stack,
      );
      throw new UnauthorizedException('Invalid API key');
    }
  }
}
