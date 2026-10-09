import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// A real bcrypt hash of a throw-away value. When a login email does not exist
// we still run bcrypt.compare against this, so "unknown email" and "wrong
// password" take about the same time (prevents account enumeration by timing).
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);
