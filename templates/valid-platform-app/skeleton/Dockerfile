FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Instala as dependências antes de copiar o código para aproveitar o cache de camadas.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

# A imagem base já traz o usuário `node` (uid 1000); rodar como root é desnecessário.
USER node

EXPOSE ${{ values.port }}

CMD ["node", "src/index.js"]
