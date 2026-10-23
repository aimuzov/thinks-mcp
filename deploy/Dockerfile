# Hosted connector: `thinks-mcp serve --http`. Build context is the repo root.

FROM node:24.18.0-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24.18.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# Corpora, settings and auth.db live in the volume. The directory is created
# here so a fresh empty volume inherits the node owner and the server can write.
RUN mkdir /data && chown node:node /data
ENV THINKS_DATA_DIR=/data PORT=8080
USER node
EXPOSE 8080
CMD ["node", "build/index.js", "serve", "--http"]
