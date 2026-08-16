FROM node:22-bookworm-slim AS app

WORKDIR /app/recovered-app

# Prisma generation only needs a syntactically valid datasource during image
# build. Railway's production variables override these placeholders at runtime
# and during the pre-deploy refresh.
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

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# Keep the application source and node_modules in the runtime image so Railway's
# pre-deploy command can execute the full TypeScript refresh/backfill job using
# the service's real production environment variables.
CMD ["npm", "start", "--", "-p", "3000"]
