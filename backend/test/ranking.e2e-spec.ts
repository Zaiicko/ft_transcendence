import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { anonymous, createApp, resetDb, signup } from './helpers';

describe('Classements — popular, discussed, highlights', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let gameId: number;
  let companyId: number;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    gameId = (await prisma.game.create({ data: { igdbId: 20, title: 'Rank Game' } })).id;
    companyId = (await prisma.company.create({ data: { igdbId: 21, name: 'Rank Studio' } })).id;
  });

  afterAll(() => app.close());

  it('popular : classé par score net (👍−👎), départagé par récence', async () => {
    const [a, b, c, v1, v2] = await Promise.all(
      ['popA', 'popB', 'popC', 'votant1', 'votant2'].map((n) => signup(app, n)),
    );
    const post = async (agent: Awaited<ReturnType<typeof signup>>, title: string) =>
      (
        await agent
          .post(`/api/games/${gameId}/reviews`)
          .send({ title, rating: 5, text: title })
          .expect(201)
      ).body.id as number;

    const ra = await post(a, 'net +2');
    const rb = await post(b, 'net +1');
    const rc = await post(c, 'net -1');
    await v1.post(`/api/reviews/${ra}/like`).expect(204);
    await v2.post(`/api/reviews/${ra}/like`).expect(204);
    await v1.post(`/api/reviews/${rb}/like`).expect(204);
    await v1.post(`/api/reviews/${rc}/dislike`).expect(204);

    const { body } = await anonymous(app)
      .get(`/api/games/${gameId}/reviews?sort=popular`)
      .expect(200);
    expect(body.map((r: { id: number }) => r.id)).toEqual([ra, rb, rc]);
  });

  it('discussed : seuls les commentaires visibles comptent (tombales exclues)', async () => {
    const g = (await prisma.game.create({ data: { igdbId: 22, title: 'Discussed Game' } })).id;
    const old = await signup(app, 'discOld');
    const recent = await signup(app, 'discRecent');
    const talker = await signup(app, 'discTalker');

    // RB (ancienne) : 2 commentaires visibles
    const rb = (
      await old
        .post(`/api/games/${g}/reviews`)
        .send({ title: 'ancienne', rating: 5, text: 'b' })
        .expect(201)
    ).body.id as number;
    // RA (récente) : 2 lignes en base mais 1 seule visible (tombale + réponse)
    const ra = (
      await recent
        .post(`/api/games/${g}/reviews`)
        .send({ title: 'récente', rating: 5, text: 'a' })
        .expect(201)
    ).body.id as number;

    const c1 = (
      await talker.post(`/api/reviews/${ra}/comments`).send({ text: 'à supprimer' }).expect(201)
    ).body.id as number;
    await recent
      .post(`/api/reviews/${ra}/comments`)
      .send({ text: 'réponse', parentId: c1 })
      .expect(201);
    await talker.delete(`/api/comments/${c1}`).expect(204); // tombale

    await talker.post(`/api/reviews/${rb}/comments`).send({ text: 'com 1' }).expect(201);
    await recent.post(`/api/reviews/${rb}/comments`).send({ text: 'com 2' }).expect(201);

    const { body } = await anonymous(app).get(`/api/games/${g}/reviews?sort=discussed`).expect(200);
    // sans le filtre, égalité 2-2 et RA (plus récente) passerait devant
    expect(body.map((r: { id: number }) => r.id)).toEqual([rb, ra]);
    expect(body[0]._count.comments).toBe(2);
    expect(body[1]._count.comments).toBe(1);
  });

  it('highlights : fenêtre temporelle, cibles embarquées, pagination, suppression', async () => {
    await resetDb(prisma);
    const g = (await prisma.game.create({ data: { igdbId: 30, title: 'HL Game' } })).id;
    const comp = (await prisma.company.create({ data: { igdbId: 31, name: 'HL Studio' } })).id;
    const u1 = await signup(app, 'hlUn');
    const u2 = await signup(app, 'hlDeux');

    const gameReview = (
      await u1
        .post(`/api/games/${g}/reviews`)
        .send({ title: 'sur jeu', rating: 9, text: 'récente et likée' })
        .expect(201)
    ).body.id as number;
    await u2.post(`/api/reviews/${gameReview}/like`).expect(204);
    const companyReview = (
      await u2
        .post(`/api/companies/${comp}/reviews`)
        .send({ title: 'sur studio', rating: 8, text: 'récente' })
        .expect(201)
    ).body.id as number;
    // vieille review (45 jours) insérée directement : hors fenêtre par défaut.
    // userId 2 = hlDeux (RESTART IDENTITY au reset), qui n'a pas reviewé ce jeu
    const oldReview = await prisma.review.create({
      data: {
        userId: 2,
        gameId: g,
        title: 'vieille',
        rating: 3,
        text: 'hors fenêtre',
        createdAt: new Date(Date.now() - 45 * 24 * 3600 * 1000),
      },
    });

    const feed = (await anonymous(app).get('/api/reviews/highlights').expect(200)).body;
    expect(feed.map((r: { id: number }) => r.id)).toEqual([gameReview, companyReview]);
    expect(feed[0].game.title).toBe('HL Game');
    expect(feed[1].company.name).toBe('HL Studio');

    // fenêtre élargie : la vieille review entre (net 0, plus vieille → dernière)
    const wide = (await anonymous(app).get('/api/reviews/highlights?days=60').expect(200)).body;
    expect(wide.map((r: { id: number }) => r.id)).toEqual([
      gameReview,
      companyReview,
      oldReview.id,
    ]);

    const page2 = (
      await anonymous(app).get('/api/reviews/highlights?limit=1&page=2').expect(200)
    ).body;
    expect(page2.map((r: { id: number }) => r.id)).toEqual([companyReview]);

    await anonymous(app).get('/api/reviews/highlights?days=0').expect(400);

    // une review supprimée sort du feed immédiatement
    await u1.delete(`/api/reviews/${gameReview}`).expect(204);
    const after = (await anonymous(app).get('/api/reviews/highlights').expect(200)).body;
    expect(after.some((r: { id: number }) => r.id === gameReview)).toBe(false);
  });
});
