import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const user = process.env.POSTGRES_USER ?? 'nexus';
const password = process.env.POSTGRES_PASSWORD ?? 'nexus_dev_password';
const host = process.env.POSTGRES_HOST ?? 'localhost';
const database = process.env.POSTGRES_DB ?? 'nexus';
// Migrations run against the direct server port; transaction-mode PgBouncer
// (POSTGRES_PORT=6432) is not safe for DDL. See POSTGRES_HOST_PORT in .env.
const port = process.env.POSTGRES_HOST_PORT ?? '5432';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/module/database/schema',
  out: './drizzle',
  dbCredentials: {
    url: `postgresql://${user}:${password}@${host}:${port}/${database}`,
  },
});
