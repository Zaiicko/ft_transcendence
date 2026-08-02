*This project has been created as part of the 42 curriculum by \<alama\>, \<nicleena\>, \<vpramann\>, \<meskrabe\>.*

# Saveboxd

**The Letterboxd of video games** — a social platform to track, rate, review and
discover games, and to follow what your friends are playing.

---

## Description

**Saveboxd** is a real-world social web application built around video games.
Instead of *watching* films like on Letterboxd, users **log the games they
play**, rate and review them, build and share lists, unlock achievements,
climb leaderboards, chat with friends, and receive **personalized
recommendations** based on their taste.

A key differentiator is the **automatic import of a player's real library and
trophies** from Steam, PlayStation and Xbox: linking an account pulls the games
you own/played and matches them against a shared catalog sourced from IGDB.

### Key features

- **Game catalog** sourced from IGDB, with advanced search (text, genre,
  platform, studio), sorting and pagination, plus per-studio pages.
- **Ratings & reviews** (0–10), likes/dislikes and threaded comments.
- **Custom lists** of games, shareable with others.
- **Social layer**: friends with online presence, an activity **feed**, a
  real-time **chat**, and a full **notification** system.
- **Library & trophy sync** from **Steam, PlayStation and Xbox** (games +
  achievements/trophies), matched to the catalog.
- **Gamification**: home-made achievements (multiple families/tiers), rank
  badges, and global/friends **leaderboards** (completions, games played,
  reviews).
- **Personalized recommendations** with an explanation for each pick
  (*"because you liked X"*, a studio, or a genre).
- **Profiles** with an activity calendar (GitHub-style yearly heatmap),
  completion stats and rank badges.
- **Accounts & security**: email/password (Argon2), Google & Discord OAuth,
  TOTP 2FA, email verification.
- **Internationalization** in **13 languages** with on-the-fly translation of
  game summaries.
- **Onboarding wizard** and an interactive **guided tour** of the interface.

---

## Instructions

### Prerequisites

- **Docker** + **Docker Compose**
- A local **`.env`** file with the required secrets. Copy the provided template
  and fill it in — the real `.env` is **gitignored**:

  ```bash
  cp .env.example .env
  # then edit .env and fill in the values (DB password, JWT secret,
  # SMTP credentials, IGDB / OAuth / Steam / PSN / Xbox / DeepL keys, …)
  ```

  See [`.env.example`](.env.example) for the full list of variables and what
  each one is for. External integrations (library sync, translation) only work
  if their corresponding keys are provided; the core app runs without them.

### Run (single command)

```bash
make          # builds the images and starts every service
```

The application is then served over **HTTPS** at **https://localhost:8443**
(self-signed certificate — accept the browser warning). Backend healthcheck:
`https://localhost:8443/api/health`.

Useful targets: `make logs`, `make down`, `make re` (rebuild), `make clean`
(stops and wipes the database), `make seed` (regenerate local demo data).

---

## Team Information

| Member (login) | Role(s) | Responsibilities |
|---|---|---|
| `meskrabe` | Product Owner / Developer | Product vision, backlog and feature priorities; core features. |
| `nicleena` | Project Manager / Scrum Master / Developer | Coordination, planning and communication; auth & security. |
| `vpramann` | Developer | Frontend components, design and DevOps. |
| `alama` | Technical Lead / Architect / Developer | Architecture and tech-stack decisions, code quality; catalog & UI. |

---

## Project Management

- **Work organization**: work was split **by feature area** — each member owned
  a set of modules/features (e.g. auth & accounts, catalog & reviews, social &
  chat, platform sync) and coordinated as needed.
- **Task tracking & communication**: **Discord** — tasks were assigned and
  followed informally there, alongside day-to-day communication.
- **Branching & reviews**: feature branches merged into the main line, with
  small, descriptive commits and peer review on important changes.

---

## Technical Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | React 19 + TypeScript + **Vite** + **Tailwind CSS** | Component model + strong typing for a large UI; Vite for fast builds/HMR; Tailwind for a consistent, responsive design system. |
| **Backend** | **NestJS** (Node + TypeScript) | Opinionated, modular architecture (DI, guards, pipes) that scales cleanly across many feature domains. |
| **ORM** | **Prisma** | Type-safe DB access and a single source of truth for the schema; raw SQL used where needed (leaderboards, rating aggregates). |
| **Database** | **PostgreSQL** | Relational data with many well-defined relations (users, games, reviews, social graph); robust, transactional, great with Prisma. |
| **Real-time** | **Socket.IO** (`@nestjs/websockets`) | Presence, chat, live feed and notifications pushed to connected clients. |
| **Auth** | `@nestjs/jwt`, Passport (Google & Discord OAuth), **Argon2**, **otplib** (TOTP 2FA), `@nestjs/throttler`, Helmet | Layered account security. |
| **Reverse proxy** | **nginx** | TLS termination (HTTPS only) and routing of `/` and `/api`. |
| **Email** | **Nodemailer** (SMTP) | Email verification and account emails. |
| **Game data** | **IGDB API** | Source catalog (titles, covers, genres, platforms, studios). |
| **Translation** | **DeepL** (with a fallback) | On-the-fly translation of game summaries for i18n. |
| **Packaging** | **Docker Compose** | One-command, reproducible multi-service deployment. |

The database schema is the single source of truth in
[`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) and is applied at
container start with `prisma db push`. *(Rationale: the graded scenario starts
from an empty database, so there is nothing to lose; a production setup would
use versioned `prisma migrate` files instead.)*

---

## Database Schema

PostgreSQL, managed via Prisma. Main entities and relations:

**Accounts & social**
- **User** — account, profile, security fields (Argon2 hash, TOTP secret,
  OAuth ids), linked platform ids (Steam/PSN/Xbox), onboarding & tutorial flags.
- **RefreshToken**, **VerificationToken** — session refresh and email/2FA flows
  (belong to a User).
- **Friendship** — social graph between two Users (`status`: PENDING/ACCEPTED…).
- **Notification** — per-user notifications (`type` enum for each action).
- **Message** — direct chat messages between two Users (`type` enum).

**Catalog**
- **Game** — catalog entry (IGDB-sourced); self-relation `parent`/children for
  DLCs/expansions (`GameType` enum). Many-to-many with **Genre**, **Platform**,
  **Company** (studios). **GameTranslation** holds localized summaries.

**Reviews**
- **Review** — a User's rating (0–10) + title/text on a Game *or* a Company.
  **ReviewTranslation** for localized text. **ReviewLike / ReviewDislike**
  (per user). **ReviewComment** (threaded) with its own
  **ReviewCommentLike / ReviewCommentDislike**.

**Tracking & gamification**
- **PlayedGame** — a User marked a Game as played (`PlayStatus` enum, dates).
- **GameCompletion** — a User completed a Game 100% (platform-sourced or manual).
- **UserAchievement** — unlocked home-made achievement keys per User.
- **LeaderboardMilestone** — recorded "entered top 3" events (feed/badges).

**Lists**
- **GameList** — a User's named list; **GameListItem** — ordered games in a list.

**Enums**: `AuthProvider`, `FriendshipStatus`, `VerificationTokenType`,
`PlayStatus`, `NotificationType`, `GameType`, `MessageType`.

---

## Features List

| Feature | Description | Implemented by |
|---|---|---|
| Authentication | Email/password (Argon2), email verification, JWT sessions with refresh | `nicleena` |
| OAuth login | Sign in / link via Google & Discord | `nicleena` |
| Two-factor auth | TOTP enrollment (QR) and verification | `nicleena` |
| Profiles | Public profile, avatar upload (+ default), bio, activity calendar, stats, rank badges | `nicleena`, `alama` |
| Friends & presence | Add/remove friends, requests, online status | `meskrabe`, `alama` |
| Chat | Real-time direct messages (Socket.IO) | `meskrabe`, `alama` |
| Activity feed | Friends' recent activity, live updates | `meskrabe`, `alama` |
| Notifications | Notifications for social/achievement events | `meskrabe`, `alama` |
| Catalog & search | IGDB catalog, filters (genre/platform/studio), sort, pagination, studio pages | `meskrabe`, `alama` |
| Reviews | Rate 0–10, write reviews, like/dislike, threaded comments | `meskrabe`, `alama` |
| Lists | Create/edit game lists, share them | `alama` |
| Library sync | Import games + trophies from Steam / PlayStation / Xbox, matched to catalog | `meskrabe`, `nicleena` |
| Achievements & leaderboards | Home-made achievements, rank badges, global/friends leaderboards | `meskrabe`, `nicleena` |
| Recommendations | Personalized picks with an explained reason (game/studio/genre) | `meskrabe`, `nicleena` |
| Internationalization | 13 languages, language switcher, DeepL summary translation | `meskrabe`, `nicleena` |
| Onboarding & guided tour | Post-signup wizard + interactive tour of the UI | `meskrabe`, `vpramann` |
| Legal pages | Privacy Policy & Terms of Service | `vpramann`, `alama` |

---

## Modules

Points: **Major = 2 pts**, **Minor = 1 pt**. Required minimum: **14**.

> ⚠️ This project is a **social application, not a game**, so no "Gaming"
> module (nor any game-dependent module such as AI Opponent, tournaments,
> match history or spectator mode) is claimed.

### Claimed modules (**19 points**)

| # | Module | Cat. | Type | Pts | How it's implemented | By |
|---|---|---|---|---|---|---|
| 1 | Frontend **and** backend frameworks | Web | Major | 2 | React (frontend) + NestJS (backend) | `meskrabe`, `nicleena`, `alama`, `vpramann` |
| 2 | Real-time features (WebSockets) | Web | Major | 2 | Socket.IO: presence, chat, feed, notifications; graceful (dis)connection | `meskrabe`, `alama` |
| 3 | User interaction (chat + profile + friends) | Web | Major | 2 | Direct chat, public profiles, friends system | `meskrabe`, `alama` |
| 4 | Standard user management | User Mgmt | Major | 2 | Profile edit, avatar (+default), friends + online status, profile page | `nicleena`, `alama` |
| 5 | **Recommendation system** | AI | Major | 2 | Content-based filtering from a per-user genre/studio taste profile (reviews + plays), recency-weighted, with an explained reason per pick | `meskrabe`, `nicleena` |
| 6 | **Multi-platform library & trophy sync** (custom) | Modules of choice | Major | 2 | ETL pipeline: fetch → normalize → match to catalog → cache/resync for Steam / PSN / Xbox games **and** trophies (see justification) | `meskrabe`, `nicleena` |
| 7 | ORM | Web | Minor | 1 | Prisma over PostgreSQL | `nicleena`, `meskrabe` |
| 8 | Multiple languages (≥3) | A11y & i18n | Minor | 1 | i18next, **13** languages, switcher, all UI text translatable | `meskrabe`, `nicleena` |
| 9 | OAuth 2.0 | User Mgmt | Minor | 1 | Google & Discord | `nicleena` |
| 10 | Two-Factor Authentication | User Mgmt | Minor | 1 | TOTP (otplib) + QR | `nicleena` |
| 11 | Notification system | Web | Minor | 1 | Notifications on create/update/delete-type actions | `meskrabe`, `alama` |
| 12 | Gamification | Gaming & UX | Minor | 1 | ≥3 of the list: **achievements + badges + leaderboards**, persistent, with visual feedback | `meskrabe`, `nicleena` |
| 13 | **GDPR compliance** | Data & Analytics | Minor | 1 | Self-service data **export** (structured JSON — right of access/portability), account **deletion** with password confirmation (reviews/comments anonymized), and **confirmation emails** on both operations | `alama`, `vpramann` |

**Total claimed: 6 Major + 7 Minor = 19 points** (≥ 14, with margin).

### Custom module justification (#6 — Major, "Modules of choice")

- **Why**: importing a player's *real* library and trophies is the feature that
  makes Saveboxd feel personal from day one and feeds the whole app
  (recommendations, achievements, stats).
- **Technical challenges**: three different provider APIs (Steam Web API,
  `psn-api`, OpenXBL/xbl.io), each with its own auth/rate limits; normalizing
  heterogeneous titles and **matching** them to the IGDB catalog; caching and
  on-demand resync without hammering the providers.
- **Value & Major status**: it is a full ETL pipeline spanning several backend
  modules and external services — well beyond a trivial feature — and it
  directly powers multiple other features.

### Reserve / bonus candidates (beyond 14 — bonus is capped at +5)

Advanced search (Web, minor) · File upload & management — avatars (Web, minor) ·
Custom design system, 10+ reusable components (Web, minor) · On-the-fly DeepL
translation (Modules of choice, minor). *Only claim these as bonus if fully
demonstrated during the defense.*

---

## Individual Contributions

- **`meskrabe`** — Catalog, reviews, lists and the social layer (chat, feed,
  notifications); multi-platform library/trophy sync; the recommendation engine;
  internationalization (13 languages); plus a large share of the frontend/design
  and Docker/nginx setup. *Challenge: reliably **matching** heterogeneous
  Steam/PSN/Xbox titles to the IGDB catalog — solved with a normalize-then-match
  pipeline and cached resync.*
- **`nicleena`** — Authentication & account security (email/password, Google &
  Discord OAuth, TOTP 2FA, email verification, standard user management); and
  backend work on platform sync, recommendations and i18n. *Challenge:
  implementing secure OAuth + TOTP 2FA flows end-to-end.*
- **`alama`** — Catalog, reviews and lists; social features and profiles UI;
  **GDPR compliance** (self-service data export + account deletion with
  confirmation emails); and a large part of the frontend/design system and
  DevOps. *Challenge: keeping the UI consistent and responsive across the many
  pages.*
- **`vpramann`** — Frontend UI components and design system, legal pages
  (Privacy Policy / Terms of Service), and containerization work. *Challenge:
  responsive layout and the Docker/dev setup.*

---

## Resources

- ft_transcendence subject (v21.1) — 42 intra
- [NestJS documentation](https://docs.nestjs.com)
- [Prisma documentation](https://www.prisma.io/docs)
- [React documentation](https://react.dev) · [Vite](https://vitejs.dev) · [Tailwind CSS](https://tailwindcss.com/docs)
- [Socket.IO documentation](https://socket.io/docs/v4/)
- [IGDB API](https://api-docs.igdb.com) · [DeepL API](https://developers.deepl.com)
- [psn-api](https://psn-api.achievements.app) · [OpenXBL](https://xbl.io) · [Steam Web API](https://steamcommunity.com/dev)

### AI usage

AI assistance (an LLM coding assistant) was used as a productivity tool, always
reviewed and adapted by the team before being committed. Typical uses:

- Scaffolding and refining full-stack features (endpoints, React components,
  Prisma queries) that we then read, tested and adjusted.
- Producing and proofreading the **13-language** i18n translations.
- UI/UX polish (layout, responsiveness) and small refactors.
- Debugging (reading stack traces, narrowing down issues) and rubber-ducking
  design decisions.

No feature was submitted that its author could not explain and defend. *Each
member: replace/extend this with the specific tasks and project parts where you
personally used AI.*
