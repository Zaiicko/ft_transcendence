import { NestExpressApplication } from '@nestjs/platform-express';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../src/prisma/prisma.service';
import { Agent, anonymous, appPort, createApp, resetDb, signup } from './helpers';

function waitForEvent<T>(socket: Socket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout en attendant "${event}"`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Notifications — création, dédup, lecture, temps réel', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let alice: Agent; // autrice de la review = destinataire
  let bob: Agent; // acteur
  let reviewId: number;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    const gameId = (await prisma.game.create({ data: { igdbId: 50, title: 'Notif Game' } })).id;
    alice = await signup(app, 'alice');
    bob = await signup(app, 'bob');
    reviewId = (
      await alice
        .post(`/api/games/${gameId}/reviews`)
        .send({ title: 'Ma review', rating: 8, text: 'notifie-moi' })
        .expect(201)
    ).body.id as number;
  });

  afterAll(async () => {
    // Disconnecting an authenticated socket triggers a Prisma write
    // (lastSeenAt, presence gateway). Let it finish before closing the app,
    // otherwise the shutdown produces an unhandled rejection.
    await new Promise((r) => setTimeout(r, 300));
    await app.close();
  });

  it('exige d’être connecté (401)', async () => {
    await anonymous(app).get('/api/notifications').expect(401);
  });

  it('like → notification, dédupliquée malgré le toggle unlike/re-like', async () => {
    await bob.post(`/api/reviews/${reviewId}/like`).expect(204);
    await bob.delete(`/api/reviews/${reviewId}/like`).expect(204);
    await bob.post(`/api/reviews/${reviewId}/like`).expect(204);

    const list = (await alice.get('/api/notifications').expect(200)).body;
    const likes = list.filter((n: { type: string }) => n.type === 'REVIEW_LIKE');
    expect(likes).toHaveLength(1);
    expect(likes[0].payload).toMatchObject({
      actorUsername: 'bob',
      reviewId,
      reviewTitle: 'Ma review',
    });
  });

  it('ses propres actions ne notifient pas', async () => {
    await alice.post(`/api/reviews/${reviewId}/like`).expect(204);
    await alice.post(`/api/reviews/${reviewId}/comments`).send({ text: 'mon com' }).expect(201);
    const { body } = await alice.get('/api/notifications').expect(200);
    expect(body.filter((n: { type: string }) => n.type !== 'REVIEW_LIKE')).toHaveLength(0);
  });

  it('commentaire → REVIEW_COMMENT pour l’autrice ; réponse → COMMENT_REPLY pour l’auteur du parent', async () => {
    const { body: bobCom } = await bob
      .post(`/api/reviews/${reviewId}/comments`)
      .send({ text: 'com de bob' })
      .expect(201);
    // alice replies to bob: BOB must be notified, not alice
    await alice
      .post(`/api/reviews/${reviewId}/comments`)
      .send({ text: 'réponse d’alice', parentId: bobCom.id })
      .expect(201);

    const aliceNotifs = (await alice.get('/api/notifications').expect(200)).body;
    expect(aliceNotifs.some((n: { type: string }) => n.type === 'REVIEW_COMMENT')).toBe(true);

    const bobNotifs = (await bob.get('/api/notifications').expect(200)).body;
    expect(bobNotifs).toHaveLength(1);
    expect(bobNotifs[0].type).toBe('COMMENT_REPLY');
    expect(bobNotifs[0].payload.actorUsername).toBe('alice');
  });

  it('non-lus : compteur, filtre, marquage unitaire et global', async () => {
    const before = (await alice.get('/api/notifications/unread-count').expect(200)).body;
    expect(before.count).toBeGreaterThanOrEqual(2); // like + comment de bob

    const unread = (await alice.get('/api/notifications?unread=true').expect(200)).body;
    expect(unread.every((n: { readAt: string | null }) => n.readAt === null)).toBe(true);

    // marking someone else's notification 404s (updateMany filtered on userId)
    await bob.patch(`/api/notifications/${unread[0].id}/read`).expect(404);
    await alice.patch(`/api/notifications/${unread[0].id}/read`).expect(204);

    await alice.patch('/api/notifications/read-all').expect(204);
    const after = (await alice.get('/api/notifications/unread-count').expect(200)).body;
    expect(after.count).toBe(0);
  });

  it('une socket authentifiée reçoit notification:new en direct dans sa room', async () => {
    const socket = io(`http://127.0.0.1:${appPort(app)}`, {
      transports: ['websocket'],
      extraHeaders: { cookie: alice.cookie },
    });
    try {
      await waitForEvent(socket, 'connect');
      const incoming = waitForEvent<{ type: string; payload: { actorUsername: string } }>(
        socket,
        'notification:new',
      );
      await bob.post(`/api/reviews/${reviewId}/comments`).send({ text: 'ping live' }).expect(201);
      const notif = await incoming;
      expect(notif.type).toBe('REVIEW_COMMENT');
      expect(notif.payload.actorUsername).toBe('bob');
    } finally {
      socket.close();
    }
  });
});
