import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Réplique la config globale de main.ts — un test e2e doit traverser les
// mêmes pipes/adapters que la prod, sinon il ne teste pas la vraie API
export async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Vrai listen (port aléatoire) et pas juste init() : Socket.IO en a besoin
  await app.listen(0);
  return app;
}

export function appPort(app: NestExpressApplication): number {
  return (app.getHttpServer().address() as AddressInfo).port;
}

// Vide les tables touchées par les tests ; CASCADE emporte les dépendantes
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User", "Review", "ReviewComment", "Game", "Company" RESTART IDENTITY CASCADE',
  );
}

export const PASSWORD = 'SuperSecret42!';

// Les cookies d'auth sont Secure (stack HTTPS via nginx) : le jar de
// superagent refuse à juste titre de les renvoyer sur le HTTP des tests.
// On extrait donc le cookie du Set-Cookie et on le pose nous-mêmes.
function withCookie(app: NestExpressApplication, cookie: string) {
  const server = app.getHttpServer() as Parameters<typeof request>[0];
  const wrap = (req: request.Test) => (cookie ? req.set('Cookie', cookie) : req);
  return {
    cookie, // exposé pour les tests WS (handshake Socket.IO authentifié)
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
