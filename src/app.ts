import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import routes from './routes';
import { openApiSpec } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { globalLimiter } from './middleware/rateLimiters';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

// Swagger UI needs inline scripts, so it gets its own relaxed Helmet config.
// It is mounted BEFORE the strict Helmet below and only serves documentation.
app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));
app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use(helmet()); // secure default headers for everything else
app.use(
  cors({
    // No CORS_ORIGINS configured = cross-origin browser calls are refused.
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(requestLogger);
app.use(globalLimiter);
app.use(express.json({ limit: '10kb' })); // reports are text; 10 KB is plenty and blocks huge payloads

// Case status and moderator data must never be cached by browsers or proxies.
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
