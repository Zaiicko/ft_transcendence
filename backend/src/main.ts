import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ensureUploadDirs, UPLOADS_ROOT } from './common/uploads';

async function bootstrap() {
  ensureUploadDirs();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
