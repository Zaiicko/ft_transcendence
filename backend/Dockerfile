FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

# Dev mode: sync deps + schema, then start with hot reload.
# backend_node_modules (docker-compose.yml) is a named volume: it persists
# across `docker compose up` and shadows whatever RUN npm install placed in the
# image at build time. Hence the npm install at startup — without it, a package
# a teammate adds is never installed automatically.
# --accept-data-loss: deliberate choice over prisma migrate. The evaluated
# scenario (fresh clone -> empty DB) never loses anything; only local dev
# data is at risk on destructive schema changes, and `make seed` regenerates
# it. Without the flag, any risky schema change merged by a teammate makes
# this container crash-loop on existing databases.
# catalog:ensure is fixture-first: it fills an empty catalog on the very first
# start and does nothing afterwards, so plain `make` yields a populated,
# demoable app.
CMD ["sh", "-c", "npm install && npx prisma generate && npx prisma db push --accept-data-loss && npm run catalog:ensure && npm run start:dev"]
