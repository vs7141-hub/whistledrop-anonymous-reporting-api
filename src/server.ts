import app from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

const server = app.listen(env.PORT, () => {
  console.log(`WhistleDrop API listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`API docs: http://localhost:${env.PORT}/api/docs`);
});

// Close connections cleanly when the process is stopped.
const shutdown = () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
