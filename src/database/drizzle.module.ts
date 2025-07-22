import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { Logger } from '@nestjs/common';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'DRIZZLE_ORM',
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger('DrizzleModule');
        const pool = new Pool({
          connectionString: configService.get<string>('DATABASE_URL'),
          ssl:
            configService.get<string>('NODE_ENV') === 'production'
              ? { rejectUnauthorized: false }
              : false,
        });

        pool.on('error', (err) => {
          logger.error('Database connection error', err.stack);
        });

        pool.on('connect', () => {
          logger.warn('Database connection established');
        });

        return drizzle(pool, { schema });
      },
    },
  ],
  exports: ['DRIZZLE_ORM'],
})
export class DrizzleModule {}
