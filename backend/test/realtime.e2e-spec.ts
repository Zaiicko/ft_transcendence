import { NestExpressApplication } from '@nestjs/platform-express';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../src/prisma/prisma.service';
import { appPort, createApp, resetDb, signup } from './helpers';

function waitForEvent<T>(socket: Socket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout en attendant "${event}"`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Temps réel — rooms et évènements Socket.IO', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let client: Socket;
  let gameId: number;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    gameId = (await prisma.game.create({ data: { igdbId: 40, title: 'Live Game' } })).id;

    client = io(`http://127.0.0.1:${appPort(app)}`, { transports: ['websocket'] });
    await waitForEvent(client, 'connect');
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it('une socket anonyme reste connectée (le gateway presence ne doit pas l’éjecter)', async () => {
    // Regression guard: the Socket.IO server is shared with PresenceGateway,
    // and reading reviews is public, so anonymous sockets must not be kicked
    await sleep(300);
    expect(client.connected).toBe(true);
  });

  it('la room du jeu reçoit created, reaction et comment:changed', async () => {
    client.emit('game:join', gameId);
    await sleep(150); // le join est asynchrone côté serveur

    const alice = await signup(app, 'liveAlice');
    const bob = await signup(app, 'liveBob');

    const created = waitForEvent<{ id: number; title: string }>(client, 'review:created');
    const { body: review } = await alice
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'En direct', rating: 8, text: 'poussée en room' })
      .expect(201);
    expect((await created).id).toBe(review.id);

    // the reaction event carries fresh counters, so no re-fetch is needed
    const reaction = waitForEvent<{ reviewId: number; likes: number; dislikes: number }>(
      client,
      'review:reaction',
    );
    await bob.post(`/api/reviews/${review.id}/like`).expect(204);
    expect(await reaction).toEqual({ reviewId: review.id, likes: 1, dislikes: 0 });

    const changed = waitForEvent<{ reviewId: number }>(client, 'comment:changed');
    await bob.post(`/api/reviews/${review.id}/comments`).send({ text: 'vu en live' }).expect(201);
    expect((await changed).reviewId).toBe(review.id);
  });

  it('une room de jeu différente ne reçoit rien', async () => {
    const otherGame = (await prisma.game.create({ data: { igdbId: 41, title: 'Other Game' } })).id;
    client.emit('game:join', otherGame); // quitte la room précédente
    await sleep(150);

    let received = false;
    client.once('review:reaction', () => {
      received = true;
    });
    const carol = await signup(app, 'liveCarol');
    const { body: review } = await carol
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'Ailleurs', rating: 6, text: 'autre room' })
      .expect(201);
    await carol.post(`/api/reviews/${review.id}/like`).expect(204);
    await sleep(300);
    expect(received).toBe(false);
  });
});
