import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ensureUploadDirs, UPLOADS_ROOT } from './common/uploads';
import { SentryExceptionFilter } from './common/sentry-exception.filter';

// Self-hosted GlitchTip (Sentry-protocol compatible), not Sentry SaaS — see
// docker-compose.prod.yml. No-ops locally/in dev where SENTRY_DSN is unset.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development' });
  process.on('unhandledRejection', (reason) => Sentry.captureException(reason));
  process.on('uncaughtException', (err) => Sentry.captureException(err));
}

async function bootstrap() {
  ensureUploadDirs();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (process.env.SENTRY_DSN) {
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));
  }

  app.setGlobalPrefix('api');
  // Standard hardening headers (X-Content-Type-Options, X-Frame-Options,
  // HSTS, ...). The SPA itself is served by the frontend/nginx containers,
  // not this app, so no CSP tuning is needed here — this backend only ever
  // returns JSON and uploaded images.
  app.use(helmet());
  app.use(cookieParser());
  app.useWebSocketAdapter(new IoAdapter(app));
  // Served under /api so the existing nginx `/api` location handles it — no nginx routing change needed.
  app.useStaticAssets(UPLOADS_ROOT, { prefix: '/api/uploads' });

  // Server-side validation of every incoming payload (subject requirement)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(3000);
}
bootstrap();
