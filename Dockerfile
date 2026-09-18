FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# SQLite database lives on a volume so content survives container rebuilds.
ENV DB_PATH=/data/agentic-blog.db
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

# Run as the unprivileged `node` user (uid 1000). The /data volume must be
# writable by that uid — with a named volume Docker inherits this ownership;
# with a host bind mount, chown the host directory to uid 1000.
RUN mkdir -p /data && chown -R node:node /data
USER node

VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]