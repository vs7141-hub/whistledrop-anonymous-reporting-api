// Runs before every test file. Forces test-only settings so tests can NEVER touch the dev database.
import 'dotenv/config';

const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDb;
process.env.JWT_SECRET = 'test_jwt_secret_0123456789_0123456789_abcdef';
process.env.CASE_CODE_PEPPER = 'test_pepper_0123456789_0123456789_abcdef_xyz';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing in tests only
// Generous limits so normal tests are never throttled; rateLimit.test.ts lowers them.
process.env.GLOBAL_RATE_LIMIT_MAX = '100000';
process.env.REPORT_RATE_LIMIT_MAX = '100000';
process.env.LOOKUP_FAILED_MAX = '100000';
process.env.LOGIN_FAILED_MAX = '100000';
