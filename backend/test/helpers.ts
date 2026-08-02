import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Mirrors main.ts's global setup: an e2e test must go through the same pipes
// and adapters as production, or it isn't testing the real API
export async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // A real listen on a random port, not just init(): Socket.IO needs it
  await app.listen(0);
  return app;
}

export function appPort(app: NestExpressApplication): number {
  return (app.getHttpServer().address() as AddressInfo).port;
}

// Empties the tables the tests touch; CASCADE takes the dependants with them
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User", "Review", "ReviewComment", "Game", "Company" RESTART IDENTITY CASCADE',
  );
}

export const PASSWORD = 'SuperSecret42!';

// Auth cookies are Secure (the stack is HTTPS behind nginx), so superagent's
// jar rightly refuses to send them over the tests' plain HTTP. The cookie is
// pulled out of Set-Cookie and set by hand instead.
function withCookie(app: NestExpressApplication, cookie: string) {
  const server = app.getHttpServer() as Parameters<typeof request>[0];
  const wrap = (req: request.Test) => (cookie ? req.set('Cookie', cookie) : req);
  return {
    cookie, // exposed for the WS tests (authenticated Socket.IO handshake)
    get: (url: string) => wrap(request(server).get(url)),
    post: (url: string) => wrap(request(server).post(url)),
    patch: (url: string) => wrap(request(server).patch(url)),
    delete: (url: string) => wrap(request(server).delete(url)),
  };
}

export type Agent = ReturnType<typeof withCookie>;

export async function signup(app: NestExpressApplication, name: string): Promise<Agent> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/signup')
    .send({ email: `${name}@test.com`, username: name, password: PASSWORD })
    .expect(201);
  const setCookies: string[] = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie']
    : [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  return withCookie(app, cookie);
}

export function anonymous(app: NestExpressApplication): Agent {
  return withCookie(app, '');
}
