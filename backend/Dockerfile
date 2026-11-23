FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/app/data/newgen-chat.sqlite HOST=0.0.0.0 PORT=5000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src ./src
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 5000
CMD ["node", "src/server.js"]
