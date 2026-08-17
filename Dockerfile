FROM node:22-bookworm-slim AS app

WORKDIR /app

# Prisma generation needs a syntactically valid datasource while the image is
# built. Hosting-platform production variables override these placeholders at
# runtime.
ENV DATABASE_URL=postgresql://user:pass@localhost:5432/postgres
ENV NODE_ENV=production

COPY package.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npm install --include=dev --no-audit --no-fund

COPY . ./
RUN npm run build

ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npm", "start", "--", "-p", "3000"]
