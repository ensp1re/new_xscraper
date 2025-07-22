import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { Logger } from '@nestjs/common';

dotenv.config();

const logger = new Logger('MigrationLogger');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
  });

  const db = drizzle(pool);

  logger.log('Starting migrations...');
  await migrate(db, { migrationsFolder: 'src/database/migrations' });
  logger.log('Migrations completed successfully!');

  await pool.end();

  setTimeout(() => process.exit(0), 100);
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
});

main().catch((err) => {
  logger.error('Error during migration:', err);
  process.exit(1);
});
