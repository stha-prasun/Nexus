import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

const main = async (): Promise<void> => {
  const email = requiredEnv('SEED_ADMIN_EMAIL').trim().toLowerCase();
  const password = requiredEnv('SEED_ADMIN_PASSWORD');
  const name = process.env.SEED_ADMIN_NAME ?? 'Admin';

  const rawRounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const rounds =
    Number.isFinite(rawRounds) && rawRounds >= 4 && rawRounds <= 31
      ? rawRounds
      : 12;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_HOST_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'nexus',
    password: process.env.POSTGRES_PASSWORD ?? 'nexus_dev_password',
    database: process.env.POSTGRES_DB ?? 'nexus',
  });

  try {
    const passwordHash = await bcrypt.hash(password, rounds);

    const result = await pool.query(
      `INSERT INTO users (email, name, role, password_hash, email_verified_at)
       VALUES ($1, $2, 'Admin', $3, now())
       ON CONFLICT (email) DO UPDATE
       SET password_hash     = EXCLUDED.password_hash,
           name              = EXCLUDED.name,
           role              = 'Admin',
           email_verified_at = now()
       RETURNING id, email, name, role`,
      [email, name, passwordHash],
    );

    const row = result.rows[0];
    const action =
      row && (row as { xmax?: number }).xmax === 0 ? 'created' : 'updated';
    console.log(`Admin seeded: ${email} (${action})`);
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Admin seed failed:', error);
  process.exit(1);
});
