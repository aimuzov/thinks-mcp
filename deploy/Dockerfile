# Hosted connector: `thinks-mcp serve --http`. Build context is the repo root.

FROM node:26.11.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26.11.1-alpine
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
