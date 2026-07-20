FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

# Dev mode: sync deps + schema, then start with hot reload.
# backend_node_modules (docker-compose.yml) est un volume nommé : il persiste
# entre les `docker compose up` et écrase ce que RUN npm install a posé dans
# l'image au build — d'où le npm install au démarrage, sinon un nouveau paquet
# ajouté par un coéquipier n'est jamais installé automatiquement.
# --accept-data-loss: deliberate choice over prisma migrate. The evaluated
# scenario (fresh clone -> empty DB) never loses anything; only local dev
# data is at risk on destructive schema changes, and `make seed` regenerates
# it. Without the flag, any risky schema change merged by a teammate makes
# this container crash-loop on existing databases.
CMD ["sh", "-c", "npm install && npx prisma generate && npx prisma db push --accept-data-loss && npm run start:dev"]
