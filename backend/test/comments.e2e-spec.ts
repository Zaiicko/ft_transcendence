import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { anonymous, createApp, resetDb, signup } from './helpers';

type Agent = Awaited<ReturnType<typeof signup>>;

describe('Commentaires — threads, profondeur, tombales', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let alice: Agent;
  let bob: Agent;
  let reviewId: number;

  const comment = (agent: Agent, text: string, parentId?: number) =>
    agent.post(`/api/reviews/${reviewId}/comments`).send({ text, ...(parentId && { parentId }) });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    const gameId = (await prisma.game.create({ data: { igdbId: 10, title: 'Thread Game' } })).id;
    alice = await signup(app, 'alice');
    bob = await signup(app, 'bob');
    reviewId = (
      await alice
        .post(`/api/games/${gameId}/reviews`)
        .send({ title: 'support', rating: 8, text: 'review support des threads' })
        .expect(201)
    ).body.id;
  });

  afterAll(() => app.close());

  it('profondeur limitée à 3 (400 au-delà)', async () => {
    let parentId: number | undefined;
    // depth 0 (racine) puis réponses jusqu'à depth 3 : toutes acceptées
    for (let depth = 0; depth <= 3; depth++) {
      const res = await comment(alice, `depth ${depth}`, parentId).expect(201);
      parentId = res.body.id as number;
    }
    await comment(alice, 'depth 4 interdite', parentId).expect(400);
  });

  it('un commentaire avec réponses devient une tombale, le thread survit', async () => {
    const c1 = (await comment(alice, 'je vais me supprimer').expect(201)).body.id as number;
    const r1 = (await comment(bob, 'réponse qui survit', c1).expect(201)).body.id as number;
    await bob.post(`/api/comments/${c1}/like`).expect(204);

    await alice.delete(`/api/comments/${c1}`).expect(204);

    const list = (await anonymous(app).get(`/api/reviews/${reviewId}/comments`).expect(200)).body;
    const tomb = list.find((c: { id: number }) => c.id === c1);
    expect(tomb.deleted).toBe(true);
    expect(tomb.text).toBe('');
    expect(tomb.user).toBeNull();
    expect(tomb._count.likes).toBe(0); // réactions purgées
    expect(tomb._count.replies).toBe(1);

    const replies = (await anonymous(app).get(`/api/comments/${c1}/replies`).expect(200)).body;
    expect(replies[0].id).toBe(r1);
    expect(replies[0].text).toBe('réponse qui survit');
  });

  it('une tombale est inerte : ni réponse ni réaction (400)', async () => {
    const c1 = (await comment(alice, 'future tombale').expect(201)).body.id as number;
    await comment(bob, 'réponse', c1).expect(201);
    await alice.delete(`/api/comments/${c1}`).expect(204);

    await comment(bob, 'réponse à une tombale', c1).expect(400);
    await bob.post(`/api/comments/${c1}/like`).expect(400);
    await bob.post(`/api/comments/${c1}/dislike`).expect(400);
  });

  it('le 💬 des reviews ne compte pas les tombales', async () => {
    const review = (await anonymous(app).get(`/api/reviews/${reviewId}`).expect(200)).body;
    const list = (await anonymous(app).get(`/api/reviews/${reviewId}/comments`).expect(200)).body;
    const visibleRoots = list.filter((c: { deleted: boolean }) => !c.deleted).length;
    // le compteur inclut aussi les réponses visibles, jamais les tombales
    expect(review._count.comments).toBeGreaterThanOrEqual(visibleRoots);
    const tombs = list.filter((c: { deleted: boolean }) => c.deleted).length;
    expect(tombs).toBeGreaterThan(0);
    const allRows = await prisma.reviewComment.count({ where: { reviewId } });
    expect(review._count.comments).toBe(allRows - tombs);
  });

  it('feuille : vraie suppression, et élagage de la chaîne de tombales', async () => {
    const c1 = (await comment(alice, 'racine').expect(201)).body.id as number;
    const r1 = (await comment(bob, 'seule réponse', c1).expect(201)).body.id as number;
    await alice.delete(`/api/comments/${c1}`).expect(204); // tombale (a un enfant)

    // bob supprime la feuille : la tombale n'a plus d'enfant → élaguée aussi
    await bob.delete(`/api/comments/${r1}`).expect(204);

    const list = (await anonymous(app).get(`/api/reviews/${reviewId}/comments`).expect(200)).body;
    expect(list.some((c: { id: number }) => c.id === c1 || c.id === r1)).toBe(false);
    expect(await prisma.reviewComment.count({ where: { id: { in: [c1, r1] } } })).toBe(0);
  });
});
