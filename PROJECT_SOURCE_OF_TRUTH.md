# Orqestr — Technical Source of Truth & System Reference Manual

> **Document Classification**: Authoritative Engineering Snapshot & Source of Truth  
> **Repository Commit**: `85ac7cdc90ae7ad18d0236cdde1b0162986e4d34`  
> **Snapshot Date**: August 27, 2026  
> **Source-of-Truth Hierarchy**: Active Codebase > Schema/Migrations/Configs > Tests > Documentation  
> **Purpose**: Technical interview preparation, system design explanation, resume generation, and architectural defense.

---

## 1. Project Overview

### 1.1 What the Product Does
**Orqestr** is a full-stack, distributed, multi-agent AI workflow orchestration platform. It enables software engineers and operators to visually construct, validate, schedule, and execute complex directed acyclic graphs (DAGs) of AI agents and external web services. Individual agents specialize in discrete responsibilities—such as prompt-based reasoning (LLM), external service integration (HTTP with SSRF protection), and deterministic data manipulation (Transform)—passing execution payloads asynchronously across distributed Redis queues.

### 1.2 The Problem It Solves
Modern AI systems frequently require chaining multiple Large Language Model calls, external API lookups, and data reshaping operations. Performing these operations synchronously in an HTTP request handler introduces critical distributed systems failure modes:
1. **HTTP Gateway Timeouts**: LLM inference and third-party APIs often exceed 30–60 second reverse proxy timeouts.
2. **Cascading Failures**: A failure in step 4 of a 5-step pipeline causes the entire pipeline to fail, discarding intermediate outputs and wasting expensive LLM tokens.
3. **Runaway Resource Consumption**: Unbounded concurrency quickly exhausts downstream rate limits and server memory.
4. **Lack of Observability**: Synchronous request-response flows leave operators blind to intermediate node latency, payload states, and partial execution failures.

Orqestr solves these challenges by decoupling workflow initiation from execution through persistent DAG state machines in PostgreSQL, asynchronous job queues in Redis (BullMQ), and real-time streaming execution telemetry via Server-Sent Events (SSE).

### 1.3 Target Audience & Primary Use Cases
- **Audience**: Software engineers, backend architects, platform engineers, and technical teams building autonomous AI agent pipelines.
- **Primary Use Cases**:
  - **Automated Research & Summarization**: Trigger an HTTP agent to fetch web documentation or pull requests, pipe the raw body into a Transform agent to extract structured entities, and feed the clean output to an LLM agent for structured insight synthesis.
  - **Scheduled Monitoring & Ingestion**: Run cron-scheduled health checks across third-party infrastructure, transform telemetry data, and push alert notifications.
  - **Event-Driven Webhook Pipelines**: Ingest inbound third-party webhooks (e.g., GitHub, Stripe), trigger asynchronous processing pipelines with cryptographic authentication, and capture results without blocking the caller.

### 1.4 What Makes the Architecture Technically Interesting
- **Topological DAG Execution Engine**: Workflows are modeled as directed acyclic graphs validated using Kahn's algorithm. Workflows execute asynchronously: root tasks dispatch in parallel, intermediate nodes wait for all parent dependencies to resolve (fan-in), and unblocked tasks dispatch automatically with aggregated parent outputs.
- **Race-Condition-Resistant Distributed State Machine**: Implements atomic database claim queries (`prisma.task.updateMany`) and BullMQ job deduplication (`jobId: task.id`) to eliminate double-dispatch during concurrent fan-in resolution. Employs compensation rollbacks if queue insertion fails.
- **Terminal Status Invariants**: Conditional database updates (`WHERE status = RUNNING`) ensure late-finishing tasks cannot overwrite terminal workflow states (`CANCELLED` or `FAILED`).
- **Comprehensive Defense-in-Depth Security**: Protects against Server-Side Request Forgery (SSRF) via DNS pre-resolution and IP range blocking (RFC 1918, loopback, carrier-grade NAT, cloud metadata IPs). Features single-use ephemeral OAuth 2.0 exchange codes, deep recursive log sanitization, and organization-scoped multi-tenancy.

---

## 2. Current Implementation Snapshot & System Architecture

```
                                      ┌─────────────────────────────────────────────────────────┐
                                      │                   CLIENT TIER (Next.js 16)              │
                                      │                                                         │
                                      │   React Flow DAG Canvas   │   SSE Run Execution Monitor │
                                      │   Dagre Auto-Layout       │   Undo/Redo History Stack   │
                                      │   React Query Caching     │   Multi-Tenant Org Switcher │
                                      └────────────────────────────┬────────────────────────────┘
                                                                   │ REST / SSE
                                                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                          EXPRESS 5 API LAYER                                                           │
│                                                                                                                                        │
│   Rate Limiters (Redis)  │  JWT & Cookie Auth  │  RBAC (Org Middleware)  │  SSRF Validator  │  Log Sanitizer  │  Swagger UI (/api/docs) │
└───────┬───────────────────────────────┬──────────────────────────────┬──────────────────────────────┬───────────────────────────┬──────┘
        │                               │                              │                              │                           │
        ▼                               ▼                              ▼                              ▼                           ▼
┌──────────────┐             ┌─────────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐      ┌─────────────┐
│  PostgreSQL  │             │   Orchestrator DAG  │        │   BullMQ Queues     │        │    Agent Workers    │      │  Groq Cloud │
│    (Neon)    │             │     Engine          │        │      (Redis)        │        │   (Node Processes)  │      │     API     │
│              │             │                     │        │                     │        │                     │      │             │
│ 12 Tables    │ ◄────────── │ - Kahn's Algorithm  │ ─────> │ - LLM_AGENT         │ ─────> │ - LLM Agent         │ ───> │ gpt-oss-    │
│ Foreign Keys │  State &    │ - Atomic Claiming   │ Enqueue│ - HTTP_AGENT        │ Dequeue│ - HTTP Agent        │      │   120b      │
│ Indexes      │  Results    │ - Fan-In Aggregation│        │ - TRANSFORM_AGENT   │        │ - Transform Agent   │      │             │
│ Cascades     │             │ - Stale Run Reaper  │ ◄───── │ - SCHEDULER_QUEUE   │ ◄───── │ (BaseAgent Registry)│      │ Rate-Limited│
└──────────────┘             └──────────┬──────────┘ Events └─────────────────────┘ Status └─────────────────────┘      └─────────────┘
                                        │
                                        ▼
                             ┌─────────────────────┐
                             │  RunEventEmitter    │ ──────> Push Server-Sent Events (/api/runs/:runId/stream)
                             │  (In-Memory Bus)    │
                             └─────────────────────┘
```

---

## 3. Technology Stack

The following table documents every technology verifiable from the current repository:

| Technology | Layer / Location | Concrete Purpose in Codebase | Architectural Role & Relevance |
| :--- | :--- | :--- | :--- |
| **Node.js (v20+)** | Runtime | Server runtime environment | Asynchronous event-driven I/O engine supporting non-blocking queue consumers and SSE connections. |
| **Express 5 (`^5.2.1`)** | Backend Framework | HTTP routing, middleware, controllers | Modernized routing engine with native Promise rejection handling in middleware; hosts all REST and SSE endpoints. |
| **TypeScript (`^5.9.3`)** | Language / Full-stack | Static typing, contract parity | Provides strict compile-time validation across Prisma models, API DTOs, BullMQ job payloads, and React components. |
| **Prisma ORM (`^6.2.0`)** | Data Access Layer | Schema definition, SQL migrations, query building | Type-safe database client; enforces relational integrity, connection pooling, and parameterized SQL queries. |
| **PostgreSQL** | Primary Relational DB | Persistent domain state storage | Stores users, organizations, workflow definitions, versions, schedules, webhooks, runs, and tasks with ACID transactions. |
| **Redis / ioredis (`^5.10.1`)** | In-Memory Infrastructure | Message broker, cache, rate limiter, state store | High-throughput in-memory store backing BullMQ queues, cache-aside read caching, sliding window rate limiters, and OAuth state. |
| **BullMQ (`^5.77.0`)** | Job Queue Framework | Distributed queue management & worker orchestration | Handles background agent execution, concurrency limits, job retries with exponential backoff, repeatable cron jobs, and task deduplication. |
| **Next.js 16 (`16.2.6`)** | Frontend Framework | Client application hosting & routing | React 19 App Router with Turbopack compilation; provides hybrid client-side routing, code splitting, and layout trees. |
| **React 19 (`19.2.4`)** | UI Library | Component rendering & state management | Modern declarative user interface engine using concurrent rendering primitives. |
| **React Flow (`@xyflow/react` `^12.10.2`)** | Visual Canvas Engine | Interactive workflow graph editor | Renders draggable agent nodes, directional bezier edges, connection handles, minimap, and canvas controls. |
| **Dagre (`@dagrejs/dagre` `^3.1.1`)** | Graph Layout Engine | Automated DAG visual arrangement | Calculates hierarchical node coordinates based on edge topological order, auto-centering nodes on the canvas. |
| **TanStack React Query (`^5.100.14`)** | Client Cache / State | Server state management & query caching | Manages asynchronous server state caching, background refetching, query invalidation, and mutation lifecycles. |
| **Groq SDK (`^1.2.0`)** | LLM Inference Provider | High-speed LLM chat completions | Powers reasoning in `LLMAgent` and structured data reshaping in `TransformAgent` (defaulting to `openai/gpt-oss-120b`). |
| **Winston (`^3.19.0`)** | Logging Framework | Structured logging & secret redaction | Production logging engine with console and file transports, correlation tracking (`req.id`), and deep recursive credential masking. |
| **Swagger UI (`swagger-ui-express`)** | Documentation | Interactive OpenAPI documentation | Exposes interactive API documentation at `/api/docs` generated via JSDoc annotations and OpenAPI 3.0 specs. |
| **Vitest (`^4.1.8`)** | Test Framework | Server and client automated test execution | High-performance test runner providing unit, integration, and mocking harnesses across 373 passing tests. |
| **Docker** | Containerization | Production container bundling | Multi-stage `Dockerfile` (Node 20 slim + pnpm + OpenSSL) supporting automated deployment on Render/Koyeb. |

---

## 4. Domain Model & Database Schema

The database schema is defined in [`server/prisma/schema.prisma`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/prisma/schema.prisma) and maps to **12 relational tables** in PostgreSQL:

```mermaid
erDiagram
    USER ||--o{ REFRESH_TOKEN : "userId (Cascade)"
    USER ||--o{ ORGANIZATION_MEMBER : "userId (Cascade)"
    ORGANIZATION ||--o{ ORGANIZATION_MEMBER : "organizationId (Cascade)"

    USER ||--o{ WORKFLOW_DEFINITION : "userId"
    ORGANIZATION ||--o{ WORKFLOW_DEFINITION : "organizationId"

    WORKFLOW_DEFINITION ||--o{ WORKFLOW_VERSION : "workflowId (Cascade)"
    WORKFLOW_DEFINITION ||--o| WORKFLOW_SCHEDULE : "workflowId (Cascade)"
    USER ||--o{ WORKFLOW_SCHEDULE : "userId"

    WORKFLOW_DEFINITION ||--o| WEBHOOK : "workflowId (Cascade)"
    USER ||--o{ WEBHOOK : "userId"

    WORKFLOW_DEFINITION ||--o{ WORKFLOW_RUN : "workflowId"
    USER ||--o{ WORKFLOW_RUN : "userId"
    USER ||--o{ NOTIFICATION : "userId (Cascade)"

    WORKFLOW_RUN ||--o{ TASK : "runId"

    USER {
        string id PK
        string email UK
        string password
        string name
        string googleId UK
        string githubId UK
        datetime createdAt
    }

    REFRESH_TOKEN {
        string id PK
        string token UK
        string userId FK
        datetime expiresAt
        datetime createdAt
    }

    ORGANIZATION {
        string id PK
        string name
        string slug UK
        datetime createdAt
        datetime updatedAt
    }

    ORGANIZATION_MEMBER {
        string id PK
        string organizationId FK
        string userId FK
        string role
        datetime createdAt
    }

    WORKFLOW_DEFINITION {
        string id PK
        string name
        string description
        json definition
        int version
        string userId FK
        string organizationId FK
        boolean isArchived
        datetime createdAt
        datetime updatedAt
    }

    WORKFLOW_VERSION {
        string id PK
        string workflowId FK
        int version
        string name
        string description
        json definition
        datetime createdAt
    }

    WORKFLOW_SCHEDULE {
        string id PK
        string workflowId FK
        string userId FK
        string cronExpression
        string timezone
        json input
        boolean enabled
        datetime lastRunAt
        datetime nextRunAt
        datetime createdAt
        datetime updatedAt
    }

    WEBHOOK {
        string id PK
        string workflowId FK
        string userId FK
        string token UK
        boolean enabled
        datetime lastCalledAt
        datetime createdAt
    }

    WORKFLOW_RUN {
        string id PK
        string workflowId FK
        string userId FK
        string status
        json input
        json output
        string error
        datetime startedAt
        datetime completedAt
    }

    TASK {
        string id PK
        string runId FK
        string name
        string type
        string status
        json input
        json output
        string error
        int attempts
        int maxAttempts
        json dependsOn
        boolean critical
        string nodeId
        datetime startedAt
        datetime completedAt
        datetime createdAt
    }

    AGENT {
        string id PK
        string name
        string type
        string status
        datetime lastSeenAt
        int tasksHandled
        int tasksFailed
        datetime createdAt
    }

    NOTIFICATION {
        string id PK
        string userId FK
        string title
        string message
        string type
        string organizationId
        json metadata
        boolean isRead
        datetime createdAt
    }
```

### 4.1 Detailed Entity Reference

#### 1. `User` (`users`)
- **Purpose**: Core user account entity supporting credentials and OAuth identities.
- **Fields**: `id` (PK, CUID), `email` (Unique, String), `password` (Nullable String; null for pure OAuth users), `name` (String), `googleId` (Unique Nullable String), `githubId` (Unique Nullable String), `createdAt` (DateTime).
- **Relations**: 1-to-many with `RefreshToken`, `WorkflowDefinition`, `WorkflowRun`, `WorkflowSchedule`, `Webhook`, `OrganizationMember`, `Notification`.

#### 2. `RefreshToken` (`refresh_tokens`)
- **Purpose**: Persisted refresh tokens supporting single-device invalidation and token rotation.
- **Fields**: `id` (PK, CUID), `token` (Unique String), `userId` (FK -> `users.id`, `onDelete: Cascade`), `expiresAt` (DateTime), `createdAt` (DateTime).
- **Indexes**: `[expiresAt]`.

#### 3. `Organization` (`organizations`)
- **Purpose**: Multi-tenant team workspace container.
- **Fields**: `id` (PK, CUID), `name` (String), `slug` (Unique String), `createdAt` (DateTime), `updatedAt` (DateTime).
- **Relations**: 1-to-many with `OrganizationMember`, `WorkflowDefinition`.

#### 4. `OrganizationMember` (`organization_members`)
- **Purpose**: Join model implementing Role-Based Access Control (RBAC) per workspace.
- **Fields**: `id` (PK, CUID), `organizationId` (FK -> `organizations.id`, `onDelete: Cascade`), `userId` (FK -> `users.id`, `onDelete: Cascade`), `role` (Enum `OrgRole`: `OWNER`, `ADMIN`, `MEMBER`; default `MEMBER`), `createdAt` (DateTime).
- **Constraints**: Composite unique constraint `@@unique([organizationId, userId])`.

#### 5. `WorkflowDefinition` (`workflow_definitions`)
- **Purpose**: The reusable structural blueprint of a DAG workflow.
- **Fields**: `id` (PK, CUID), `name` (String), `description` (Nullable String), `definition` (JSON payload containing `{ nodes: Node[], edges: Edge[] }`), `version` (Int, default 1), `userId` (Nullable FK -> `users.id`), `organizationId` (Nullable FK -> `organizations.id`), `isArchived` (Boolean, default `false`), `createdAt` (DateTime), `updatedAt` (DateTime).
- **Indexes**: `[userId]`, `[organizationId]`, `[isArchived]`.
- **Tenancy Constraint**: A workflow belongs either to a personal user account (`userId` set, `organizationId` null) or an organization workspace (`organizationId` set). Soft-deletes are represented by `isArchived = true`.

#### 6. `WorkflowVersion` (`workflow_versions`)
- **Purpose**: Immutable historical snapshots created upon workflow updates or prior to rollback.
- **Fields**: `id` (PK, CUID), `workflowId` (FK -> `workflow_definitions.id`, `onDelete: Cascade`), `version` (Int), `name` (String), `description` (Nullable String), `definition` (JSON), `createdAt` (DateTime).
- **Constraints**: Composite unique constraint `@@unique([workflowId, version])`.

#### 7. `WorkflowSchedule` (`workflow_schedules`)
- **Purpose**: Cron-based automated execution trigger configuration.
- **Fields**: `id` (PK, CUID), `workflowId` (Unique FK -> `workflow_definitions.id`, `onDelete: Cascade`), `userId` (FK -> `users.id`), `cronExpression` (String), `timezone` (String, default `"UTC"`), `input` (JSON, default `"{}"`), `enabled` (Boolean, default `true`), `lastRunAt` (Nullable DateTime), `nextRunAt` (Nullable DateTime), `createdAt` (DateTime), `updatedAt` (DateTime).
- **Constraint**: 1-to-1 relationship with `WorkflowDefinition` (`workflowId` is unique).

#### 8. `Webhook` (`webhooks`)
- **Purpose**: External inbound HTTP trigger configuration.
- **Fields**: `id` (PK, CUID), `workflowId` (Unique FK -> `workflow_definitions.id`, `onDelete: Cascade`), `userId` (FK -> `users.id`), `token` (Unique String, CUID), `enabled` (Boolean, default `true`), `lastCalledAt` (Nullable DateTime), `createdAt` (DateTime).
- **Constraint**: 1-to-1 relationship with `WorkflowDefinition` (`workflowId` is unique).

#### 9. `WorkflowRun` (`workflow_runs`)
- **Purpose**: Live execution record tracking the overall state and timestamps of a workflow run.
- **Fields**: `id` (PK, CUID), `workflowId` (FK -> `workflow_definitions.id`), `userId` (Nullable FK -> `users.id`), `status` (Enum `RunStatus`: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`; default `PENDING`), `input` (JSON), `output` (Nullable JSON), `error` (Nullable String), `startedAt` (DateTime, default `now()`), `completedAt` (Nullable DateTime).
- **Indexes**: `[workflowId]`, `[userId]`.

#### 10. `Task` (`tasks`)
- **Purpose**: Granular execution unit representing a single DAG node execution within a run.
- **Fields**: `id` (PK, CUID), `runId` (FK -> `workflow_runs.id`), `name` (String), `type` (Enum `AgentType`), `status` (Enum `TaskStatus`: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`; default `PENDING`), `input` (JSON), `output` (Nullable JSON), `error` (Nullable String), `attempts` (Int, default 0), `maxAttempts` (Int, default 3), `dependsOn` (JSON array of parent `taskId` strings, default `"[]"`), `critical` (Boolean, default `true`), `nodeId` (Nullable String, maps to canvas node ID), `startedAt` (Nullable DateTime), `completedAt` (Nullable DateTime), `createdAt` (DateTime).
- **Indexes**: `[runId]`, `[runId, status]`.

#### 11. `Agent` (`agents`)
- **Purpose**: Worker heartbeat registry tracking agent health, capabilities, and telemetry.
- **Fields**: `id` (PK, CUID), `name` (String), `type` (Enum `AgentType`), `status` (Enum `AgentStatus`: `ONLINE`, `OFFLINE`, `BUSY`; default `OFFLINE`), `lastSeenAt` (Nullable DateTime), `tasksHandled` (Int, default 0), `tasksFailed` (Int, default 0), `createdAt` (DateTime).
- **Constraints**: Composite unique constraint `@@unique([name, type])`.

#### 12. `Notification` (`notifications`)
- **Purpose**: User alert entity for workspace invitations and asynchronous system messages.
- **Fields**: `id` (PK, CUID), `userId` (FK -> `users.id`, `onDelete: Cascade`), `title` (String), `message` (String), `type` (String, default `"WORKSPACE_INVITE"`), `organizationId` (Nullable String), `metadata` (Nullable JSON), `isRead` (Boolean, default `false`), `createdAt` (DateTime).
- **Indexes**: `[userId, isRead]`, `[userId, createdAt]`.

---

## 5. Authentication, Authorization & Multi-Tenancy

```
[User Browser]
       │
       ├─ (1) POST /api/auth/login ──> Authenticates password via bcrypt
       │                               Sets httpOnly refresh cookie (sameSite: none, secure: true)
       │                               Returns short-lived accessToken (15m) + user payload
       │
       ├─ (2) GET /api/auth/google ──> Cryptographic 32-byte state generated -> Redis (TTL 300s)
       │                               Redirects to accounts.google.com with scope "openid email profile"
       │
       ├─ (3) Google Callback ───────> Validates & deletes Redis state (CSRF protection)
       │                               Exchanges auth code for user profile
       │                               Generates single-use 32-byte exchangeCode -> Redis (TTL 60s)
       │                               Redirects browser to: /auth/callback?code=<exchangeCode>
       │
       └─ (4) Exchange Call ─────────> POST /api/auth/oauth/exchange { code }
                                       Atomically retrieves & deletes exchange code from Redis
                                       Issues accessToken + refresh cookie -> Session active
```

### 5.1 Authentication Mechanisms
1. **Email & Password**:
   - Passwords hashed with `bcryptjs` (salt rounds: 12).
   - Rate limited on `/api/auth/register` (5 req/min) and `/api/auth/login` (10 req/min).
2. **Google & GitHub OAuth 2.0**:
   - **CSRF State Verification**: During redirect generation, the server generates a 32-byte cryptographic hex token (`crypto.randomBytes(32).toString("hex")`), stores it in Redis at `oauth:state:<state>` with a 300-second TTL, and verifies/deletes it on callback.
   - **GitHub Email Fallback**: If the user's primary GitHub profile email is private, the server queries `https://api.github.com/user/emails` to find the verified primary email address.
   - **Ephemeral Single-Use Code Exchange**: Instead of passing sensitive JWTs in the browser redirect URL, the server generates an ephemeral 32-byte exchange code stored in Redis (`oauth:exchange:<code>`) with a 60-second TTL. The client immediately calls `POST /api/auth/oauth/exchange` to claim the tokens, preventing credential leakage in browser history or referrer headers.
3. **Token Lifecycle & Dual-Layer Refresh**:
   - **Access Token**: Stateless JWT signed with `JWT_SECRET`, expiring in 15 minutes. Contains `{ userId }`.
   - **Dual-Layer Refresh Token**: On generation, the server creates a `crypto.randomUUID()` record in the `refresh_tokens` database table with an expiration timestamp (`expiresAt`), then signs a refresh JWT containing `{ tokenId: uuid }` signed with `JWT_REFRESH_SECRET` expiring in 7 days. On refresh or logout, the signature is verified before querying or revoking the persistent record.
   - **Cross-Domain Cookies**: Sent via `httpOnly`, `secure: true`, and `sameSite: "none"` in production to allow authentication between separate frontend (`vercel.app`) and backend (`onrender.com`) domains.

### 5.2 Organization Multi-Tenancy & RBAC
- **Tenant Context Extraction (`org.middleware.ts`)**:
  - The frontend passes the active organization ID via the `x-organization-id` header.
  - The middleware queries `organization_members` for the tuple `(organizationId, userId)`. If absent, it returns 403 `FORBIDDEN_ORGANIZATION`.
  - On valid membership, `req.organizationId` is populated. If the header is omitted, `req.organizationId` remains undefined (personal user scope).
- **Role-Based Permissions (`OrgRole`)**:
  - **`OWNER`**: Full control; manage billing, update organization details, delete organization, manage all members, create/edit/delete all workflows.
  - **`ADMIN`**: Workspace management; add/remove members, update member roles (except owner), create/edit/delete workflows.
  - **`MEMBER`**: Read and execute workflows, create new workflows, edit own workflows. **Explicitly prohibited** from deleting organization workflows (`deleteWorkflow` enforces `role === "OWNER" || role === "ADMIN"`).

---

## 6. Complete API Inventory

The backend exposes **52 REST endpoints**, **1 Server-Sent Events stream**, and **1 public Swagger documentation portal** (54 route handlers in total). All protected routes require a valid Bearer JWT.

| Method | Endpoint | Access / Auth | Rate Limit | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **System** | | | | |
| `GET` | `/health` | Public | None | Liveness and health check endpoint (`{"status":"ok"}`). |
| `GET` | `/api/docs` | Public | None | Interactive Swagger UI API documentation. |
| **Authentication** | | | | |
| `POST` | `/api/auth/register` | Public | 5 req / min | Register new user account with email, password, name. |
| `POST` | `/api/auth/login` | Public | 10 req / min | Authenticate credentials; returns access token & sets refresh cookie. |
| `POST` | `/api/auth/refresh` | Public | 30 req / min | Exchange refresh cookie or body token for new access token. |
| `POST` | `/api/auth/logout` | Public | None | Revokes refresh token in database and clears auth cookie. |
| `GET` | `/api/auth/me` | Protected | None | Returns profile and identity details of current authenticated user. |
| `GET` | `/api/auth/google` | Public | None | Generates CSRF state and redirects to Google OAuth consent screen. |
| `GET` | `/api/auth/google/callback` | Public | None | Validates Google auth code and CSRF state; redirects with exchange code. |
| `GET` | `/api/auth/github` | Public | None | Generates CSRF state and redirects to GitHub OAuth screen. |
| `GET` | `/api/auth/github/callback` | Public | None | Validates GitHub auth code and CSRF state; redirects with exchange code. |
| `POST` | `/api/auth/oauth/exchange` | Public | 15 req / min | Atomically exchanges single-use code for access & refresh tokens. |
| **Workflows** | | | | |
| `GET` | `/api/workflow` | Protected + Org | None | List workflows for personal account or current active organization. |
| `POST` | `/api/workflow` | Protected + Org | None | Create new workflow (validates DAG structure before persistence). |
| `GET` | `/api/workflow/:id` | Protected + Org | None | Retrieve single workflow by ID (cached in Redis for 5m). |
| `PUT` | `/api/workflow/:id` | Protected + Org | None | Update workflow definition; snapshots previous state into versions table. |
| `DELETE`| `/api/workflow/:id` | Protected + Org (Admin+) | None | Soft-delete workflow (`isArchived: true`); removes schedules & webhooks; enforces RBAC. |
| `POST` | `/api/workflow/:id/run` | Protected + Org | None | Trigger immediate execution of workflow with custom JSON input. |
| `GET` | `/api/workflow/:id/versions` | Protected + Org | None | Retrieve list of historical versions for a workflow. |
| `GET` | `/api/workflow/:id/versions/:version` | Protected + Org | None | Retrieve specific historical snapshot by version number. |
| `POST` | `/api/workflow/:id/versions/:version/restore` | Protected + Org | None | Rollback workflow to historical snapshot; snapshots active state first. |
| **Runs & Tasks** | | | | |
| `GET` | `/api/runs` | Protected + Org | None | List execution runs scoped to user or active organization. |
| `GET` | `/api/runs/:id` | Protected + Org | None | Retrieve execution run details, status, error, and constituent task states. |
| `GET` | `/api/runs/workflow/:workflowId` | Protected + Org | None | Retrieve run history for a specific workflow. |
| `POST` | `/api/runs/:id/cancel` | Protected + Org | None | Cancel in-flight run; atomically cancels pending tasks and emits event. |
| `GET` | `/api/runs/:runId/stream`| Protected (Bearer / Query) | None | SSE stream for live real-time execution progress updates. |
| **Scheduler** | | | | |
| `GET` | `/api/workflow/:id/schedule` | Protected + Org | None | Get schedule configuration for workflow. |
| `POST` | `/api/workflow/:id/schedule` | Protected + Org | None | Create cron schedule; registers repeatable job in BullMQ scheduler queue. |
| `PUT` | `/api/workflow/:id/schedule` | Protected + Org | None | Update cron schedule expression, timezone, or default input. |
| `DELETE`| `/api/workflow/:id/schedule` | Protected + Org | None | Remove cron schedule and remove repeatable job from BullMQ. |
| `PATCH` | `/api/workflow/:id/schedule/toggle` | Protected + Org | None | Toggle schedule active status (`enabled: true/false`). |
| **Webhooks** | | | | |
| `GET` | `/api/workflow/:id/webhook` | Protected + Org | None | Get webhook configuration and token for workflow. |
| `POST` | `/api/workflow/:id/webhook` | Protected + Org | None | Create inbound webhook trigger for workflow. |
| `PATCH` | `/api/workflow/:id/webhook/toggle` | Protected + Org | None | Toggle webhook status (`enabled: true/false`). |
| `POST` | `/api/workflow/:id/webhook/regenerate` | Protected + Org | None | Invalidate old token and issue new cryptographic 24-byte hex token. |
| `DELETE`| `/api/workflow/:id/webhook` | Protected + Org | None | Delete webhook configuration. |
| `POST` | `/api/webhooks/trigger/:token` | Public (Token Auth) | 100 req / min | Inbound webhook trigger; starts run with request payload. |
| **Organizations** | | | | |
| `GET` | `/api/organizations` | Protected | None | List all organizations the authenticated user belongs to. |
| `POST` | `/api/organizations` | Protected | None | Create new organization workspace; creator becomes `OWNER`. |
| `GET` | `/api/organizations/:id` | Protected | None | Get organization workspace details and member list. |
| `PATCH` | `/api/organizations/:id` | Protected (Owner/Admin)| None | Update organization name or slug. |
| `DELETE`| `/api/organizations/:id` | Protected (Owner only) | None | Delete organization and cascade delete all memberships. |
| `POST` | `/api/organizations/:id/members` | Protected (Owner/Admin)| None | Invite/add member by email with specified `OrgRole`. |
| `PATCH` | `/api/organizations/:id/members/:userId`| Protected (Owner/Admin)| None | Update member role (`ADMIN`, `MEMBER`). Prohibits changing owner. |
| `DELETE`| `/api/organizations/:id/members/:userId`| Protected (Owner/Admin)| None | Remove member from organization workspace. |
| **Agents** | | | | |
| `GET` | `/api/agents` | Protected | None | List all registered agents, status (`ONLINE`/`OFFLINE`), and metrics. |
| `GET` | `/api/agents/:id` | Protected | None | Get single agent telemetry and execution stats. |
| `POST` | `/api/agents/test` | Protected | 20 req / min | Dry-run execute an isolated agent configuration without creating a run. |
| **Dashboard** | | | | |
| `GET` | `/api/dashboard/stats` | Protected + Org | None | Aggregated metrics: total workflows, total runs, success rate, active agents. |
| `GET` | `/api/dashboard/recent-runs` | Protected + Org | None | List 5 most recent runs with duration in seconds, status, and task count. |
| **Notifications** | | | | |
| `GET` | `/api/notifications` | Protected | None | List notifications for authenticated user (workspace invites, alerts). |
| `PATCH` | `/api/notifications/:id/read` | Protected | None | Mark single notification as read. |
| `POST` | `/api/notifications/read-all` | Protected | None | Mark all notifications as read for current user. |
| `DELETE`| `/api/notifications/:id` | Protected | None | Delete notification record. |

---

## 7. Visual Workflow Builder

### 7.1 Canvas & Graph Interaction
The builder interface is implemented in [`client/app/(builder)/workflows/new/page.tsx`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/app/%28builder%29/workflows/new/page.tsx) and [`client/app/(builder)/workflows/[id]/edit/page.tsx`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/app/%28builder%29/workflows/[id]/edit/page.tsx) using React Flow (`@xyflow/react`):
- **Node Palette**: Drag-and-drop agent templates onto the canvas.
- **Interactive Edges**: Custom `RemovableEdge` with an inline delete button on hover. Supports reconnecting existing edge handles (`reconnectEdge`).
- **MiniMap & Controls**: Interactive zoom, pan, and visual minimap.

### 7.2 Dagre Automated Hierarchical Layout
Users can click **Auto Layout** in `BuilderTopbar.tsx`. The utility [`client/lib/utils/auto-layout.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/lib/utils/auto-layout.ts) initializes `@dagrejs/dagre`:
- Sets direction `TB` (top-to-bottom) with node separation `nodesep: 50`, rank separation `ranksep: 80`.
- Inserts each node with fixed dimensions (`NODE_WIDTH = 280`, `NODE_HEIGHT = 140`).
- Inserts edges into the Dagre graph and runs `dagre.layout()`.
- Re-anchors node positions from Dagre's center coordinates to React Flow's top-left coordinates:
  ```typescript
  x: nodeWithPosition.x - NODE_WIDTH / 2,
  y: nodeWithPosition.y - NODE_HEIGHT / 2,
  ```

### 7.3 Undo / Redo State Machine
Implemented in [`client/hooks/use-canvas-history.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/hooks/use-canvas-history.ts):
- Maintains dual stacks: `past: HistorySnapshot[]` and `future: HistorySnapshot[]`.
- Bounded to 30 history states to prevent browser memory leaks.
- Captures snapshots on node addition, edge connection, or drag-end.
- Keyboard bindings: `Ctrl+Z` / `Cmd+Z` for undo; `Ctrl+Y` / `Cmd+Y` / `Cmd+Shift+Z` for redo.

### 7.4 Client & Server DAG Validation
Before saving or triggering execution, the graph is validated on both client (`client/lib/utils/workflow-validator.ts`) and server (`server/utils/dag-validator.ts`):
1. **Non-Empty Check**: Graph must contain $\ge 1$ node.
2. **Duplicate Node Check**: Node IDs must be unique.
3. **Topological Sort & Cycle Detection (Kahn's Algorithm)**:
   - Calculates in-degree for every node.
   - Enqueues nodes with in-degree 0 (root tasks).
   - Iteratively removes nodes and decrements neighbor in-degrees.
   - If total visited nodes $\ne$ graph node count, throws `ValidationError: Workflow graph contains a cycle`.
4. **Self-Loop Check**: Immediate rejection if `edge.source === edge.target`.

### 7.5 Workflow Definition JSON Export & Import
Implemented in [`client/components/workflows/builder/BuilderTopbar.tsx`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/components/workflows/builder/BuilderTopbar.tsx):
- **JSON Export**: Serializes the active workflow title, description, and React Flow graph definition (`{ nodes, edges }`) into a downloadable JSON file, enabling offline version control, backups, and pipeline sharing across environments.
- **JSON Import**: Uploads a local JSON file using browser `FileReader`, parses the payload, validates structural integrity (`definition.nodes` must be a valid array), and dynamically hydrates the canvas nodes, edges, and configuration parameters.

### 7.6 In-Situ Isolated Dry-Run Node Testing
Implemented in [`client/components/workflows/builder/NodeConfigPanel.tsx`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/components/workflows/builder/NodeConfigPanel.tsx):
- The node configuration slide-over drawer features a dedicated **"Test Step"** tab (`activeTab: "params" | "test"`).
- Operators can specify custom mock JSON input (`testInput`) and trigger an isolated dry-run execution (`POST /api/agents/test`) directly from the canvas without saving the workflow or creating a full `WorkflowRun` database record.
- Displays execution status, latency, and returned data directly inside the drawer to accelerate prompt engineering and API payload verification.

---

## 8. Workflow Execution Engine & Lifecycle

```mermaid
sequenceDiagram
    participant Client as Browser / Trigger
    participant Orch as Orchestrator
    participant DB as PostgreSQL
    participant Queue as BullMQ Queue
    participant Worker as Agent Worker
    participant Bus as RunEmitter
    participant SSE as SSE Stream

    Client->>Orch: triggerRun(workflowId, input)
    Orch->>Orch: validateWorkflowGraph(nodes, edges)
    Orch->>DB: INSERT INTO workflow_runs (status: RUNNING)
    Orch->>DB: INSERT INTO tasks (status: PENDING) for each node
    Orch->>DB: UPDATE tasks SET dependsOn = [parentTaskIds]
    
    rect rgb(20, 30, 45)
        Note over Orch,Queue: Root Task Dispatch
        Orch->>DB: UPDATE root task (status: RUNNING, input)
        Orch->>Queue: addTaskToQueue(type, name, payload, { jobId: taskId })
        Orch->>Bus: emit("run:id", { TASK_RUNNING })
    end

    Bus->>SSE: Push live SSE event
    SSE-->>Client: Node status updates to RUNNING

    rect rgb(30, 40, 25)
        Note over Queue,Worker: Background Execution
        Queue->>Worker: Process Job (concurrency: 1)
        Worker->>Worker: execute(input, config)
        Worker->>DB: UPDATE tasks (status: COMPLETED, output)
        Worker->>DB: UPDATE agents (tasksHandled + 1, lastSeenAt)
    end

    Worker-->>Queue: Job completed
    Queue->>Orch: QueueEvents "completed" event

    rect rgb(25, 30, 45)
        Note over Orch,DB: Fan-In & Downstream Dispatch
        Orch->>Bus: emit("run:id", { TASK_COMPLETED, output })
        Orch->>DB: SELECT unblocked tasks (all dependsOn COMPLETED)
        Orch->>DB: Atomic Claim: UPDATE task WHERE id = taskId AND status = PENDING (status: RUNNING)
        alt Claim Succeeded (count == 1)
            Orch->>Queue: addTaskToQueue(childTask)
            Orch->>Bus: emit("run:id", { TASK_RUNNING })
        else Claim Skipped (count == 0)
            Note over Orch: Another concurrent parent completion already claimed this task
        end
    end

    rect rgb(35, 25, 30)
        Note over Orch,DB: Completion Invariant
        Orch->>DB: Check if all tasks terminal
        Orch->>DB: Atomic Completion: UPDATE workflow_runs WHERE id = runId AND status = RUNNING (status: COMPLETED)
        Orch->>Bus: emit("run:id", { RUN_COMPLETED })
    end

    Bus->>SSE: Push live RUN_COMPLETED
    SSE-->>Client: Workflow Execution Succeeded badge
```

### 8.1 Step-by-Step Execution Lifecycle
1. **Trigger & Validation**:
   - `triggerRun(workflowId, input, userId)` validates graph acyclicity and non-emptiness.
   - Creates a `WorkflowRun` row with `status: RUNNING`.
2. **Task State Initialization**:
   - Inserts a `Task` row for every node with `status: PENDING`.
   - Populates `dependsOn` arrays with the generated `taskId`s of immediate parent nodes.
3. **Root Task Dispatch**:
   - Finds nodes with `dependsOn.length === 0`.
   - Enqueues jobs into BullMQ with `jobId: task.id` and marks tasks `RUNNING`.
4. **Worker Processing**:
   - The appropriate `BaseAgent` worker picks up the job.
   - Increments agent `tasksHandled` count and marks `lastSeenAt: now()`.
   - Writes task `output` and sets `status: COMPLETED` in database.
5. **Fan-In Dependency Resolution**:
   - When a task completes, the orchestrator identifies child tasks where **all** IDs in `dependsOn` are marked `COMPLETED`.
   - **Data Aggregation**: The orchestrator merges outputs from all parents:
     ```typescript
     taskInput[parent.name] = parent.output;
     ```
     If parent output is an object, its root keys are merged into `taskInput`.
6. **Atomic Concurrency Protection**:
   - When a node has multiple parents (fan-in), each parent's completion independently checks if the child is unblocked.
   - To prevent double-dispatch, the orchestrator executes an **atomic claim query**:
     ```typescript
     const claim = await prisma.task.updateMany({
       where: { id: task.id, status: TaskStatus.PENDING },
       data: { status: TaskStatus.RUNNING, startedAt: new Date(), input: taskInput },
     });
     if (claim.count === 0) continue; // Concurrently claimed by sibling parent
     ```
   - **Compensation Rollback**: If `JobQueue.addTaskToQueue` fails after claiming, a rollback reverts the task status to `PENDING` with `startedAt: null` so it is not orphaned.
7. **Critical vs Non-Critical Failure**:
   - If a task fails all BullMQ retry attempts:
     - **`critical: true`**: The orchestrator immediately marks `WorkflowRun.status = FAILED`, cancels all remaining `PENDING` tasks (`status = CANCELLED`), and emits `RUN_FAILED`.
     - **`critical: false`**: The orchestrator marks the task `FAILED`, passes `{ error: reason }` to downstream dependencies, and allows execution to proceed.
8. **Terminal State Invariants**:
   - When all tasks reach a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`), the orchestrator performs an atomic completion update:
     ```typescript
     await prisma.workflowRun.updateMany({
       where: { id: runId, status: RunStatus.RUNNING },
       data: { status: RunStatus.COMPLETED, completedAt: new Date() },
     });
     ```
   - If the run was previously marked `CANCELLED` or `FAILED`, this update affects 0 rows, guaranteeing terminal states are immutable.

---

## 9. Agents / Workers

### 9.1 Active Production Worker Implementations

| Agent Type | Class | BullMQ Queue | Concurrency | External APIs | Purpose & Behavior |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`LLM_AGENT`** | `LLMAgent` | `LLM_AGENT` | 1 | Groq Cloud API | Prompt-based AI reasoning. Interpolates `{{placeholders}}` from incoming task input into `config.promptTemplate`. Calls Groq chat completions (default `openai/gpt-oss-120b`, bounded `maxTokens` 1–4096, temperature 0.0–1.0). Returns `{ text: result }`. |
| **`HTTP_AGENT`** | `HttpAgent` | `HTTP_AGENT` | 1 | External Web APIs | Outbound HTTP integrations (`GET`, `POST`, `PUT`, `DELETE`). Performs full SSRF validation on URL and redirect hops. Enforces 500ms–60s timeouts and a **5MB streaming response body ceiling**. |
| **`TRANSFORM_AGENT`**| `TransformAgent` | `TRANSFORM_AGENT` | 1 | Groq Cloud API | Structured JSON transformation. Takes raw input data and `config.description`, constructs a zero-temperature LLM prompt, strips markdown fences, parses JSON, and returns clean structured objects directly. |

### 9.2 Reserved / Stubbed Schemas
The following agent types are defined in `prisma/schema.prisma` and have dedicated BullMQ queues initialized in `server/queues/index.ts`, but do not have separate worker classes registered in `server/agents/registry.ts`:
- **`EXTRACTION_AGENT`**: Reserved for document/webpage text and entity extraction.
- **`NOTIFICATION_AGENT`**: Reserved for email/Slack webhook messaging.
- **`STORAGE_AGENT`**: Reserved for S3/blob artifact persistence.

### 9.3 BaseAgent Worker Lifecycle & Heartbeat Engine
Implemented in [`server/agents/base.agent.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/agents/base.agent.ts):
- **Worker Registration & Heartbeat**: On startup, each agent process upserts its record in the `agents` table as `status: ONLINE`. A persistent 30-second heartbeat timer (`setInterval`) repeatedly touches `lastSeenAt: new Date()` to notify the system of worker liveness.
- **Execution State Machine**:
  1. **Job Start**: Worker marks the database task as `status: RUNNING`, increments `attempts`, and transitions its own agent status to `BUSY`.
  2. **Cache Invalidation**: On every status transition (`ONLINE` $\rightarrow$ `BUSY` $\rightarrow$ `ONLINE`), the worker invalidates the Redis agent registry cache (`agents:all`).
  3. **Success**: Writes output payload, marks task `COMPLETED`, transitions agent status back to `ONLINE`, and increments `tasksHandled`.
  4. **Retry Handling**: If an attempt fails and retries remain, the task remains `RUNNING` with an informational message: `Attempt X failed: ... Retrying with backoff...`.
  5. **Final Failure**: Only when `job.attemptsMade + 1 >= maxAttempts` is the task marked `FAILED` in the database, agent status reset to `ONLINE`, and `tasksFailed` incremented.
- **Graceful Shutdown**: On SIGINT/SIGTERM, clears the heartbeat interval, closes BullMQ queue listeners, and marks the agent `OFFLINE` in PostgreSQL.

### 9.4 Payload Interpolation & Dot-Notation Engine
Implemented in [`server/utils/templates.utils.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/templates.utils.ts):
- **Dot-Notation Path Traversal**: Resolves deep nested properties across upstream task outputs (e.g. `{{HTTP_AGENT_1.data.users.0.email}}` or `{{parentTask.response}}`).
- **Full Payload Dumps**: Supports special placeholder tokens `{{input}}`, `{{raw}}`, and `{{_}}` to dump the entire input object serialized as JSON.
- **Output Compatibility**: Automatically falls back to inspecting `obj.data` if upstream HTTP nodes wrap payloads in `{ data: ... }`.

---

## 10. Distributed Queues & Asynchronous Processing

### 10.1 BullMQ Queue Topography
Initialized in [`server/queues/index.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/queues/index.ts):
```typescript
export const queues: Record<AgentType, Queue> = {
  [AgentType.LLM_AGENT]: new Queue("LLM_AGENT", { connection: redis }),
  [AgentType.HTTP_AGENT]: new Queue("HTTP_AGENT", { connection: redis }),
  [AgentType.TRANSFORM_AGENT]: new Queue("TRANSFORM_AGENT", { connection: redis }),
  [AgentType.EXTRACTION_AGENT]: new Queue("EXTRACTION_AGENT", { connection: redis }),
  [AgentType.NOTIFICATION_AGENT]: new Queue("NOTIFICATION_AGENT", { connection: redis }),
  [AgentType.STORAGE_AGENT]: new Queue("STORAGE_AGENT", { connection: redis }),
};
```

### 10.2 Queue Configuration & Reliability Parameters
- **Retry Strategy**: Default 3 attempts (`job.opts.attempts = 3`).
- **Exponential Backoff**: Configured with exponential backoff strategy (`delay: 1000ms`, doubling on each failure) to protect against transient network blips.
- **Task Deduplication**: Jobs are enqueued with `jobId: task.id`. Redis rejects duplicate job insertions if the same task ID is pushed concurrently.
- **Job Retention**: Completed jobs trimmed after 50 records; failed jobs trimmed after 100 records to prevent unbounded Redis memory expansion.
- **Connection Configuration**: Built on `ioredis` with `maxRetriesPerRequest: null` (strict requirement for BullMQ blocking commands) and automatic reconnection logic.

---

## 11. Scheduler

Implemented in [`server/api/scheduler/scheduler.service.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/scheduler/scheduler.service.ts) and [`server/api/scheduler/scheduler.worker.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/scheduler/scheduler.worker.ts):
- **Cron Engine**: Uses BullMQ repeatable jobs (`queue.add(name, data, { repeat: { pattern: cronExpression, tz: timezone } })`).
- **Database Tracking**: Stored in `workflow_schedules` with fields for `cronExpression`, `timezone`, `input`, and `enabled`.
- **Execution Guard**: When a cron trigger fires, `SchedulerWorker` queries the database to verify `schedule.enabled === true` before calling `orchestrator.triggerRun()`.
- **Cleanup Invariant**: When a workflow is deleted via `WorkflowService.deleteWorkflow`, `schedulerService.removeRepeatableJob(workflowId)` is automatically called to prevent orphaned cron jobs from firing in Redis.

---

## 12. Webhooks

Implemented in [`server/api/webhook/webhook.service.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/webhook/webhook.service.ts):
- **Token Generation**: Cryptographically secure 24-byte hex tokens (`crypto.randomBytes(24).toString("hex")`).
- **Token Regeneration**: Users can invalidate exposed tokens in 1 click; the server replaces the token in PostgreSQL.
- **Public Inbound Trigger**: `POST /api/webhooks/trigger/:token`
  - Completely unauthenticated at the HTTP level; authenticated purely by token possession.
  - Rate limited to **100 requests per minute per token** in Redis (`rl:webhook:trigger:<token>`).
  - Verifies `webhook.enabled === true`.
  - Triggers asynchronous run execution, passing the incoming JSON body as the workflow's root input.
  - Updates `lastCalledAt` timestamp in database.

---

## 13. Real-Time Execution Monitoring (Server-Sent Events)

### 13.1 SSE Connection Architecture
Implemented in [`server/api/run/run.sse.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/run/run.sse.ts):
- **Endpoint**: `GET /api/runs/:runId/stream`
- **Dual Authentication**: Accepts JWT via `Authorization: Bearer <token>` or query parameter `?token=<jwt>` (standard browser `EventSource` API cannot set custom request headers).
- **Access Verification**: Checks if the authenticated user owns the workflow run or is an active member of the workflow's parent organization. Rejects with 403 if unauthorized.
- **HTTP Streaming Headers**:
  ```http
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive
  X-Accel-Buffering: no
  ```
- **Connection Keep-Alive**: Dispatches a 15-second heartbeat comment (`: heartbeat\n\n`) to prevent intermediate proxies, firewalls, and cloud load balancers from terminating idle HTTP connections.

### 13.2 Event Lifecycle
Backed by Node.js `EventEmitter` (`runEmitter` in [`server/events/run.emitter.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/events/run.emitter.ts)):
1. `TASK_RUNNING`: Emitted when an agent picks up a task from the queue.
2. `TASK_COMPLETED`: Emitted when an agent completes with output payload.
3. `TASK_FAILED`: Emitted when a task fails attempts.
4. `RUN_COMPLETED`: Emitted when all tasks reach successful terminal state.
5. `RUN_FAILED`: Emitted if a critical step fails.
6. `RUN_CANCELLED`: Emitted when an operator cancels an active execution.

---

## 14. Caching and Redis

Redis serves **4 distinct architectural functions** in Orqestr:

| Function | Key Pattern | TTL | Invalidation Trigger | Purpose |
| :--- | :--- | :---: | :--- | :--- |
| **Workflow Cache** | `user:<userId>:workflow:<id>`<br/>`org:<orgId>:workflow:<id>` | 300s (5m) | Update, delete, or run trigger | Eliminates PostgreSQL reads during repeated canvas navigation and runs. |
| **Workflow List** | `user:<userId>:workflows:all`<br/>`org:<orgId>:workflows:all` | 300s (5m) | Create, delete, or archive workflow | Caches overview workflow cards. |
| **Dashboard Stats**| `user:<userId>:dashboard:stats`<br/>`org:<orgId>:dashboard:stats` | 60s (1m) | Run completion, workflow creation/deletion | Accelerates dashboard metrics loading. |
| **Recent Runs** | `user:<userId>:dashboard:recent_runs` | 60s (1m) | Run state transition | Accelerates dashboard activity feed. |
| **Agent Registry** | `agents:all` | 600s (10m) | Agent online/offline/busy state change | Caches worker telemetry. |
| **Rate Limiters** | `rl:<scope>:<identifier>` | 60s (1m) | Sliding window expiration | Protects against brute force and resource exhaustion. |
| **OAuth CSRF State**| `oauth:state:<state>` | 300s (5m) | Single-use deletion on callback | Prevents OAuth CSRF interception. |
| **OAuth Exchange** | `oauth:exchange:<exchangeCode>` | 60s (1m) | Single-use deletion on exchange | Eliminates JWTs in redirect URLs. |
| **Job Queues** | `bull:<AgentType>:*` | Managed | Job completion retention rules | BullMQ queue state, locks, and task payloads. |

---

## 15. Security Architecture & Threat Matrix

| Threat / Attack Vector | Implemented Defense | Implementation Location | Consequence If Absent |
| :--- | :--- | :--- | :--- |
| **Server-Side Request Forgery (SSRF)** | DNS pre-resolution via `dns.promises.lookup`; validation against IPv4 loopback (`127.0.0.0/8`), private VPC (`10/8`, `172.16/12`, `192.168/16`), Carrier-Grade NAT (`100.64/10`), Link-Local (`169.254/16`), IPv6 loopback (`::1`, `fc00::/7`, `fe80::/10`), and cloud metadata (`169.254.169.254`). Validates every redirect hop manually. | [`server/utils/url-validator.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/url-validator.ts)<br/>[`server/agents/http.agent.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/agents/http.agent.ts) | Attacker could use HTTP agent to scan internal infrastructure, read AWS/GCP instance metadata, or steal cloud credentials. |
| **Credential Leakage in Logs** | Deep recursive log sanitizer scrubbing database URLs (`postgresql://user:***@host`), Redis URLs, Bearer tokens, standalone JWTs, Groq API keys (`gsk_...`), GitHub PATs (`ghp_...`), private keys, and query parameters (`?code=...`). | [`server/utils/log-sanitizer.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/log-sanitizer.ts)<br/>[`server/config/logger.config.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/config/logger.config.ts) | Plaintext database passwords, API tokens, and session JWTs leaked to log sinks (CloudWatch, Datadog, Docker stdout). |
| **OAuth Token URL Leakage** | Single-use ephemeral 32-byte exchange codes stored in Redis with 60s TTL. Client claims session via rate-limited POST endpoint. | [`server/api/auth/auth.controller.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/auth/auth.controller.ts#L170-L182) | Access tokens and refresh tokens leaked in browser history, proxy server access logs, and HTTP Referer headers. |
| **OAuth CSRF Attack** | Cryptographic 32-byte state tokens generated and bound in Redis with 300s TTL; atomically verified and deleted on callback. | [`server/api/auth/auth.controller.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/auth/auth.controller.ts#L125-L165) | Attacker could trick victim into binding attacker's OAuth identity to victim's account. |
| **Denial of Service / Memory Exhaustion** | 5MB response body ceiling on HTTP agent using `Content-Length` inspection and streaming byte-counter chunk consumption. | [`server/agents/http.agent.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/agents/http.agent.ts#L123-L160) | Malicious external server could stream gigabyte-sized payloads or infinite streams, crashing the backend worker via out-of-memory. |
| **Tenant Boundary Crossing** | `org.middleware.ts` enforces active organization membership; queries include composite `(organizationId, userId)` filters. | [`server/middleware/org.middleware.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/middleware/org.middleware.ts)<br/>[`server/api/workflow/workflow.service.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/workflow/workflow.service.ts#L80) | User could forge `x-organization-id` header to view, modify, or execute workflows belonging to another enterprise tenant. |
| **SQL Injection** | Strict use of Prisma ORM parameterized queries across all database operations. | Entire repository | Malicious inputs could alter SQL statements to exfiltrate database contents. |
| **Brute Force & Flooding** | Redis sliding window rate limiters on login (10/min), register (5/min), agent testing (20/min), and webhook triggers (100/min). | [`server/middleware/rate-limiter.middleware.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/middleware/rate-limiter.middleware.ts) | Attackers could brute-force user passwords or flood LLM inference agents to drain API quotas. |

---

## 16. Error Handling and Edge Cases

### 16.1 Handled Failure Scenarios

| Scenario | System Behavior | Verifiable In Code |
| :--- | :--- | :--- |
| **Cyclic Workflow Graph** | Caught immediately by Kahn's algorithm in `dag-validator.ts`. Rejects before creating run or updating workflow with 400 `ValidationError`. | `server/utils/dag-validator.ts` |
| **Graph with Self-Loops (`A -> A`)** | Rejects with explicit message: `Node "X" has a circular self-dependency`. | `server/utils/dag-validator.ts#L34` |
| **Graph with No Root Nodes** | Detected when `inDegree === 0` list is empty. Rejects with 400 `ValidationError`. | `server/utils/dag-validator.ts#L50` |
| **Transient Agent Network Failure** | BullMQ automatically catches worker exceptions and schedules retry with exponential backoff up to `maxAttempts`. | `server/agents/base.agent.ts#L205` |
| **Critical Task Exhausts Retries** | Orchestrator marks `WorkflowRun.status = FAILED`, cancels all remaining `PENDING` tasks, and broadcasts `RUN_FAILED` via SSE. | `server/orchestrator/index.ts#L573` |
| **Non-Critical Task Failure** | Orchestrator marks task `FAILED`, passes `{ error: reason }` to downstream dependencies, and continues workflow execution. | `server/orchestrator/index.ts#L611` |
| **Parallel Task Fan-In Race** | Atomic database update (`prisma.task.updateMany({ where: { status: PENDING } })`) guarantees only one parent claims and dispatches child. | `server/orchestrator/index.ts#L235` |
| **Redis Crash During Dispatch** | Compensation rollback reverts task state from `RUNNING` back to `PENDING` if `JobQueue.addTaskToQueue` throws. | `server/orchestrator/index.ts#L273` |
| **Operator Cancels Running Workflow** | API executes an atomic `prisma.$transaction` updating `WorkflowRun` to `CANCELLED` and batch updating all `PENDING` tasks to `CANCELLED`. Orchestrator drops any late-arriving completions for cancelled runs. | `server/api/run/run.repository.ts#L74`<br/>`server/orchestrator/index.ts#L464` |
| **Abandoned / Stale Run** | Background reaper interval runs every 5m; marks runs older than 10m with no active tasks as `FAILED`. | `server/orchestrator/index.ts#L89` |
| **Workflow Deleted with Active Cron & Webhooks** | `WorkflowService.deleteWorkflow` hard-deletes active schedules and webhooks, cleans up the BullMQ repeatable job, and performs a soft-delete (`isArchived: true`) to preserve historical run FKs. | `server/api/workflow/workflow.repository.ts#L71`<br/>`server/api/workflow/workflow.service.ts#L257` |
| **Expired Access Token on Client** | Axios interceptor queues failing requests, calls `/api/auth/refresh`, updates access token, and retries queued requests. | `client/lib/api.ts#L55-L85` |
| **User Revoked from Organization** | Client interceptor catches 403 `FORBIDDEN_ORGANIZATION`, clears stored `currentOrganizationId`, and resets UI state. | `client/lib/api.ts#L43-L53` |

### 16.2 Explicitly Unhandled Edge Cases & Current Limitations
1. **Multi-Instance Orchestrator Pub/Sub Synchronization**: `runEmitter` is an in-memory Node.js `EventEmitter`. If the backend API horizontally scales to multiple container instances, clients connected to Instance A will not receive SSE events emitted by workers reporting to Instance B unless Redis Pub/Sub is wired to bridge emitters.
2. **Distributed Queue Pausing on Cancellation**: When a run is cancelled, pending database tasks are marked `CANCELLED`, but BullMQ jobs already picked up by workers run to completion (though the orchestrator drops their outputs).
3. **Database Transaction Rollback on Process Crash**: The DAG initialization inserts tasks in loops rather than a single atomic multi-table transaction.

---

## 17. Frontend Architecture

### 17.1 Next.js 16 Structure & Key Routes
- **`(builder)` Layout Group**: Dedicated fullscreen layout without navigation chrome for canvas workspaces:
  - `workflows/new`: New workflow builder with drag-and-drop palette.
  - `workflows/[id]/edit`: Workflow editor with auto-layout, undo/redo, and JSON import/export.
  - `runs/[runId]`: Live execution telemetry canvas with real-time SSE node state badges.
- **`(dashboard)` Layout Group**: Standard dashboard layout with sidebar navigation, tenant workspace selector, and notification bell:
  - `dashboard`: Key metric stat cards and recent execution activity table.
  - `workflows`: Workflow list with search, organization filtering, and duplication.
  - `workflows/[id]`: Workflow details page with sub-tabs (Overview, Runs, Schedule, Webhook, Versions).
  - `runs`: Historical execution runs table with status badges and duration metrics.
  - `agents`: Live agent worker registry monitoring health, status, and execution stats.
- **`auth` Routes**:
  - `login` & `register`: Form validation with Sonner toast feedback and OAuth buttons.
  - `callback`: Ephemeral OAuth code exchange page with loading spinners.

### 17.2 State Management & Client Data Flow
- **Server State**: Managed via **TanStack React Query (`@tanstack/react-query`)**. Configured with automated query invalidation upon mutations (e.g., creating a workflow invalidates `['workflows']`).
- **Authentication State**: Managed via `AuthProvider` React Context ([`client/providers/auth-provider.tsx`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/providers/auth-provider.tsx)). Syncs `accessToken` and user payload with `localStorage`.
- **Tenant Context**: Active organization ID stored in `localStorage` (`currentOrganizationId`) and automatically injected into all outbound requests by Axios interceptors.

---

## 18. End-to-End User Journeys

### Journey 1: Visual Workflow Construction & Execution
1. User logs in, navigates to `/workflows/new`, and enters a workflow title.
2. Drags an **HTTP Agent** and an **LLM Agent** onto the React Flow canvas.
3. Connects the output handle of the HTTP node to the input handle of the LLM node.
4. Configures HTTP node: URL `https://api.github.com/repos/nikhil-87/orqestr`, method `GET`.
5. Configures LLM node: prompt template `Analyze this repository: {{HTTP_AGENT_1.description}}`.
6. Clicks **Auto Layout (Dagre)** to clean up alignment.
7. Clicks **Save & Run**:
   - Client validates DAG acyclicity.
   - Backend persists `WorkflowDefinition` and creates a `WorkflowRun`.
   - Client redirects to `/runs/[runId]`.
   - Browser opens SSE stream; nodes illuminate in real time (`PENDING` $\rightarrow$ `RUNNING` $\rightarrow$ `COMPLETED`).
   - Output drawer reveals intermediate HTTP response and final synthesized LLM output.

### Journey 2: Automated Schedule Triggering
1. User opens workflow details page `/workflows/[id]`, clicks the **Schedule** tab.
2. Selects cron expression `0 9 * * 1-5` (Every weekday at 9:00 AM), sets timezone to `America/New_York`.
3. Clicks **Save Schedule**.
4. Backend persists schedule to PostgreSQL and registers a repeatable job in BullMQ's scheduler queue.
5. On the scheduled interval, `SchedulerWorker` triggers the orchestrator without human intervention.
6. Execution appears in the workflow runs history.

---

## 19. Deployment & Production Setup

| Component | Platform / Host | Verification Status | Configuration Details |
| :--- | :--- | :---: | :--- |
| **Frontend** | **Vercel** | ✅ Live (`https://orqestr-client.vercel.app`) | Next.js 16 with Turbopack; Root directory set to `client`; Environment variable `NEXT_PUBLIC_API_URL` pointing to Render API. |
| **Backend API & Workers** | **Render** | ✅ Live (`https://orqestr-api.onrender.com`) | Multi-stage Docker deployment (`Dockerfile`); internal port `8000`; runs schema push and Express server with BullMQ workers. |
| **Database** | **Neon.tech** | ✅ Live | Serverless PostgreSQL with connection pooling (`ep-damp-band-ayclxa1q-pooler.c-5.us-east-2.aws.neon.tech`). |
| **Queue & Cache** | **Redis Cloud** | ✅ Live | 30MB hosted Redis instance (`woolen-evolved-dawnlike-37088.db.redis.io:10970`). |
| **Keep-Alive Bot** | **UptimeRobot** | ✅ Active | 10-minute HTTP ping to `/health` endpoint with a 1-click pause switch to conserve energy during off-duty periods. |

---

## 20. Automated Testing Strategy

The repository maintains an automated test suite executed via **Vitest**. All tests execute in clean environments with database mocking and isolated Redis configurations.

### Verified Test Counts (Active Codebase Verification)
```
Server Tests: 30 test files passed (30/30) | 262 tests passed (262/262) | Duration: ~35s
Client Tests: 14 test files passed (14/14) | 111 tests passed (111/111) | Duration: ~84s
Total Automated Tests: 44 test files passed (44/44) | 373 tests passed (373/373)
```

### Key Test Suites & Coverage Areas
1. **Orchestrator Concurrency & Security (`concurrency-and-security.test.ts`)**:
   - Verifies parallel run overwrite guards (ensuring completed tasks cannot overwrite a cancelled or failed run).
   - Verifies fan-in atomic claiming and deduplication.
   - Verifies compensation rollbacks on queue failures.
2. **SSRF Protection (`url-validator.test.ts`)**:
   - Tests blocking of all private IPv4/IPv6 ranges, loopback addresses, carrier-grade NAT, and cloud metadata IPs (`169.254.169.254`).
3. **Log Sanitization (`logger-sanitizer.test.ts`)**:
   - Verifies deep object scrubbing and regex masking of credentials, tokens, and database connection strings.
4. **OAuth Exchange Security (`oauth.test.ts`)**:
   - Tests CSRF state verification, single-use exchange code generation, TTL expiration, and rate limiting.
5. **DAG Validation (`dag-validator.test.ts`)**:
   - Tests Kahn's algorithm cycle detection, self-loops, disconnected subgraphs, and empty definitions.
6. **Rate Limiting (`rate-limiter.test.ts`)**:
   - Tests sliding window counters in Redis and standard HTTP 429 response contracts.

---

## 21. Performance and Scalability

### 21.1 Current Built-in Scalability Mechanisms
1. **Asynchronous Decoupling**: API handlers return `200 OK` in $< 50\text{ms}$ upon queue insertion; long-running LLM inference and HTTP calls are handled entirely by background workers.
2. **Connection Pooling**: Neon connection pooling handles concurrent database connections without exhausting PostgreSQL process limits.
3. **Cache-Aside Reads**: Workflows, dashboard statistics, and agent registries are cached in Redis with short TTLs (60s–300s), reducing database read pressure.
4. **Resource Ceilings**: 5MB HTTP body limits, bounded LLM token generation, and bounded canvas undo stacks protect server and browser memory.

### 21.2 Realistic Future Evolution Path (Scale-Out Architecture)

```
                       ┌─────────────────────────┐
                       │ Cloudflare / AWS CloudFront│ (Edge Caching & DDoS Protection)
                       └────────────┬────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │     HAProxy / Nginx     │ (Round-Robin SSL Termination)
                       └────────────┬────────────┘
                                    │
                ┌───────────────────┴───────────────────┐
                ▼                                       ▼
    ┌───────────────────────┐               ┌───────────────────────┐
    │  Express API Node 1   │               │  Express API Node 2   │ (Horizontal Stateless API)
    └───────────┬───────────┘               └───────────┬───────────┘
                │                                       │
                ├───────────────────┬───────────────────┤
                │                   │                   │
                ▼                   ▼                   ▼
    ┌───────────────────────┐ ┌───────────┐ ┌───────────────────────┐
    │  Redis Primary/Replica│ │ Redis     │ │ PostgreSQL Cluster    │
    │  (BullMQ Queues)      │ │ Pub/Sub   │ │ (Primary + Read Reps) │
    └───────────┬───────────┘ └─────┬─────┘ └───────────────────────┘
                │                   │
    ┌───────────┴───────────┐       │ (SSE Event Broadcast)
    ▼                       ▼       │
┌──────────────┐     ┌──────────────┤
│ LLM Workers  │     │ HTTP Workers │
│ (Auto-scale) │     │ (Auto-scale) │
└──────────────┘     └──────────────┘
```

1. **Horizontal API Scaling**:
   - Make API nodes fully stateless.
   - **Tradeoff**: In-memory `runEmitter` must be replaced with **Redis Pub/Sub** to broadcast execution events across all API instances so SSE streams receive events regardless of which node handles the client connection.
2. **Worker Pool Partitioning**:
   - Split worker processes by queue: run dedicated LLM worker containers separate from I/O-bound HTTP workers.
   - **Tradeoff**: Increases deployment complexity, but allows independent autoscaling based on queue depth (e.g., scale LLM workers on GPU/high-concurrency nodes).
3. **Database Read Replicas**:
   - Route dashboard queries and workflow listing reads to PostgreSQL read replicas; reserve primary for transactional execution writes.
   - **Tradeoff**: Introduces replication lag considerations.

---

## 22. Architectural Decisions & Tradeoffs Matrix

| Architectural Decision | Alternative Considered | Why Chosen for Orqestr | Engineering Tradeoff |
| :--- | :--- | :--- | :--- |
| **PostgreSQL + Prisma ORM** | MongoDB / DynamoDB | Workflows, runs, tasks, schedules, and organizations have strict relational integrity and foreign key constraints. | Schema changes require migrations; slightly more rigid than schema-less document stores. |
| **BullMQ on Redis** | Kafka / RabbitMQ | BullMQ provides native job state machines, parent-child job orchestration, repeatable cron triggers, and delay queues with minimal operational overhead. | Redis stores queue state in RAM, requiring careful memory trimming rules (`removeOnComplete`). |
| **Server-Sent Events (SSE)** | WebSockets | Workflow execution telemetry is unidirectional (server pushes state to client). SSE operates natively over standard HTTP/HTTPS, auto-reconnects, and avoids WebSocket framing overhead. | Unidirectional only; client cannot send messages upstream over the same connection. |
| **Decoupled Next.js + Express** | Monolithic Next.js API Routes | Next.js serverless functions have strict execution timeouts (10–60s) incompatible with persistent BullMQ queue workers and long-lived SSE streams. | Requires maintaining two separate deployment pipelines and handling cross-origin cookies. |
| **Dagre Layout Engine** | Elkjs / Manual Positioning | Dagre is lightweight, runs client-side in browser memory, and provides deterministic top-to-bottom hierarchical layout without backend API roundtrips. | Less flexible than full constraint-based layout engines for non-standard graph topologies. |

---

## 23. Deep-Dive Engineering Challenges Solved

### Challenge 1: Fan-In Race Conditions & Double-Dispatch
- **Problem**: When node C depends on both node A and node B, nodes A and B may complete concurrently on separate worker threads. Both workers check if node C is ready. Without synchronization, both workers see C as unblocked and dispatch it twice.
- **Implementation**: Solved using a database-level **atomic claim pattern**:
  ```typescript
  const claimResult = await this.prisma.task.updateMany({
    where: { id: task.id, status: TaskStatus.PENDING },
    data: { status: TaskStatus.RUNNING, startedAt: new Date(), input: taskInput },
  });
  if (claimResult.count === 0) continue; // Sibling worker already claimed it
  ```
- **Tradeoff**: Requires an extra database write before queue insertion, but guarantees strict once-and-only-once execution semantics across distributed nodes.

### Challenge 2: SSRF in User-Configured HTTP Nodes
- **Problem**: Allowing users to configure arbitrary HTTP request nodes exposes internal services (e.g., Redis on `localhost:6379`, cloud metadata at `169.254.169.254`). Attackers can also use DNS rebinding or redirect chains (`attacker.com` $\rightarrow$ `169.254.169.254`).
- **Implementation**: 
  - Resolves hostnames to IP addresses via `dns.promises.lookup` before connection.
  - Validates resolved IP against comprehensive private/reserved subnet lists.
  - Disables automatic redirects (`redirect: "manual"`), validating the destination IP on **every single redirect hop**.
- **Tradeoff**: Pre-connection DNS resolution adds ~10–20ms of latency per outbound request, but completely eliminates SSRF vulnerabilities.

---

## 24. Resume-Ready Technical Facts

The following facts are directly verifiable from the codebase and provide concrete evidence for technical resume bullets:

### Distributed Systems & Backend
- **Fact**: Engineered an asynchronous DAG workflow execution engine executing multi-agent pipelines with dynamic topological dependency resolution.
  - *Evidence*: [`server/orchestrator/index.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/orchestrator/index.ts), [`server/utils/dag-validator.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/dag-validator.ts).
  - *Technical Detail*: Implemented Kahn's algorithm for cycle detection, atomic database task claiming (`updateMany`), and multi-parent output aggregation (fan-in).
  - *Safe Resume Wording*: "Architected a distributed DAG workflow execution engine using TypeScript and BullMQ, orchestrating multi-agent pipelines with automated topological dependency resolution."

- **Fact**: Eliminated double-dispatch race conditions during concurrent task resolution.
  - *Evidence*: `server/orchestrator/index.ts#L235-L280`.
  - *Technical Detail*: Combined atomic SQL conditional claims with BullMQ job deduplication (`jobId: task.id`) and automated compensation rollbacks.
  - *Safe Resume Wording*: "Designed an atomic state machine in PostgreSQL and Redis that eliminated race conditions and double-dispatch during concurrent multi-parent task resolution."

### Security & Authentication
- **Fact**: Implemented enterprise-grade SSRF protection for arbitrary outbound HTTP requests.
  - *Evidence*: [`server/utils/url-validator.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/url-validator.ts), [`server/agents/http.agent.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/agents/http.agent.ts).
  - *Technical Detail*: Pre-resolves DNS to validate against private RFC 1918, loopback, carrier-grade NAT, and cloud metadata IPs across all redirect hops with a 5MB streaming body ceiling.
  - *Safe Resume Wording*: "Engineered zero-trust SSRF protection for outbound HTTP requests, integrating DNS pre-resolution, IP range filtering, redirect validation, and a 5MB streaming response ceiling."

- **Fact**: Hardened OAuth 2.0 authentication against CSRF and token leakage.
  - *Evidence*: [`server/api/auth/auth.controller.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/auth/auth.controller.ts).
  - *Technical Detail*: Built 32-byte cryptographic state tokens with 300s TTL in Redis and ephemeral single-use exchange codes with 60s TTL to prevent token exposure in URL query parameters.
  - *Safe Resume Wording*: "Hardened OAuth 2.0 authentication flows by implementing single-use ephemeral exchange codes and Redis-backed state validation to eliminate token exposure in browser history."

### Frontend & Real-Time Telemetry
- **Fact**: Built an interactive visual DAG builder with automated layout and undo/redo state management.
  - *Evidence*: [`client/lib/utils/auto-layout.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/lib/utils/auto-layout.ts), [`client/hooks/use-canvas-history.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/hooks/use-canvas-history.ts).
  - *Technical Detail*: Integrated React Flow with `@dagrejs/dagre` for automated hierarchical layout and implemented a 30-snapshot undo/redo stack.
  - *Safe Resume Wording*: "Developed an interactive visual workflow builder in React 19 and React Flow, incorporating Dagre automated DAG layout and a 30-state undo/redo history stack."

- **Fact**: Implemented real-time execution monitoring via Server-Sent Events with automated client recovery.
  - *Evidence*: [`server/api/run/run.sse.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/api/run/run.sse.ts), [`client/lib/api.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/client/lib/api.ts).
  - *Technical Detail*: Built an SSE stream with dual authentication, organization authorization, 15-second heartbeat intervals, and Axios token refresh queues.
  - *Safe Resume Wording*: "Implemented real-time execution telemetry streaming via Server-Sent Events, featuring proxy-resilient heartbeats and automatic client token refresh recovery."

---

## 25. Resume Claim Guardrails

To prevent future AI tools or resume generators from manufacturing false claims, the following boundaries must be strictly respected:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 RESUME CLAIM GUARDRAILS                                     │
├────────────────────────────────┬────────────────────────────────────────────────────────────┤
│ CATEGORY                       │ EXAMPLES & INSTRUCTIONS                                    │
├────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ ✅ VERIFIED / SAFE TO CLAIM    │ - Distributed DAG execution engine using BullMQ & Redis    │
│ (Fully implemented in code,    │ - SSRF protection via DNS pre-resolution & IP filtering    │
│ backed by 373 passing tests)   │ - Single-use ephemeral OAuth exchange codes                │
│                                │ - Dagre auto-layout & 30-state canvas undo/redo            │
│                                │ - Multi-tenant RBAC (OWNER, ADMIN, MEMBER)                 │
│                                │ - Real-time SSE streaming with proxy heartbeat             │
│                                │ - Active production agents: LLM, HTTP, Transform           │
│                                │ - Docker multi-stage container deployment                  │
├────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ ⚠️ PARTIALLY IMPLEMENTED       │ - EXTRACTION_AGENT, NOTIFICATION_AGENT, STORAGE_AGENT:     │
│ (Schemas/queues exist, but     │   Exist in Prisma enum and BullMQ queue definitions,       │
│ workers not instantiated)      │   but concrete worker classes are NOT in registry.ts.      │
│                                │   DO NOT claim these agents are active in production.      │
├────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ ❌ FUTURE / PROPOSED           │ - Redis Pub/Sub multi-instance SSE broadcasting            │
│ (Documented in design docs,    │ - Kafka / RabbitMQ integration                             │
│ but NOT implemented in code)   │ - Multi-region database sharding / read replicas           │
│                                │ - Kubernetes autoscaling / Helm charts                     │
│                                │   DO NOT claim these exist in the current implementation.  │
├────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ 🚫 UNVERIFIABLE / PROHIBITED   │ - Specific user counts (e.g. "used by 10,000 users")       │
│ (Cannot be verified from repo) │ - Specific transaction dollar amounts                      │
│                                │ - "Zero downtime" claims                                   │
└────────────────────────────────┴────────────────────────────────────────────────────────────┘
```

---

## 26. Source-of-Truth Rules & Verification Metadata

1. **Active Repository Snapshot**:
   - **Repository Root**: `c:\Users\nikhil\Desktop\projectss\ai-orchestor\Orqestr`
   - **Commit Hash**: `85ac7cdc90ae7ad18d0236cdde1b0162986e4d34`
   - **Working Tree**: Clean (`main` branch)
2. **Rule of Code Supremacy**:
   - If any older document, audit log, or previous conversation contradicts this document or the active codebase, the active codebase and this document represent the true state.
3. **Automated Verification**:
   - Backend test harness: 30 test files, 262 passed tests (`vitest run`).
   - Frontend test harness: 14 test files, 111 passed tests (`vitest run`).
   - Production Docker build: Verified passing on Render and local container engines.
