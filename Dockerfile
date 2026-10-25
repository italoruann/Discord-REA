# Imagem so do servidor (o app Electron roda no PC de cada um).
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# --ignore-scripts: as deps do Electron (uiohook-napi, rnnoise) vem no package.json mas nao sao usadas pelo servidor
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server/index.js server/backup.js server/

RUN mkdir -p server/data && chown -R node:node server/data
USER node

EXPOSE 3478
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3478/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
