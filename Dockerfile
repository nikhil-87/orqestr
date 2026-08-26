# ==============================================================================
# Orqestr Backend — Production Dockerfile
# Optimized for Koyeb, Render, Railway, and Docker Deployments
# ==============================================================================

FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install OpenSSL (required by Prisma Client on Linux)
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy monorepo configuration and lockfiles
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install dependencies across monorepo
RUN pnpm install --frozen-lockfile

# Copy backend source code
COPY server ./server

WORKDIR /app/server

# Generate Prisma Client and compile TypeScript
RUN pnpm prisma generate && pnpm tsc

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

# Automatically run pending database migrations, then start the Express server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
