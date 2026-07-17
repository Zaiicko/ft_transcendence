FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

# Dev mode: sync the Prisma schema to the DB, then start with hot reload.
# --accept-data-loss: deliberate choice over prisma migrate. The evaluated
# scenario (fresh clone -> empty DB) never loses anything; only local dev
# data is at risk on destructive schema changes, and `make seed` regenerates
# it. Without the flag, any risky schema change merged by a teammate makes
# this container crash-loop on existing databases.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm run start:dev"]
