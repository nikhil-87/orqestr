# Running Orqestr Locally

Step-by-step guide to get Orqestr running on your machine using **Neon PostgreSQL** (cloud DB), **Docker Redis** (local queue broker), and **Groq** for LLM inference.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | v20+ | [nodejs.org](https://nodejs.org) |
| pnpm | v8+ | `npm install -g pnpm` |
| Docker | Latest | [docker.com](https://www.docker.com) |
| Neon Database | — | Free tier at [neon.tech](https://neon.tech) |
| Groq API Key | — | Free tier at [console.groq.com](https://console.groq.com) |

---

## 1. Clone & Install

```bash
git clone https://github.com/<your-username>/orqestr.git
cd orqestr
pnpm install
```

---

## 2. Environment Variables

### `server/.env`

```env
PORT=8000

# Neon Database (grab the connection string from your Neon Console)
DATABASE_URL=postgresql://<user>:<password>@<ep-your-subdomain>.us-east-2.aws.neon.tech/neondb?sslmode=require

# Local Docker Redis
REDIS_URL=redis://localhost:6379

# Frontend URL (for CORS)
CLIENT_URL=http://localhost:3000

# Groq AI
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=openai/gpt-oss-120b

# JWT (use any random strings)
JWT_SECRET=your_jwt_access_secret
JWT_REFRESH_SECRET=your_jwt_refresh_secret

# Optional: Logging (debug in development, info in production)
LOG_LEVEL=debug

# Optional: OAuth (leave blank to skip; callbacks use secure one-time code exchange)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:8000/api/auth/google/callback
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:8000/api/auth/github/callback
```

### `client/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 3. Start Redis (Docker)

```bash
docker run -d --name agent_platform_redis -p 6379:6379 redis:7-alpine
```

Verify it's running:

```bash
docker ps
# should show agent_platform_redis on 0.0.0.0:6379->6379/tcp
```

---

## 4. Push Database Schema

```bash
cd server
pnpm prisma db push
pnpm prisma generate
cd ..
```

> **Note**: We use `db push` instead of `migrate dev` because Neon's free tier works better with direct schema pushes. This syncs your Prisma schema straight to the database without migration files.

---

## 5. Start the App

From the project root:

```bash
pnpm dev
```

This starts both the server and client concurrently:

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger Docs | http://localhost:8000/api/docs |
| Health Check | http://localhost:8000/health |

---

## 6. Running Tests & Verifying Your Setup

Orqestr includes a comprehensive test suite of **373 tests across 44 test files** (262 server tests + 111 client tests) covering DAG dependency resolution, multi-parent fan-in atomic claiming, race guards, template interpolation, agent workers, SSRF validators, and organization RBAC.

Run all tests from the repository root:

```bash
# Run server test suite (262 tests in Vitest)
pnpm test:server

# Run client test suite (111 tests in Vitest)
pnpm test:client

# Watch mode during development
pnpm test:server:watch
pnpm test:client:watch
```

---

## 7. Building for Production

To create production bundles for both client and server:

```bash
pnpm build
```

* **Client**: Compiles Next.js standalone output with optimized static pages and server routes.
* **Server**: Compiles TypeScript into `dist/` with Prisma client generation.

---

## Common Issues & Fixes

### `P1000: Authentication failed` on database connect
**Cause**: Local PostgreSQL conflicting with the connection string, or wrong credentials.
**Fix**: Make sure you're using your Neon connection string with `?sslmode=require` at the end.

### `model_not_found` (404) from Groq
**Cause**: Older model IDs like `llama3-8b-8192` have been decommissioned on Groq's free tier.
**Fix**: Use `GROQ_MODEL=openai/gpt-oss-120b` in your `server/.env`.

### 401 errors when saving workflows
**Cause**: Access token expired and cookie settings don't work across different ports in dev.
**Fix**: Handled automatically — the app uses silent token refresh with `sameSite: "lax"` cookies in development and `localStorage` fallback for the refresh token.

### Redis connection refused
**Cause**: Docker container not running.
**Fix**: `docker start agent_platform_redis` or re-run the `docker run` command from Step 3.

### OAuth Redirects & Local Setup
**Note**: If Google or GitHub OAuth credentials are not provided in `server/.env`, password-based registration and login remain 100% functional. When configuring OAuth, set the callback URLs to `http://localhost:8000/api/auth/google/callback` and `http://localhost:8000/api/auth/github/callback`. Tokens are never passed via URL query strings; the browser receives an ephemeral 32-byte exchange code consumed via `POST /api/auth/oauth/exchange`.

