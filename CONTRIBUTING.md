# Contributing to Orqestr

Thanks for your interest in contributing to Orqestr. This document covers everything you need to get started — project structure, development setup, coding standards, and the contribution workflow.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Branching Strategy](#branching-strategy)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Adding a New API Module](#adding-a-new-api-module)
- [Adding a New Agent Type](#adding-a-new-agent-type)
- [Multi-Tenant & Organization Guidelines](#multi-tenant--organization-guidelines)
- [Queue & Worker Development Guidelines](#queue--worker-development-guidelines)
- [Security & Logging Expectations](#security--logging-expectations)
- [Testing Guidelines & Integration Tests](#testing-guidelines--integration-tests)
- [Documentation Expectations](#documentation-expectations)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

---

## Code of Conduct

Be respectful, constructive, and collaborative. Contributions of all sizes are welcome — bug fixes, documentation improvements, new agent types, and feature additions are all valued equally.

---

## Getting Started

Before contributing, make sure you understand the core concepts:

- **Workflow** — a visual graph of agent nodes connected by edges, saved as a JSON definition
- **Run** — a live execution of a workflow definition with a specific input payload
- **Agent** — a worker process that handles a specific type of task (LLM, HTTP, Transform, etc.)
- **Orchestrator** — the engine that dispatches tasks, resolves dependencies, and tracks run state

If anything is unclear, open a discussion before starting work.

---

## Project Structure

```
orqestr/
├── client/                         # Next.js frontend
│   ├── __tests__/                  # Test Suite (111 tests, 14 test files)
│   ├── app/                        # App router pages
│   ├── components/                 # React components
│   ├── hooks/                      # Custom hooks for API calling
│   ├── lib/                        # Utility methods and types
│   ├── providers/                  # Context providers
│   └── package.json
├── server/                         # Express backend
│   ├── __tests__/                  # Test suite (262 tests, 30 test files)
│   │   ├── api/                    # API integration tests (supertest)
│   │   ├── helpers/                # Mock factories and app builder
│   │   ├── orchestrator/           # Orchestrator workflow tests
│   │   ├── services/               # Service layer unit tests
│   │   ├── utils/                  # Utility function tests
│   │   └── setup.ts                # Global mocks and env config
│   ├── agents/                     # Agent worker implementations
│   │   ├── base.agent.ts           # Abstract base class
│   │   ├── llm.agent.ts            # Groq LLM agent
│   │   ├── http.agent.ts           # HTTP fetch agent (SSRF & 5MB capped)
│   │   ├── transform.agent.ts      # LLM data transformation agent
│   │   └── registry.ts             # Agent startup registry
│   ├── api/                        # Modular REST API
│   │   ├── auth/                   # Authentication module (JWT, OAuth exchange, state)
│   │   ├── workflow/               # Workflow module & versioning
│   │   ├── scheduler/              # Cron scheduling module (BullMQ repeatables)
│   │   ├── webhook/                # Webhook trigger module
│   │   ├── organization/           # Multi-tenant organization module
│   │   ├── notification/           # In-app notifications module
│   │   ├── run/                    # Run execution & SSE module
│   │   ├── dashboard/              # Dashboard metrics module
│   │   └── agent/                  # Agent registry & node testing module
│   ├── config/                     # App configuration
│   │   ├── index.ts                # Typed env variables
│   │   ├── logger.config.ts        # Winston logger with log sanitizer
│   │   ├── prisma.config.ts        # Prisma singleton
│   │   ├── redis.config.ts         # Redis singleton
│   │   └── groq.config.ts          # Groq client singleton
│   ├── events/
│   │   └── run.emitter.ts          # In-process event emitter for SSE
│   ├── orchestrator/
│   │   └── index.ts                # Workflow orchestration engine (atomic claiming)
│   ├── queues/
│   │   └── index.ts                # BullMQ queue abstraction
│   ├── middleware/
│   │   ├── auth.middleware.ts      # JWT & optional auth guards
│   │   ├── org.middleware.ts       # Tenant organization header guard
│   │   ├── error.middleware.ts     # Global error handler (sanitized 500s)
│   │   ├── rate-limiter.middleware.ts # Redis sliding-window rate limiters
│   │   └── request-logger.middleware.ts # Request logger with x-request-id
│   ├── prisma/
│   │   └── schema.prisma           # Database schema
│   ├── swagger/                    # OpenAPI / Swagger specs
│   │   └── openapi.ts              # API documentation spec
│   ├── utils/
│   │   ├── errors.ts               # Typed API error classes
│   │   ├── types.ts                # Shared TypeScript types
│   │   ├── template.utils.ts       # Prompt interpolation
│   │   ├── dag-validator.ts        # Graph acyclicity validator (Kahn's algorithm)
│   │   ├── url-validator.ts        # SSRF validator & DNS checker
│   │   └── log-sanitizer.ts        # Deep redaction engine for secrets & URIs
│   └── index.ts                    # Server entry point
├── docker-compose.yml              # Postgres + Redis
├── .eslintrc.js                    # Shared ESLint config
├── .prettierrc                     # Shared Prettier config
├── tsconfig.base.json              # Base TypeScript config
└── pnpm-workspace.yaml             # pnpm workspace config
```

---

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker Desktop

### Install dependencies

```bash
git clone https://github.com/yourusername/orqestr.git
cd orqestr
pnpm install
```

### Environment variables

```bash
# Root — Docker Compose
cp .env.example .env

# Server — application config
cp server/.env.example server/.env

# Client — API URL
cp client/.env.local.example client/.env.local
```

Fill in `server/.env` with your Groq API key. Get one free at [console.groq.com](https://console.groq.com).

### Start infrastructure

```bash
docker compose up -d
```

### Run database migrations

```bash
cd server
pnpm prisma migrate dev
```

### Start development servers

```bash
# From root — starts both client and server
pnpm dev:server   # http://localhost:8000
pnpm dev:client   # http://localhost:3000
```

### Verify everything works

```bash
curl http://localhost:8000/health
# Should return { "status": "ok" }
```

### Run tests

```bash
# Run all backend tests
pnpm test:server

# Watch mode
pnpm test:server:watch

# Run all frontend tests
pnpm test:client

# Watch mode
pnpm test:client:watch
```

---

## Coding Standards

All code must pass linting and formatting checks before merging.

```bash
pnpm lint          # ESLint across client and server
pnpm format        # Prettier write
```

### TypeScript

- Strict mode is enabled — no implicit `any`
- Always define explicit return types on public methods and exported functions
- Use the typed error classes from `server/utils/errors.ts` — never throw raw strings
- Use the typed controller utilities from `client/lib/types.ts` — `Controller`, `BodyController`, `ParamsController`

### Naming conventions

| Thing                   | Convention               | Example                                 |
| ----------------------- | ------------------------ | --------------------------------------- |
| Files                   | kebab-case               | `llm.agent.ts`, `workflow.service.ts`   |
| Classes                 | PascalCase               | `BaseAgent`, `WorkflowService`          |
| Functions and variables | camelCase                | `triggerRun`, `jobQueue`                |
| Constants               | SCREAMING_SNAKE_CASE     | `MAX_RETRIES`, `DEFAULT_MODEL`          |
| Database tables         | snake_case               | `workflow_definitions`, `workflow_runs` |
| React components        | PascalCase               | `AgentNode`, `StatCard`                 |
| React component files   | PascalCase or kebab-case | `AgentNode.tsx` or `agent-node.tsx`     |

### Architecture rules

- **Controllers** — HTTP concerns only. Read `req`, call service, send `res`. No business logic, no database calls.
- **Services** — business logic only. No Express objects. Throw typed errors on invalid states.
- **Repositories** — database only. One query per method. No logging, no error handling.
- **Agents** — extend `BaseAgent` and implement `execute()` only. Never touch queues or databases directly inside `execute()`. HTTP requests must pass through `validateUrl()` and adhere to the 5MB payload limit.
- **Orchestrator & Concurrency Invariants** — multi-parent fan-in tasks must be claimed atomically in PostgreSQL via `updateMany({ status: PENDING } -> { status: RUNNING })` before queue insertion, and pass `{ jobId: task.id }` for deduplication. Run completion evaluation must respect terminal states (`FAILED` / `CANCELLED`).
- **RBAC & Lifecycle Cleanup** — organization workflow deletion requires `OWNER` or `ADMIN` roles and must explicitly purge repeatable scheduler jobs from Redis via `SchedulerService.removeRepeatableJob`.
- **No `console.log`** — use the Winston logger from `server/config/logger.config.ts`. All log output automatically passes through the `log-sanitizer.ts` deep credential redaction engine.
- **Request Tracing** — always propagate `x-request-id` headers in error handling and cross-service calls.
- **No `process.env` outside config** — all environment variables are read in `server/config/index.ts` and exported as typed constants.

---

## Branching Strategy

```
main          ← production-ready, protected
feature/*     ← new features
fix/*         ← bug fixes
chore/*       ← tooling, deps, config changes
docs/*        ← documentation only
```

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

---

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) spec:

```
<type>(<scope>): <short description>

[optional body]
```

### Types

| Type       | When to use                                             |
| ---------- | ------------------------------------------------------- |
| `feat`     | New feature                                             |
| `fix`      | Bug fix                                                 |
| `chore`    | Tooling, dependencies, config                           |
| `docs`     | Documentation only                                      |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Adding or updating tests                                |
| `perf`     | Performance improvement                                 |

### Examples

```
feat(agents): add HTTP agent worker implementation
fix(orchestrator): resolve race condition in dependency dispatch
chore(deps): upgrade prisma to 6.3.0
docs(readme): add deployment instructions for Railway
refactor(api): extract workflow validation into service layer
```

---

## Pull Request Process

1. **Branch** from `main` with a descriptive name
2. **Write clean code** — follow the coding standards above
3. **Test manually** — trigger a workflow run and verify end to end
4. **Run checks locally** before pushing:
   ```bash
   pnpm lint && pnpm format
   ```
5. **Run all tests locally** before pushing:
   ```bash
   pnpm test:server # test server(backend)
   pnpm test:client # test client(frontend)
   ```
6. **Open a PR** against `main` with:
   - A clear title following the commit message format
   - A description of what changed and why
   - Screenshots or screen recordings for UI changes
   - Notes on any breaking changes
7. **Address review feedback** — keep the conversation constructive
8. **Squash commits** before merging if the branch has noisy interim commits

> PRs with failing CI checks will not be merged.

---

## Adding a New Agent Type

Adding a new agent is the most common contribution. The architecture is designed so this requires changes in exactly four places:

### 1. Add the enum value to the Prisma schema

```prisma
// server/prisma/schema.prisma
enum AgentType {
  LLM_AGENT
  HTTP_AGENT
  TRANSFORM_AGENT
  EXTRACTION_AGENT
  NOTIFICATION_AGENT
  STORAGE_AGENT
  YOUR_NEW_AGENT  // ← add here
}
```

Run `pnpm prisma migrate dev --name add-your-new-agent`.

### 2. Create the agent worker

```typescript
// server/agents/your-new.agent.ts
import { AgentType, PrismaClient } from "@prisma/client";
import { BaseAgent } from "./base.agent";

interface YourAgentInput {
  // define input shape
}

interface YourAgentConfig {
  // define config shape
}

export class YourNewAgent extends BaseAgent {
  constructor(name: string, concurrency: number = 1, prisma: PrismaClient) {
    super(name, AgentType.YOUR_NEW_AGENT, concurrency, prisma);
  }

  async execute(input: unknown, config: unknown): Promise<unknown> {
    const typedInput = input as YourAgentInput;
    const typedConfig = config as YourAgentConfig;

    // your implementation here

    return { result: "..." };
  }
}
```

### 3. Register the agent in the registry

```typescript
// server/agents/registry.ts
import { YourNewAgent } from "./your-new.agent";

const yourNewAgent = new YourNewAgent("YOUR_NEW_AGENT_1", 1, prisma);
const agents = [llmAgent, yourNewAgent];
```

### 4. Add the node type to the frontend builder

```typescript
// client/components/workflows/builder/NodePalette.tsx
{
  type: "YOUR_NEW_AGENT",
  name: "Your New Agent",
  description: "What this agent does",
  icon: YourIcon,
}
```

Add the agent meta to `AgentNode.tsx` and config fields to `NodeConfigPanel.tsx`.

That's it. The queue, orchestrator, and run monitor all handle the new type automatically.

---

## Adding a New API Module

All backend features are organized into modular slices under `server/api/<module-name>/`. When adding a new API endpoint or resource, follow this exact structure:

```
server/api/<module-name>/
├── <module-name>.controller.ts    # HTTP request handling, DTO mapping, status codes
├── <module-name>.service.ts       # Business logic, authorization, error throwing
├── <module-name>.repository.ts    # Prisma database queries (one query per method)
├── <module-name>.routes.ts        # Express router registration with middleware
├── <module-name>.dto.ts           # TypeScript interfaces for request bodies & query params
└── index.ts                       # Module factory and public router export
```

### 1. Repository
Repositories directly query PostgreSQL via Prisma. Never perform logging or throw HTTP errors here. Return Prisma objects or `null`:
```typescript
export class ExampleRepository {
  constructor(private prisma: PrismaClient) {}
  async findById(id: string) {
    return this.prisma.example.findUnique({ where: { id } });
  }
}
```

### 2. Service
Services contain all business rules. They must be decoupled from Express (`req`/`res`) and throw typed errors from `server/utils/errors.ts`:
```typescript
export class ExampleService {
  constructor(private repo: ExampleRepository) {}
  async getItem(id: string, userId: string) {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundError("Example", id);
    if (item.userId !== userId) throw new ForbiddenError("Access denied");
    return item;
  }
}
```

### 3. Controller
Controllers unpack HTTP parameters, invoke the service, and format JSON responses:
```typescript
export class ExampleController {
  constructor(private service: ExampleService) {}
  getItem = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = await this.service.getItem(req.params.id, req.userId!);
      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  };
}
```

### 4. Router & Wireup
Register routes with authentication and validation middleware in `routes.ts`:
```typescript
export const createExampleRouter = (prisma: PrismaClient) => {
  const repo = new ExampleRepository(prisma);
  const service = new ExampleService(repo);
  const controller = new ExampleController(service);
  const router = Router();

  router.get("/:id", authenticate, controller.getItem);
  return router;
};
```
Mount the router in `server/index.ts` under `/api/<module-name>`.

---

## Multi-Tenant & Organization Guidelines

When building or touching endpoints that interact with workflows, runs, or resources:

1. **Context Extraction**:
   - `orgMiddleware` automatically inspects the `x-organization-id` header on incoming requests.
   - If present, it validates that `OrganizationMember` exists for `[organizationId, userId]`. If not a member, it immediately rejects with 403 `FORBIDDEN_ORGANIZATION`.
   - The validated organization ID is attached to `req.organizationId`.
2. **Access Control (`canAccess`)**:
   - Workflows can be personal (`userId` set, `organizationId: null`) or organizational (`organizationId` set).
   - Use the domain rule: A user can access a workflow if:
     - `workflow.userId === userId` (owner), OR
     - `workflow.organizationId === organizationId` AND the user is a member of that organization.
   - If unauthorized, throw `NotFoundError("Workflow", id)` rather than `ForbiddenError` to prevent entity enumeration.
3. **Role-Based Permissions (RBAC)**:
   - `OWNER`: Full administrative control (delete workspace, transfer ownership, manage roles).
   - `ADMIN`: Manage workflows, invite members, remove regular members.
   - `MEMBER`: View and edit workflows, trigger runs, test nodes. Cannot delete workflows or invite members.
   - When deleting an organizational workflow, verify caller has `OWNER` or `ADMIN` role.
4. **Cache Namespaces**:
   - Always prefix Redis cache keys with tenant identifiers:
     - Personal: `user:${userId}:dashboard:stats`
     - Organization: `org:${orgId}:dashboard:stats`

---

## Queue & Worker Development Guidelines

When modifying agent workers or BullMQ queues:

1. **Job Exclusivity & Locks**:
   - BullMQ holds a Redis lock while a worker executes a task.
   - Do not perform unbounded synchronous work on the event loop; keep I/O operations asynchronous.
2. **Exponential Backoff & Retries**:
   - Tasks are configured with `attempts: 3` and exponential backoff (`1000ms * 2^attempt`).
   - Intermediate failures leave the task in `RUNNING` status with an informational error log.
   - Only when `attemptsMade + 1 >= maxAttempts` does the orchestrator mark the task and run as `FAILED`.
3. **Queue-Level Deduplication**:
   - Always push downstream tasks using `{ jobId: task.id }`. This prevents Redis from accepting duplicate jobs even under concurrent event loops.
4. **Queue Failure Compensation Rollback**:
   - If adding a job to BullMQ throws an error, wrap the call in a try/catch and roll the task status back to `PENDING` in PostgreSQL:
     ```typescript
     try {
       await jobQueue.addTaskToQueue(task.type, payload, task.id);
     } catch (err) {
       await prisma.task.update({ where: { id: task.id }, data: { status: TaskStatus.PENDING } });
       throw err;
     }
     ```

---

## Security & Logging Expectations

1. **Server-Side Request Forgery (SSRF) Protection**:
   - Any worker or route making outbound HTTP requests based on user-supplied URLs must validate the destination using `validateUrl()` from `server/utils/url-validator.ts`.
   - Never allow requests to loopback (`127.0.0.1`), private networks (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`), or cloud metadata (`169.254.169.254`).
2. **Payload Size Capping**:
   - Outbound HTTP responses must not exceed **5MB**. Check `Content-Length` headers and stream the body with a byte counter to abort oversized transfers.
3. **Structured Logging with Redaction**:
   - Never use `console.log()` or `console.error()`. Use the typed Winston logger (`logger.info()`, `logger.error()`).
   - All logs pass through `log-sanitizer.ts`. However, you should still avoid logging raw credentials, passwords, or Authorization headers.
4. **Request Correlation (`x-request-id`)**:
   - Every request is tagged with an `x-request-id` header. Include `req.id` or `requestId` in error logs to facilitate end-to-end tracing.

---

## Testing Guidelines & Integration Tests

All pull requests must maintain or improve the test suite (currently **373 tests across 44 test suites**).

1. **Service Unit Tests**:
   - Mock Prisma models using `vitest` spies:
     ```typescript
     const mockPrisma = {
       workflowDefinition: { findUnique: vi.fn(), update: vi.fn() },
     } as unknown as PrismaClient;
     ```
2. **API Integration Tests (Supertest)**:
   - Use the test app helper (`createTestApp()`) from `server/__tests__/helpers/`.
   - Test both success and adversarial paths (invalid input, 401 unauthenticated, 403 forbidden, 404 not found, 429 rate limited).
3. **Running the Full Suite**:
   ```bash
   pnpm test:server    # 262 server tests
   pnpm test:client    # 111 client tests
   ```

---

## Documentation Expectations

When introducing a new feature, database model, or route:
1. Update `docs/architecture.md` if components or data flows change.
2. Update `docs/system-design.md` if invariants, domain models, or lifecycle states change.
3. Update `docs/user-flows.md` if user-facing journeys or API permissions change.
4. Update `server/swagger/openapi.ts` with typed OpenAPI request/response schemas.
5. Update `.vault/TECH_STACK_JUSTIFICATION.md` if new external packages or architectural patterns are introduced.

---

## Reporting Bugs

Open a GitHub Issue with:

- **Title** — short description of the bug
- **Steps to reproduce** — numbered, specific
- **Expected behaviour** — what should happen
- **Actual behaviour** — what actually happens
- **Environment** — Node version, OS, browser if frontend
- **Logs** — relevant server logs or browser console errors
- **Screenshots** — if it's a UI issue

Use the `bug` label.

---

## Suggesting Features

Open a GitHub Issue with:

- **Title** — short description of the feature
- **Problem** — what gap or friction does this address
- **Proposed solution** — how you'd implement it
- **Alternatives considered** — other approaches you thought about
- **Scope** — is this a small addition or a large architectural change

Use the `enhancement` or `feature` label. For large changes, open a discussion first before writing any code — it avoids wasted effort if the direction isn't right.

---

## Questions

Open a GitHub Discussion if you have questions about the codebase, architecture decisions, or contribution ideas. Issues are for bugs and feature requests only.
