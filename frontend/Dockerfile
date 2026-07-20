FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# frontend_node_modules (docker-compose.yml) est un volume nommé : il persiste
# entre les `docker compose up` et écrase ce que RUN npm install a posé dans
# l'image au build. Sans ce npm install au démarrage, un nouveau paquet ajouté
# à package.json par un coéquipier ne serait jamais installé automatiquement.
CMD ["sh", "-c", "npm install && npm run dev"]
