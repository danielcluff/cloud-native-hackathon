FROM node:24-bookworm-slim

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src/ ./src/
COPY shared/ /app/shared/

ENV NODE_ENV=production
USER node
EXPOSE 8787
CMD ["npm", "start"]
