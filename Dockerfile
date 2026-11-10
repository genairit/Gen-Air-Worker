FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY nest-cli.json tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node assets ./assets
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
