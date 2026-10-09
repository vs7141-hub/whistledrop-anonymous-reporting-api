import { createHmac, randomBytes } from 'crypto';
import { env } from '../config/env';

/**
 * CASE CODE DESIGN
 *  - 15 random bytes from crypto.randomBytes (the OS CSPRNG) = 120 bits of entropy
 *  - encoded in Crockford Base32 (no I, L, O, U -> fewer typos when written down)
 *    15 bytes * 8 = 120 bits = exactly 24 characters, no padding
 *  - shown as WD-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX so it is easy to copy
 *
 * 2^120 ~ 1.3 * 10^36 possible codes. Even at a billion guesses per second,
 * trying them all would take far longer than the age of the universe - and
 * our rate limiter allows only a handful of wrong guesses per IP.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 15;

export const CASE_CODE_REGEX = /^WD(?:-[0-9A-HJKMNP-TV-Z]{4}){6}$/;

function toBase32(buf: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1; // keep only the bits we have not used yet
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function generateCaseCode(): string {
  const raw = toBase32(randomBytes(CODE_BYTES)); // 24 chars
  return 'WD-' + raw.match(/.{4}/g)!.join('-');
}

/** Users may type the code in lower case or with spaces around it. */
export function normalizeCaseCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * What we store in the database.
 *
 * Why HMAC-SHA256 and not bcrypt?
 *  - We must find a report FROM the code, so the hash has to be deterministic
 *    (bcrypt adds a random salt -> same input gives a different hash -> no lookup).
 *  - The code already has 120 bits of entropy, so a slow hash adds nothing;
 *    slow hashes only help for low-entropy secrets such as human passwords.
 *  - The secret "pepper" (kept in .env, NOT in the DB) means a leaked database
 *    alone cannot be used to verify guessed codes.
 *
 * Trade-off: if we lose the code we cannot recover it (we only have the hash),
 * and changing CASE_CODE_PEPPER would invalidate every existing code.
 */
export function hashCaseCode(code: string): string {
  return createHmac('sha256', env.CASE_CODE_PEPPER).update(code).digest('hex');
}
