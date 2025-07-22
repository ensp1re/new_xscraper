import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TwitterModule } from './twitter/twitter.module';
import { AuthModule } from './auth/auth.module';
import { validate } from './config/env.validation';
import { DrizzleModule } from './database/drizzle.module';
import { UsersController } from './users/users.controller';
import { UsersModule } from './users/users.module';
import { ApiKeysController } from './api-keys/api-keys.controller';
import { ApiKeysService } from './api-keys/api-keys.service';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    DrizzleModule,
    TwitterModule,
    AuthModule,
    UsersModule,
    ApiKeysModule,
  ],
  controllers: [UsersController, ApiKeysController],
  providers: [ApiKeysService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
