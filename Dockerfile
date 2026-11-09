FROM node:24-bookworm-slim

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src/ ./src/
COPY shared/ /app/shared/

# Seven-character commit, set by CI; shown at / and /health so a deploy can be verified.
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
USER node
EXPOSE 8787
# Run node directly (not npm) so SIGTERM reaches the server and npm never
# writes caches/logs into the container. Node strips TypeScript types natively.
CMD ["node", "src/main.ts"]
