import 'dotenv/config';
import { execSync } from 'child_process';

/** Creates a clean schema in the TEST database once before the whole run. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');

  // Safety net: `--force-reset` wipes the database, so refuse anything that does not look like a test DB.
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes('test')) {
    throw new Error(`Refusing to reset database "${dbName}": its name must contain "test".`);
  }
  if (process.env.SKIP_DB_PUSH) return; // lets CI/sandboxes prepare the schema themselves

  execSync('npx prisma db push --force-reset --skip-generate', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
