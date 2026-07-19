import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { anonymous, createApp, PASSWORD, resetDb, signup } from './helpers';

describe('Reviews — CRUD, réactions, anonymisation', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let gameId: number;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    gameId = (await prisma.game.create({ data: { igdbId: 1, title: 'Game One' } })).id;
  });

  afterAll(() => app.close());

  it('refuse la création anonyme (401)', async () => {
    await anonymous(app)
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'x', rating: 5, text: 'y' })
      .expect(401);
  });

  it('valide le payload (400 sans texte, note hors bornes)', async () => {
    const alice = await signup(app, 'alice');
    await alice.post(`/api/games/${gameId}/reviews`).send({ title: 'x', rating: 5 }).expect(400);
    await alice
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'x', rating: 11, text: 'y' })
      .expect(400);
  });

  it('crée une review, puis refuse le doublon (409)', async () => {
    const bob = await signup(app, 'bob');
    const res = await bob
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'Banger', rating: 9, text: 'Chef d’œuvre' })
      .expect(201);
    expect(res.body.user.username).toBe('bob');
    expect(res.body._count).toEqual({ likes: 0, dislikes: 0, comments: 0 });

    await bob
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'Encore', rating: 8, text: 'doublon' })
      .expect(409);
  });

  it('seul l’auteur peut éditer (403 sinon) et supprimer', async () => {
    const carol = await signup(app, 'carol');
    const mallory = await signup(app, 'mallory');
    const { body: review } = await carol
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'À moi', rating: 6, text: 'mon avis' })
      .expect(201);

    await mallory.patch(`/api/reviews/${review.id}`).send({ rating: 1 }).expect(403);
    const { body: edited } = await carol
      .patch(`/api/reviews/${review.id}`)
      .send({ rating: 10 })
      .expect(200);
    expect(edited.rating).toBe(10);

    await mallory.delete(`/api/reviews/${review.id}`).expect(403);
    await carol.delete(`/api/reviews/${review.id}`).expect(204);
    await anonymous(app).get(`/api/reviews/${review.id}`).expect(404);
  });

  it('réactions : exclusivité like/dislike, idempotence, retrait', async () => {
    const dave = await signup(app, 'dave');
    const eve = await signup(app, 'eve');
    const { body: review } = await dave
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'Réactions', rating: 7, text: 'test' })
      .expect(201);
    const url = `/api/reviews/${review.id}`;

    await eve.post(`${url}/like`).expect(204);
    let r = (await eve.get(url).expect(200)).body;
    expect(r._count).toMatchObject({ likes: 1, dislikes: 0 });
    expect(r.myReaction).toBe('like');

    // poser le dislike retire le like (atomique, même transaction)
    await eve.post(`${url}/dislike`).expect(204);
    r = (await eve.get(url).expect(200)).body;
    expect(r._count).toMatchObject({ likes: 0, dislikes: 1 });
    expect(r.myReaction).toBe('dislike');

    // idempotent : re-disliker ne change rien
    await eve.post(`${url}/dislike`).expect(204);
    r = (await eve.get(url).expect(200)).body;
    expect(r._count).toMatchObject({ likes: 0, dislikes: 1 });

    await eve.delete(`${url}/dislike`).expect(204);
    r = (await anonymous(app).get(url).expect(200)).body;
    expect(r._count).toMatchObject({ likes: 0, dislikes: 0 });
    expect(r.myReaction).toBeNull(); // viewer anonyme
  });

  it('stats : moyenne simple + nombre d’avis', async () => {
    const statsGame = (await prisma.game.create({ data: { igdbId: 2, title: 'Stats Game' } })).id;
    const u1 = await signup(app, 'statUn');
    const u2 = await signup(app, 'statDeux');
    await u1.post(`/api/games/${statsGame}/reviews`).send({ title: 'a', rating: 4, text: 't' });
    await u2.post(`/api/games/${statsGame}/reviews`).send({ title: 'b', rating: 8, text: 't' });

    const { body } = await anonymous(app).get(`/api/games/${statsGame}/reviews/stats`).expect(200);
    expect(body._count).toBe(2);
    expect(body._avg.rating).toBe(6);
  });

  it('suppression de compte : contenu anonymisé, réactions purgées, réponses des autres conservées', async () => {
    const ghost = await signup(app, 'ghost');
    const witness = await signup(app, 'witness');
    const g2 = (await prisma.game.create({ data: { igdbId: 3, title: 'Ghost Game' } })).id;

    const { body: review } = await ghost
      .post(`/api/games/${g2}/reviews`)
      .send({ title: 'Je vais partir', rating: 9, text: 'contenu conservé' })
      .expect(201);
    const { body: com } = await ghost
      .post(`/api/reviews/${review.id}/comments`)
      .send({ text: 'mon commentaire' })
      .expect(201);
    await witness
      .post(`/api/reviews/${review.id}/comments`)
      .send({ text: 'réponse du témoin', parentId: com.id })
      .expect(201);
    // ghost like la review du témoin sur l'autre jeu pour vérifier la purge
    const { body: witnessReview } = await witness
      .post(`/api/games/${gameId}/reviews`)
      .send({ title: 'du témoin', rating: 5, text: 'w' })
      .expect(201);
    await ghost.post(`/api/reviews/${witnessReview.id}/like`).expect(204);

    // le mot de passe est exigé (401 sans), puis 204
    await ghost.delete('/api/users/me').expect(401);
    await ghost.delete('/api/users/me').send({ password: PASSWORD }).expect(204);

    const kept = (await anonymous(app).get(`/api/reviews/${review.id}`).expect(200)).body;
    expect(kept.user).toBeNull();
    expect(kept.text).toBe('contenu conservé');

    const coms = (await anonymous(app).get(`/api/reviews/${review.id}/comments`).expect(200)).body;
    expect(coms[0].user).toBeNull();
    const replies = (await anonymous(app).get(`/api/comments/${com.id}/replies`).expect(200)).body;
    expect(replies[0].text).toBe('réponse du témoin');
    expect(replies[0].user.username).toBe('witness');

    const purged = (await anonymous(app).get(`/api/reviews/${witnessReview.id}`).expect(200)).body;
    expect(purged._count.likes).toBe(0);
  });
});
