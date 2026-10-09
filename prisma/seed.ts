import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import { seedAdminSchema } from '../src/schemas';

/**
 * Creates the FIRST account (an ADMIN who can also moderate and can create
 * more moderators through the API). Credentials come from environment
 * variables, so no password is ever written in the source code.
 */
async function main() {
  const parsed = seedAdminSchema.safeParse({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  if (!parsed.success) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 chars) before running the seed.');
    for (const i of parsed.error.issues) console.error(` - ${i.path.join('.')}: ${i.message}`);
    process.exit(1);
  }
  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.moderator.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists - nothing to do.`);
    return;
  }
  await prisma.moderator.create({
    data: { email, passwordHash: await hashPassword(parsed.data.password), role: 'ADMIN' },
  });
  console.log(`Created admin account: ${email}`); // the password is never printed
}

main().finally(() => prisma.$disconnect());
