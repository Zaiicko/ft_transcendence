FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

# Dev mode: sync the Prisma schema to the DB, then start with hot reload.
CMD ["sh", "-c", "npx prisma db push && npm run start:dev"]
