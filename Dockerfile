FROM node:22-bookworm-slim AS builder

WORKDIR /app/recovered-app

# Prisma generation needs a syntactically valid datasource during image build;
# Railway runtime variables override these placeholders in the running service.
ENV DATABASE_URL=postgresql://user:pass@localhost:5432/postgres
ENV BACKUP_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres
ENV STATSGUY_REFRESH_ENABLED=false
ENV TRADYR_REFRESH_ENABLED=true

COPY recovered-app/package.json recovered-app/package-lock.json ./
COPY recovered-app/prisma ./prisma
COPY recovered-app/prisma.config.ts ./prisma.config.ts
RUN npm ci

COPY recovered-app ./
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/recovered-app/.next/standalone ./
COPY --from=builder /app/recovered-app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
