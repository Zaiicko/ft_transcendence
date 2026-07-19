# Module Reviews — contrat d'API

Avis notés sur les **jeux** et les **studios**, threads de commentaires, likes/dislikes,
temps réel Socket.IO. Tout ce qu'il faut pour intégrer le module dans le front React
sans lire le code backend.

Base URL : `/api` (proxifié par nginx). Auth : cookie httpOnly `access_token` —
envoyé automatiquement par le navigateur, **y compris sur le handshake WebSocket**.
Tous les `GET` sont publics (navigation anonyme) ; toute mutation exige d'être connecté.

---

## 1. Formes de réponse

### Review

```jsonc
{
  "id": 6,
  "userId": 7, "gameId": 6837, "companyId": null,   // l'un des deux est null
  "title": "Casse-tête parfait",
  "rating": 9,                                       // 0-10
  "text": "Portal 2 est un bijou…",
  "createdAt": "2026-07-18T11:06:05.099Z", "updatedAt": "…",
  "user": { "id": 7, "username": "probeA", "avatarUrl": null },   // null = compte supprimé (§4.7)
  "_count": { "likes": 1, "dislikes": 0, "comments": 3 },   // comments = réponses incluses
  "myReaction": "like"          // "like" | "dislike" | null — calculé pour le viewer connecté
}
```

`GET /reviews/:id` et `GET /reviews/highlights` ajoutent la cible pour l'affichage hors page jeu :
`"game": { "id", "title", "coverUrl" }` et `"company": { "id", "name", "logoUrl" }` (l'un des deux est `null`).

### Commentaire

Même logique : `id`, `text`, `parentId` (`null` = commentaire racine), `user`,
`_count: { likes, dislikes, replies }`, `myReaction`, plus **`deleted`** :
`true` = tombale Reddit-style (« [supprimé] » — texte vide, `user: null`,
réponses conservées). Afficher un placeholder grisé, sans boutons d'action.

---

## 2. Routes REST

### Avis d'un jeu / d'un studio

`:target` = `games/:gameId` ou `companies/:companyId` — les deux familles sont symétriques.

| Route | Auth | Description |
|---|---|---|
| `GET /:target/reviews?sort=&page=&limit=` | non | Liste paginée. `sort` : `recent` (défaut) · `popular` (score net 👍−👎) · `discussed` (nb de commentaires) |
| `GET /:target/reviews/stats` | non | `{ "_avg": { "rating": 9 }, "_count": 1 }` — moyenne simple pour la fiche jeu/studio |
| `POST /:target/reviews` | oui | Corps : `{ title, rating, text }` — **les trois obligatoires** (title ≤ 120, rating 0-10 entier, text ≤ 5000). `201` → la review créée. `409` si l'utilisateur a déjà une review sur cette cible. `404` si cible inconnue |

### Une review

| Route | Auth | Description |
|---|---|---|
| `GET /reviews/highlights?days=&page=&limit=` | non | **Feed d'accueil** : meilleures reviews du site (tous jeux/studios), tri score net → nb commentaires → récence. `days` 1-365 (défaut 30), `limit` ≤ 50 (défaut 20). Chaque item embarque son `game`/`company` |
| `GET /reviews/:id` | non | Une review + son `game`/`company` |
| `PATCH /reviews/:id` | oui, auteur | Corps partiel `{ title?, rating?, text? }`. `403` si pas l'auteur |
| `DELETE /reviews/:id` | oui, auteur | `204` |
| `POST /reviews/:id/like` · `/dislike` | oui | `204`. Poser un like retire le dislike existant (et inversement) — atomique. Idempotent (reliker = `204` sans effet) |
| `DELETE /reviews/:id/like` · `/dislike` | oui | Retire sa réaction. `204` même si rien à retirer |

### Commentaires (threads)

| Route | Auth | Description |
|---|---|---|
| `GET /reviews/:reviewId/comments?sort=&page=&limit=` | non | Commentaires **racine** de la review. `sort` : `top` (défaut, score net) · `recent` |
| `POST /reviews/:reviewId/comments` | oui | `{ text, parentId? }` — `parentId` présent = réponse à un commentaire. Profondeur max **3** (`400` au-delà) |
| `GET /comments/:id/replies?page=&limit=` | non | Réponses directes d'un commentaire |
| `PATCH /comments/:id` | oui, auteur | `{ text }` |
| `DELETE /comments/:id` | oui, auteur | **Reddit-style** : avec réponses → devient une tombale `deleted: true` (le thread survit) ; sans réponse → vraie suppression (+ élagage des tombales ancêtres devenues vides). Répondre/réagir à une tombale → `400`. Le 💬 des reviews ne compte pas les tombales |
| `POST·DELETE /comments/:id/like` · `/dislike` | oui | Mêmes règles que les réactions de review |

### Notifications (module `notifications`, alimenté par reviews)

Toutes privées (`401` sinon). Types émis par reviews : `REVIEW_LIKE` (dédupliqué
par acteur+review, jamais pour un dislike), `REVIEW_COMMENT` (commentaire sur ta
review), `COMMENT_REPLY` (réponse à ton commentaire). Jamais pour ses propres
actions ni vers un auteur anonymisé. Le `payload` Json est un instantané :
`{ actorId, actorUsername, reviewId, reviewTitle, gameId, companyId, commentId? }`.

| Route | Description |
|---|---|
| `GET /notifications?unread=&page=&limit=` | Liste (récentes d'abord), `unread=true` filtre les non-lues |
| `GET /notifications/unread-count` | `{ count }` pour le badge 🔔 |
| `PATCH /notifications/:id/read` | Marque une notification lue (`404` si pas à toi) |
| `PATCH /notifications/read-all` | Tout marquer lu |

Codes d'erreur communs : `400` validation, `401` non connecté, `403` pas propriétaire,
`404` introuvable, `409` review en double.

---

## 3. Temps réel (Socket.IO)

Connexion : `io()` depuis l'app (même origine, path par défaut `/socket.io`, proxifié
par nginx). Le cookie part tout seul. **La socket est partagée avec le module
presence** : les évènements `friend:online` / `friend:offline` arrivent sur la même
connexion (voir §4, piège n°1).

### Rooms

Une page jeu/studio = une room. En arrivant sur la page :

```js
socket.emit('game:join', gameId);      // ou 'company:join', companyId
```

Une socket n'est que dans **une** room à la fois (re-join = quitte la précédente).
À rejouer sur l'évènement `connect` (reconnexion auto après coupure).

### Évènements reçus (tous les onglets de la room, émetteur inclus)

| Évènement | Payload | Quand | Réaction conseillée côté React |
|---|---|---|---|
| `review:created` | la review complète | nouvel avis | insérer dans la liste |
| `review:updated` | `{ reviewId }` | avis édité | re-fetch `GET /reviews/:id`, remplacer l'item |
| `review:deleted` | `{ reviewId }` | avis supprimé | retirer de la liste |
| `review:reaction` | `{ reviewId, likes, dislikes }` | 👍/👎 posé ou retiré | **patcher les deux compteurs, rien d'autre** |
| `comment:changed` | `{ reviewId }` | commentaire créé/édité/supprimé | rafraîchir le compteur 💬 + le thread s'il est ouvert |
| `comment:reaction` | `{ reviewId, commentId, likes, dislikes }` | réaction sur un commentaire | patcher les compteurs du commentaire |

Les évènements de réaction **portent les compteurs à jour** : aucun re-fetch nécessaire,
c'est voulu (pas de reflow/clignotement, pas de rafale de requêtes).

### Room personnelle (notifications)

Une socket **authentifiée** rejoint automatiquement sa room `user:<id>` au
handshake (cookie JWT lu par le `NotificationsGateway`). Elle y reçoit
`notification:new` (la ligne complète, payload inclus) sur tous ses onglets.
⚠️ Le cookie n'est lu **qu'au handshake** : après un login/logout côté client,
faire `socket.disconnect().connect()` pour rejoindre/quitter la room perso.

---

## 4. Pièges connus (payés pour vous)

1. **Config des gateways WS** : `ReviewsGateway` et `PresenceGateway` doivent garder des
   options `@WebSocketGateway` **strictement identiques** (`{ path: '/socket.io' }`).
   Nest crée un serveur Socket.IO par couple `{port, path}` distinct : une divergence
   → deux serveurs sur le même HTTP listener → **crash du backend au premier upgrade
   WebSocket** (double `handleUpgrade`), masqué par le `restart: unless-stopped` de
   Docker. Solution long terme envisagée : namespaces (à décider en équipe).
2. **Ordre des routes** : `GET /reviews/highlights` est déclarée avant `GET /reviews/:id`
   dans `reviews.controller.ts` — Express matche dans l'ordre, `:id` + `ParseIntPipe`
   renverrait `400` sur le littéral `highlights`. Ne pas réordonner.
3. **Une review par utilisateur et par cible** (contrainte unique en base → `409`).
   UX : masquer le formulaire si l'utilisateur a déjà reviewé (`reviews.some(r =>
   r.user.id === me.id)`), le serveur reste le garde-fou.
4. **Socket coupée pendant une action** : l'évènement de réaction n'arrivera jamais.
   Fallback : si `!socket.connected` après la mutation, re-fetch **ciblé**
   (`GET /reviews/:id`) — jamais la liste entière, sinon la page saute (threads ouverts
   qui se referment le temps du re-fetch).
5. **Ids locaux ≠ ids des autres machines** : le catalogue (~9 600 jeux) est importé
   par machine, les ids diffèrent. Naviguer par recherche (`GET /games/search?q=`),
   jamais par id codé en dur.
6. **`_count.comments`** compte réponses incluses (c'est le total du thread) ;
   `_count.replies` d'un commentaire ne compte que ses réponses directes.
7. **Compte supprimé = contenu anonymisé, pas effacé** (décision d'équipe, style
   SensCritique). À la suppression : `user` passe à **`null`** sur ses reviews et
   commentaires (qui restent en place, avec les réponses des autres), ses
   likes/dislikes disparaissent (les compteurs baissent), le contenu anonymisé
   n'est plus ni éditable ni supprimable (`403`) mais reste likable/commentable.
   **Le front doit tolérer `user: null` partout** : afficher
   « [utilisateur supprimé] », avatar générique, et null-safe sur les tests
   `r.user?.id === me.id`. RGPD : plus aucune donnée personnelle ne subsiste
   (pseudo, avatar et réactions effacés), le texte de l'avis est conservé
   dé-identifié. Aucun évènement WS n'accompagne l'anonymisation : les onglets
   ouverts la verront au prochain rechargement de liste.

---

## 5. Recette d'intégration React (checklist)

**Page jeu / studio** :
- [ ] `GET /:target/reviews?sort=recent` + `GET /:target/reviews/stats` au montage
- [ ] `socket.emit('game:join', id)` au montage **et** sur chaque `connect`
- [ ] Brancher les 6 évènements du §3 sur des `setState` ciblés
- [ ] Formulaire masqué si déjà reviewé ou anonyme ; gérer `409` et `401` quand même

**Page d'accueil** :
- [ ] `GET /reviews/highlights?limit=…` → cartes avis (cover + note + extrait),
      clic → page du jeu/studio
- [ ] `GET /games?sort=popular&limit=…` (module games) → rangée « populaires » avec
      le score bayésien `score`
- [ ] Pas de temps réel nécessaire ici — un fetch au montage suffit

Démo de référence fonctionnelle : `frontend/public/test-api.html`
(https://localhost:8443/test-api.html) — tout le contrat ci-dessus y est exercé.

---

## 6. Tests automatisés

```bash
docker compose exec backend npm run test:e2e
```

24 tests e2e (`backend/test/*.e2e-spec.ts`) couvrent ce contrat : CRUD + garde-fous
(401/403/409/400), réactions (exclusivité, idempotence), threads (profondeur max,
tombales, élagage), anonymisation de compte, classements (`popular`, `discussed`
filtré tombales, `highlights` : fenêtre, pagination, cibles embarquées) et temps
réel (rooms, non-kick des sockets anonymes, payloads des évènements). Ils tournent
sur une base dédiée `<db>_test` créée automatiquement — jamais sur la base de dev.
