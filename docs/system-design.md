# Orqestr — System Design Document

This document provides an in-depth architectural breakdown of **Orqestr**, an asynchronous, distributed multi-agent workflow orchestration platform. It covers everything from high-level problem motivation and domain modeling to execution mechanics, fault tolerance, security, and scalability trade-offs.

---

## 1. Problem Statement & Motivation

### The Problem
Building multi-step AI pipelines (e.g. *Scrape API $\rightarrow$ Analyze with LLM $\rightarrow$ Extract structured JSON $\rightarrow$ Store in Database $\rightarrow$ Send Alert*) using traditional synchronous HTTP calls introduces critical architectural flaws:
1. **Cascading Failure & Fragility**: If step 3 of a 5-step pipeline times out or hits an API rate limit, a synchronous request fails entirely, wasting the compute and tokens spent on steps 1 and 2.
2. **High & Unpredictable Latency**: Chaining multiple LLM inferences and external network requests can easily take 10 to 60+ seconds, exceeding standard HTTP gateway timeouts (e.g., Cloudflare 100s, AWS ALB 60s, Nginx 30s).
3. **No Execution Visibility**: The client is blocked waiting for an HTTP response, with zero visibility into which intermediate step is currently executing or where a bottleneck occurred.
4. **Lack of Concurrency**: Independent branches of a pipeline that could run in parallel are often forced into slow sequential execution because coordinating asynchronous threads in a single HTTP request is difficult to manage.

### The Solution: Orqestr Architecture
Orqestr solves these challenges by treating workflows as **Directed Acyclic Graphs (DAGs)** executed by **stateless, distributed agent workers** over **persistent Redis queues**:
* **Immediate Non-Blocking Ingestion**: Triggering a workflow creates an execution record and immediately returns a `200 OK` with a `runId` (< 50ms).
* **Asynchronous Queue-Backed Workers**: Tasks are pushed to isolated BullMQ queues. Independent workers consume tasks, execute external calls, and retry with exponential backoff if transient errors occur.
* **Topological Graph Progression**: The orchestrator evaluates graph dependencies upon each task completion, automatically fanning out parallel branches and unblocking downstream tasks.
* **Live Observability**: Server-Sent Events (SSE) stream incremental state changes to the browser in real time without polling the database.

---

## 2. Requirements & System Invariants

To establish a clear system design interview baseline, requirements are categorized into **Current Implemented Functional Requirements**, **Current Non-Functional Guarantees & Invariants**, and **Future Scale-Out Goals**.

### 2.1 Current Implemented Functional Requirements
1. **User Authentication & Session Lifecycle**:
   - Local authentication (bcrypt password hashing with salt rounds = 10).
   - Dual-token session management: 15-minute stateless JWT access tokens + 7-day database-backed refresh tokens stored in `httpOnly` cookies with cross-port development fallback.
   - OAuth 2.0 (Google & GitHub) with 32-byte cryptographic state parameters in Redis (300s TTL) for CSRF defense, and single-use 32-byte exchange codes (60s TTL) via `POST /api/auth/oauth/exchange` to eliminate tokens from URLs and browser history.
   - Database-backed token revocation on logout.
2. **Multi-Tenant Workspaces & RBAC**:
   - Support for collaborative organizations with distinct slug identifiers.
   - 3-tier Role-Based Access Control: `OWNER`, `ADMIN`, `MEMBER`.
   - In-app workspace invitations and real-time alerts via dedicated `Notification` model.
   - Header-driven workspace context (`x-organization-id`) with personal workspace fallback.
3. **Visual DAG Workflow Builder**:
   - Visual graph canvas built with React Flow (`@xyflow/react`) supporting custom node types, drag-and-drop palette, mini-maps, pan/zoom, and keyboard controls.
   - Topological auto-layout using Dagre algorithm.
   - Canvas state history stack with undo/redo capabilities.
   - Workflow portability with JSON import and export.
   - Unauthenticated draft preservation via local storage and in-context modal authentication.
4. **Node Testing Sandbox (`POST /api/agents/test`)**:
   - Direct execution testing of individual agent nodes with mock input payloads before workflow persistence.
   - Rate limited to 20 requests/minute, authenticated, and protected by SSRF validation.
5. **DAG Validation & Topological Integrity**:
   - Kahn's algorithm topological sorting validates graphs on creation, update, and run trigger.
   - Enforces non-empty node arrays, absence of self-loops, and strict acyclicity.
   - Server-side rejection of unsupported agent types before entering task queues.
6. **Asynchronous DAG-Based Workflow Execution**:
   - Immediate asynchronous ingestion: trigger requests return `200 OK` with execution `runId` in < 50ms.
   - Automatic dependency resolution: root nodes (0 incoming edges) dispatch concurrently to BullMQ queues.
   - Dynamic prompt and payload interpolation using template syntax (`{{input}}`, `{{stepName.output}}`).
   - Fan-in multi-parent output merging: downstream nodes receive combined dictionary of parent outputs with task-name namespacing.
7. **Heterogeneous Agent Workers**:
   - **LLM Agent**: Groq LPU inference using OpenAI-compatible chat completion formats (`openai/gpt-oss-120b`, `qwen/qwen3.6-27b`).
   - **HTTP Agent**: External REST calls with SSRF validation (blocking RFC 1918, loopback, cloud metadata), DNS pre-resolution, redirect loop prevention (5 hops max), 30s timeout, and a strict 5MB payload limit.
   - **Transform Agent**: Structured data transformation and JSON extraction via LLM.
   - Worker liveness tracked via 30-second heartbeat intervals.
8. **Fault Tolerance & Granular Failure Boundaries**:
   - Intermediate task retries with exponential backoff (1s $\rightarrow$ 2s $\rightarrow$ 4s, default 3 attempts).
   - Tasks remain in `RUNNING` status during retries to prevent premature pipeline failures.
   - Per-node critical flags: critical failure terminates the workflow run; non-critical failure passes `{ error: reason }` downstream to continue pipeline execution.
9. **Interactive Run Cancellation (`POST /api/runs/:id/cancel`)**:
   - Atomically transitions `WorkflowRun` and all pending tasks to `CANCELLED` in a PostgreSQL transaction.
   - Emits `RUN_CANCELLED` over SSE and drops subsequent in-flight worker completions.
10. **Live Real-Time Monitoring via SSE**:
    - Unidirectional event streaming via `GET /api/runs/:runId/stream` pushing task status, timestamps, and input/output payloads.
    - Protected by JWT authentication and run/organization ownership verification.
11. **Automated Scheduling & Webhooks**:
    - Cron scheduling via BullMQ repeatable jobs with automatic cleanup from Redis when workflows are deleted.
    - Webhook triggers protected by 48-character high-entropy cryptographic hex tokens ($2^{192}$ keyspace) and sliding-window rate limiting.
12. **Workflow Versioning & Duplication**:
    - Immutable `WorkflowVersion` snapshots recorded on every graph update.
    - Historical version inspection and one-click rollback (`POST /api/workflow/:id/versions/:version/restore`).
    - Workflow cloning via `POST /api/workflow/:id/duplicate`.

### 2.2 Current Non-Functional Guarantees & Invariants
1. **Tenant Isolation**: Row-level query scoping (`organizationId` / `userId`) enforced at the repository layer. Cache keys isolated by tenant prefix (`org:${id}:*` vs `user:${id}:*`).
2. **At-Least-Once Delivery**: Redis locks with TTL renewal ensure that if a worker crashes mid-task, the job is returned to the queue for reassignment after lock expiration.
3. **No Duplicate Dispatch on Converging Branches**: Multi-parent fan-in uses atomic conditional database claiming (`prisma.task.updateMany({ where: { id, status: PENDING }, data: { status: RUNNING } })`) and BullMQ `{ jobId: task.id }` deduplication to guarantee downstream tasks are not dispatched multiple times.
4. **Terminal Status Immutability**: Late worker completions on parallel branches cannot overwrite a `FAILED` or `CANCELLED` workflow run to `COMPLETED`.
5. **Observability & Log Sanitization**: Centralized redaction engine ([`log-sanitizer.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/log-sanitizer.ts)) scrubs credentials, Redis URLs, Bearer tokens, and keys from logs. All requests traced with `x-request-id`.
6. **Graceful Cache Degradation**: Cache errors (Redis outages) fail silently and fall back directly to PostgreSQL queries without crashing API endpoints.

### 2.3 Future Scale-Out Architecture Goals (Design Targets)
*(Note: These represent architectural evolution targets for high-scale enterprise deployments, distinguished from the currently running single-process architecture).*
1. **High Availability (99.99%)**: Zero single-point-of-failure via multi-AZ PostgreSQL primary/replicas and Redis Cluster across 3 shards with replicas.
2. **Distributed Multi-Orchestrator Locks**: Redis distributed locking (`SET run:${id}:lock NX EX 10`) across clustered orchestrator nodes.
3. **Horizontally Auto-Scaled Worker Pools**: Dedicated worker containers auto-scaling independently based on BullMQ queue depth and external provider rate limits.
4. **Distributed SSE Fan-Out**: Redis Pub/Sub backplane broadcasting run events across a fleet of stateless API instances.
5. **Distributed Tracing**: OpenTelemetry instrumentation with trace propagation across HTTP, BullMQ jobs, and database queries.

---

## 3. Core Domain Model & Entity Relationships

The system is modeled in PostgreSQL via Prisma with a strict distinction between **Static Blueprint Definitions** and **Dynamic Runtime Executions**.

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
    USER ||--o{ NOTIFICATION : "userId (Cascade)"
    USER ||--o{ WORKFLOW_RUN : "userId"

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

### 3.1 Database Schema Specification

Below is the complete entity dictionary derived directly from `server/prisma/schema.prisma`:

#### 1. `users` Table (`User` Model)
Represents registered users in the platform. Supports both standard email/password authentication and OAuth (Google, GitHub).

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `email` | `String` | **UK** | No | — | Unique user email address |
| `password` | `String` | — | **Yes** | — | Bcrypt hashed password (null for OAuth-only users) |
| `name` | `String` | — | No | — | User display name |
| `googleId` | `String` | **UK** | **Yes** | — | Unique Google OAuth identifier |
| `githubId` | `String` | **UK** | **Yes** | — | Unique GitHub OAuth identifier |
| `createdAt` | `DateTime` | — | No | `now()` | Account creation timestamp |

#### 2. `refresh_tokens` Table (`RefreshToken` Model)
Stores long-lived (7-day) JWT refresh tokens for silent session renewal.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `token` | `String` | **UK** | No | — | Cryptographically random refresh token |
| `userId` | `String` | **FK** | No | — | References `users(id)` with `onDelete: Cascade` |
| `expiresAt` | `DateTime` | — | No | — | Expiration timestamp |
| `createdAt` | `DateTime` | — | No | `now()` | Issuance timestamp |

#### 3. `organizations` Table (`Organization` Model)
Workspaces for multi-tenant collaboration and shared workflow ownership.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `name` | `String` | — | No | — | Organization display name |
| `slug` | `String` | **UK** | No | — | URL-friendly unique identifier |
| `createdAt` | `DateTime` | — | No | `now()` | Creation timestamp |
| `updatedAt` | `DateTime` | — | No | `@updatedAt` | Auto-updated modification timestamp |

#### 4. `organization_members` Table (`OrganizationMember` Model)
Join table establishing the many-to-many relationship between `User` and `Organization` with role assignments.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `organizationId`| `String` | **FK** | No | — | References `organizations(id)` with `onDelete: Cascade` |
| `userId` | `String` | **FK** | No | — | References `users(id)` with `onDelete: Cascade` |
| `role` | `OrgRole` | Enum | No | `MEMBER` | Role hierarchy: `OWNER`, `ADMIN`, `MEMBER` |
| `createdAt` | `DateTime` | — | No | `now()` | Membership creation timestamp |

* **Unique Index**: `@@unique([organizationId, userId])` — guarantees a user can hold at most one membership role per organization.

#### 5. `workflow_definitions` Table (`WorkflowDefinition` Model)
Stores the canvas graph blueprint (nodes, edges, configurations).

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `name` | `String` | — | No | — | Workflow title |
| `description` | `String` | — | **Yes** | — | Optional workflow summary |
| `definition` | `Json` | — | No | — | Canvas DAG graph `{ nodes: [...], edges: [...] }` |
| `version` | `Int` | — | No | `1` | Incrementing version number |
| `userId` | `String` | **FK** | **Yes** | — | Creator `users(id)` (nullable for org-owned workflows) |
| `organizationId`| `String` | **FK** | **Yes** | — | Owner `organizations(id)` (nullable for personal workflows) |
| `isArchived` | `Boolean` | — | No | `false` | Soft-delete flag (archived workflows are hidden and inactive) |
| `createdAt` | `DateTime` | — | No | `now()` | Creation timestamp |
| `updatedAt` | `DateTime` | — | No | `@updatedAt` | Auto-updated timestamp |

* **Indexes**: `@@index([userId])`, `@@index([organizationId])`, `@@index([isArchived])` — optimizes workspace filtering and soft-deletion queries.

#### 6. `workflow_versions` Table (`WorkflowVersion` Model)
Immutable snapshots created on every workflow update for audit history and one-click rollbacks.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `workflowId` | `String` | **FK** | No | — | References `workflow_definitions(id)` with `onDelete: Cascade` |
| `version` | `Int` | — | No | — | Historical version counter |
| `name` | `String` | — | No | — | Snapshot workflow name |
| `description` | `String` | — | **Yes** | — | Snapshot description |
| `definition` | `Json` | — | No | — | Snapshot DAG graph |
| `createdAt` | `DateTime` | — | No | `now()` | Snapshot creation timestamp |

* **Unique Index**: `@@unique([workflowId, version])` — guarantees unique sequential version snapshots per workflow.

#### 7. `workflow_schedules` Table (`WorkflowSchedule` Model)
Cron configuration for distributed background execution.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `workflowId` | `String` | **FK, UK** | No | — | References `workflow_definitions(id)` (Cascade, Unique 1-to-1) |
| `userId` | `String` | **FK** | No | — | Creator `users(id)` |
| `cronExpression`| `String` | — | No | — | Standard 5-part cron string (e.g. `0 9 * * *`) |
| `timezone` | `String` | — | No | `UTC` | Target timezone for cron triggers |
| `input` | `Json` | — | No | `{}` | Default JSON input passed to scheduled runs |
| `enabled` | `Boolean` | — | No | `true` | Active/paused toggle |
| `lastRunAt` | `DateTime` | — | **Yes** | — | Timestamp of most recent execution |
| `nextRunAt` | `DateTime` | — | **Yes** | — | Timestamp of next upcoming trigger |
| `createdAt` | `DateTime` | — | No | `now()` | Schedule creation timestamp |
| `updatedAt` | `DateTime` | — | No | `@updatedAt` | Auto-updated timestamp |

#### 8. `webhooks` Table (`Webhook` Model)
Inbound trigger endpoints protected by high-entropy secret tokens.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `workflowId` | `String` | **FK, UK** | No | — | References `workflow_definitions(id)` (Cascade, Unique 1-to-1) |
| `userId` | `String` | **FK** | No | — | Creator `users(id)` |
| `token` | `String` | **UK** | No | `cuid()` | 48-character cryptographic trigger secret |
| `enabled` | `Boolean` | — | No | `true` | Active/paused toggle |
| `lastCalledAt` | `DateTime` | — | **Yes** | — | Timestamp of most recent external call |
| `createdAt` | `DateTime` | — | No | `now()` | Webhook creation timestamp |

#### 9. `workflow_runs` Table (`WorkflowRun` Model)
An immutable execution instance of a workflow definition.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `workflowId` | `String` | **FK** | No | — | References `workflow_definitions(id)` |
| `userId` | `String` | **FK** | **Yes** | — | Triggering `users(id)` (null for public webhooks) |
| `status` | `RunStatus` | Enum | No | `PENDING` | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `input` | `Json` | — | No | — | Top-level input payload passed to the run |
| `output` | `Json` | — | **Yes** | — | Aggregated final output JSON |
| `error` | `String` | — | **Yes** | — | Top-level error message if run failed |
| `startedAt` | `DateTime` | — | No | `now()` | Execution start timestamp |
| `completedAt` | `DateTime` | — | **Yes** | — | Execution completion timestamp |

#### 10. `tasks` Table (`Task` Model)
Represents a discrete node execution step within a workflow run.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `runId` | `String` | **FK** | No | — | References `workflow_runs(id)` |
| `name` | `String` | — | No | — | Node display name |
| `type` | `AgentType` | Enum | No | — | Worker type: `LLM_AGENT`, `HTTP_AGENT`, `TRANSFORM_AGENT`, etc. |
| `status` | `TaskStatus`| Enum | No | `PENDING` | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `input` | `Json` | — | No | — | Resolved input payload passed to worker |
| `output` | `Json` | — | **Yes** | — | Output JSON returned by worker execution |
| `error` | `String` | — | **Yes** | — | Error message / stack trace if task failed |
| `attempts` | `Int` | — | No | `0` | Execution attempt counter |
| `maxAttempts` | `Int` | — | No | `3` | Maximum retry attempts before permanent failure |
| `dependsOn` | `Json` | — | No | `[]` | Array of parent `Task.id` strings |
| `critical` | `Boolean` | — | No | `true` | If true, task failure terminates the entire run |
| `nodeId` | `String` | — | **Yes** | — | Canvas node identifier (for frontend mapping) |
| `startedAt` | `DateTime` | — | **Yes** | — | Task execution start timestamp |
| `completedAt` | `DateTime` | — | **Yes** | — | Task execution completion timestamp |
| `createdAt` | `DateTime` | — | No | `now()` | Row creation timestamp |

#### 11. `agents` Table (`Agent` Model)
Worker registry tracking active agent processes and liveness heartbeats.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `name` | `String` | — | No | — | Worker instance name (e.g. `LLM_AGENT_1`) |
| `type` | `AgentType` | Enum | No | — | Agent type handled by this worker |
| `status` | `AgentStatus`| Enum | No | `OFFLINE` | `ONLINE`, `OFFLINE`, `BUSY` |
| `lastSeenAt` | `DateTime` | — | **Yes** | — | Heartbeat timestamp (updated every 30s) |
| `tasksHandled`| `Int` | — | No | `0` | Total tasks successfully processed |
| `tasksFailed` | `Int` | — | No | `0` | Total tasks failed |
| `createdAt` | `DateTime` | — | No | `now()` | Registration timestamp |

* **Unique Index**: `@@unique([name, type])` — prevents duplicate worker registrations for the same name and agent type.

#### 12. `notifications` Table (`Notification` Model)
Stores in-app notifications for workspace invitations, role updates, and system alerts.

| Column | Type | Constraints | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | **PK** | No | `cuid()` | Unique identifier |
| `userId` | `String` | **FK** | No | — | Recipient `users(id)` with `onDelete: Cascade` |
| `title` | `String` | — | No | — | Short alert headline |
| `message` | `String` | — | No | — | Detailed notification body |
| `type` | `String` | — | No | `WORKSPACE_INVITE` | Alert classification category |
| `organizationId`| `String` | — | **Yes** | — | Associated workspace ID if applicable |
| `metadata` | `Json` | — | **Yes** | — | Contextual payload (inviter name, role, etc.) |
| `isRead` | `Boolean` | — | No | `false` | Read / unread status toggle |
| `createdAt` | `DateTime` | — | No | `now()` | Notification delivery timestamp |

* **Indexes**: `@@index([userId, isRead])`, `@@index([userId, createdAt])` — enables instant unread badge counts and chronological notification feed paging.

---

### 3.2 Relationship Cardinality & Design Rationale

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   RELATIONSHIP SUMMARY                                      │
├──────────────────────────────────────┬─────────────┬────────────────────────────────────────┤
│ Entity Pair                          │ Cardinality │ Mechanism & Business Purpose           │
├──────────────────────────────────────┼─────────────┼────────────────────────────────────────┤
│ User ↔ Notification                  │ 1-to-Many   │ FK `userId` (Cascade). Delivers in-app │
│                                      │             │ workspace invitations and alerts.      │
│ User ↔ RefreshToken                  │ 1-to-Many   │ FK `userId` (Cascade). Supports        │
│                                      │             │ multi-device active sessions.          │
│ User ↔ Organization                  │ Many-to-Many│ Joined via `OrganizationMember` with   │
│                                      │             │ role payload (`OWNER`/`ADMIN`/`MEMBER`)│
│ User ↔ WorkflowDefinition            │ 1-to-Many   │ FK `userId`. Personal workflow ownership│
│ Organization ↔ WorkflowDefinition    │ 1-to-Many   │ FK `organizationId`. Shared workspace  │
│                                      │             │ team workflow ownership.               │
│ WorkflowDefinition ↔ WorkflowVersion │ 1-to-Many   │ FK `workflowId` (Cascade). Immutable   │
│                                      │             │ version snapshots for rollback.        │
│ WorkflowDefinition ↔ WorkflowSchedule│ 1-to-1      │ FK `workflowId` (Cascade + UNIQUE).    │
│                                      │             │ Max 1 active cron schedule per workflow│
│ WorkflowDefinition ↔ Webhook         │ 1-to-1      │ FK `workflowId` (Cascade + UNIQUE).    │
│                                      │             │ Dedicated trigger token per workflow.  │
│ WorkflowDefinition ↔ WorkflowRun     │ 1-to-Many   │ FK `workflowId`. Immutable point-in-   │
│                                      │             │ time execution instances.              │
│ WorkflowRun ↔ Task                   │ 1-to-Many   │ FK `runId`. Discrete node executions.  │
│ Task ↔ Task (Logical DAG)            │ Self-Ref DAG│ `dependsOn: JSON` (Array of task IDs). │
│                                      │             │ Coordinates topological unblocking.    │
└──────────────────────────────────────┴─────────────┴────────────────────────────────────────┘
```

#### Why `dependsOn` is a JSON Array instead of a SQL Join Table
* **Topological Filtering Performance**: When a task completes, the orchestrator evaluates all tasks in a single database query: `SELECT * FROM tasks WHERE runId = ?`.
* It constructs an in-memory `Set` of resolved IDs: `Set<string>`.
* Checking whether a pending task is unblocked becomes an in-memory $O(1)$ array check:
  `task.dependsOn.every(depId => resolvedSet.has(depId))`
* Using a normalized `task_dependencies` relational table would require $N$ additional SQL JOIN queries on every single task completion event, creating excessive database load during high-concurrency fan-out pipelines.

### 3.3 Domain Entity Lifecycles, Ownership & Deletion Semantics

Understanding entity lifecycles and ownership boundaries is fundamental to Orqestr's transactional integrity:

| Entity | Primary Ownership Boundary | Lifecycle & Persistence Strategy | Deletion Semantics | Indexing Strategy & Performance Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **`User`** | System root actor | Created upon registration or first OAuth callback. Persists indefinitely. | Hard delete cascades to `RefreshToken`, `OrganizationMember`, `Notification`, and personal `WorkflowDefinition`s. | Indexed by unique `email`, `googleId`, and `githubId`. |
| **`Organization`** | Multi-tenant boundary | Created by users; maintains slug uniqueness. Can be renamed or deleted by `OWNER`. | Hard delete cascades to `OrganizationMember`. Workflows belonging to the org are deleted with their versions and triggers. | Indexed by unique `slug`. |
| **`OrganizationMember`** | Org $\leftrightarrow$ User join | Created upon member invite or org creation. Stores active `OrgRole` (`OWNER`, `ADMIN`, `MEMBER`). | Cascade delete if either user or organization is deleted. Last owner cannot leave or be removed. | Compound unique `@@unique([organizationId, userId])` prevents duplicate memberships. |
| **`WorkflowDefinition`** | User (Personal) or Organization (Team) | Blueprint graph created via canvas builder. Version incremented on every update. | **Soft-Delete (`isArchived: true`)**: Retains historical execution records and version audit logs while hiding the workflow from queries and preventing execution. Explicitly removes repeatable BullMQ cron jobs from Redis. | Indexed by `[userId]`, `[organizationId]`, and `[isArchived]` for instant workspace list filtering. |
| **`WorkflowVersion`** | `WorkflowDefinition` | Immutable snapshot recorded on every `PUT /api/workflow/:id`. Captures `{ nodes, edges }` JSON at point in time. | Cascade delete if parent workflow definition is hard-deleted. | Compound unique `@@unique([workflowId, version])`. |
| **`WorkflowRun`** | `WorkflowDefinition` + Triggering User | Instantiated upon manual trigger, webhook call, or cron fire. Transitions through `PENDING` $\rightarrow$ `RUNNING` $\rightarrow$ `COMPLETED` / `FAILED` / `CANCELLED`. | Retained permanently as an immutable audit record of inputs, outputs, errors, and execution timings. | Indexed by `[workflowId]` and `[userId]`. |
| **`Task`** | `WorkflowRun` | Discrete node execution within a run. Stores attempts, node configuration, input/output JSON, and parent dependency IDs. | Cascade delete if parent run is deleted. | Indexed by `[runId]` and `[runId, status]` to accelerate the orchestrator's topological unblocking sweep. |
| **`WorkflowSchedule`** | `WorkflowDefinition` | 1-to-1 cron configuration. Manages BullMQ repeatable job registration and next run calculations. | Cascade delete on parent workflow. | Compound unique `[workflowId]` ensures at most one active schedule per workflow. |
| **`Webhook`** | `WorkflowDefinition` | 1-to-1 public ingress configuration. Stores high-entropy 48-char secret token ($2^{192}$ keyspace). | Cascade delete on parent workflow. | Unique index on `token` allows $O(1)$ constant-time token lookup on inbound trigger calls. |
| **`Notification`** | `User` | In-app notification delivery for workspace invitations and team alerts. | Cascade delete on `User`. | Indexed by `[userId, isRead]` for zero-overhead unread badge queries and `[userId, createdAt]` for chronological notification paging. |

---

## 4. Data Ownership & Storage Partitioning

```mermaid
graph LR
    subgraph POSTGRES["🗄️ PostgreSQL (System of Record)"]
        PG_USERS["Users & Organizations"]
        PG_WORKFLOWS["Workflow Definitions & Versions"]
        PG_RUNS["Workflow Runs & Tasks (Audit Trail)"]
        PG_AGENTS["Agent Worker Registry"]
        PG_TRIGGERS["Schedules & Webhook Tokens"]
    end

    subgraph REDIS["⚡ Redis (Ephemeral & Queuing)"]
        RD_QUEUES["BullMQ Job Queues & Locks"]
        RD_SCHEDULES["BullMQ Repeatable Sorted Sets"]
        RD_CACHE["Cache-Aside Dashboard & Workflows"]
        RD_PUBSUB["SSE Realtime Pub/Sub (Scale-Out)"]
    end

    style POSTGRES fill:#1a1a2e,stroke:#0f3460,color:#e0e0e0
    style REDIS fill:#533483,stroke:#e94560,color:#e0e0e0
```

| Data Type | Storage Engine | Reason for Choice | Consistency / Persistence Model |
| :--- | :--- | :--- | :--- |
| **Workflow Definitions & Blueprints** | PostgreSQL (`JSONB`) | Relational ownership, foreign keys to users/orgs, point-in-time versioning snapshots. | Strong ACID consistency. |
| **Task Execution History & Audit Logs** | PostgreSQL (`tasks`, `workflow_runs`) | Permanent audit trail of input payloads, output JSON, error messages, and execution duration. | Strong ACID consistency; relational cascade on workflow deletion. |
| **Active Job Queues & In-Flight State** | Redis (BullMQ data structures) | Microsecond-level atomic lock operations (`SET NX PX`), non-blocking list pops (`BLPOP`), delayed sets. | In-memory with optional RDB/AOF persistence. |
| **Recurring Schedules** | Redis (`bull:scheduler:repeat`) | BullMQ sorted sets calculate next execution timestamps natively across distributed replicas. | Synchronized from PostgreSQL on startup via `syncAllSchedules()`. |
| **Read Cache (Dashboard, Workflow Lists)** | Redis (`ioredis` via `CacheService`) | Protects database from repetitive dashboard polling (`refetchInterval: 30s`). | Cache-aside with TTL (60s–300s) and targeted write-invalidation. |

---

## 5. Architectural Component Deep Dive

For each core architectural component, we analyze the engineering rationale using four criteria:
1. *What problem does it solve?*
2. *Why is it needed here?*
3. *What would happen without it?*
4. *What trade-offs or new problems does it introduce?*

---

### 5.1 Asynchronous Job Queue (BullMQ on Redis)

```mermaid
graph LR
    API["API Gateway<br/>(POST /run)"] -->|"1. Fast Ack (200 OK)"| CLIENT["Browser Client"]
    API -->|"2. Enqueue Root Tasks"| BULLMQ["BullMQ Redis Queue"]
    BULLMQ -->|"3. Atomic Job Pop"| WORKER["Agent Worker"]
    WORKER -->|"4. Execute Task"| LLM["External LLM / API"]

    style API fill:#16213e,stroke:#0f3460,color:#e0e0e0
    style BULLMQ fill:#533483,stroke:#e94560,color:#e0e0e0
    style WORKER fill:#2d1b69,stroke:#e94560,color:#e0e0e0
```

* **What problem does it solve?**  
  Decouples the incoming HTTP trigger request from long-running, non-deterministic agent executions (LLM token generation, REST calls, schema transformations).
* **Why is it needed here?**  
  Multi-agent pipelines can take 30+ seconds. Running tasks synchronously in Express would block HTTP server threads, exhaust connection pools, and drop connections on gateway timeouts.
* **What would happen without it?**  
  API servers would run tasks in-memory using `Promise.all()`. If the server restarted, crashed, or ran out of memory, all in-flight workflow runs would silently disappear without a trace or retry mechanism.
* **Trade-offs & New Complexity:**  
  Requires running and maintaining Redis. Introduces eventual consistency (client receives `runId` before tasks start executing) and requires a real-time event mechanism (SSE) to push status updates back to the UI.

---

### 5.2 Orchestrator Engine (`Orchestrator`)

```mermaid
flowchart TD
    QE["QueueEvents Listener<br/>(Job Completed Signal)"] --> RESOLVE["Orchestrator.onTaskCompleted()"]
    RESOLVE --> EMIT["RunEmitter.emit('run:id', { TASK_COMPLETED })"]
    RESOLVE --> QUERY["Find all tasks for runId in PostgreSQL"]
    QUERY --> EVAL{"Are dependencies<br/>resolved for any<br/>PENDING task?"}
    EVAL -->|Yes| DISPATCH["Inject output as input<br/>JobQueue.addTaskToQueue()"]
    EVAL -->|No / All Done| CHECK_DONE{"Are all tasks<br/>resolved?"}
    DISPATCH --> EMIT_DISPATCH["RunEmitter.emit('run:id', { TASK_RUNNING })"]
    CHECK_DONE -->|Yes| COMPLETE_RUN["Mark WorkflowRun COMPLETED<br/>Invalidate Dashboard Cache<br/>RunEmitter.emit('run:id', { RUN_COMPLETED })"]

    style QE fill:#533483,stroke:#e94560,color:#e0e0e0
    style RESOLVE fill:#0f3460,stroke:#533483,color:#e0e0e0
    style DISPATCH fill:#065f46,stroke:#047857,color:#fff
    style COMPLETE_RUN fill:#065f46,stroke:#047857,color:#fff
```

* **What problem does it solve?**  
  Coordinates graph progression across disconnected agent workers without workers needing to know about each other or the overall pipeline structure.
* **Why is it needed here?**  
  Agent workers are pure, stateless task consumers (`execute(input, config) $\rightarrow$ output`). They do not know what the next step in the pipeline is. The Orchestrator acts as the centralized coordinator that listens to BullMQ `QueueEvents`, unblocks downstream tasks, and terminates the run.
* **What would happen without it?**  
  Workers would have to carry workflow metadata and dispatch the next tasks themselves (choreography). This tightly couples workers, creates circular dependencies, and makes dynamic branching or error handling difficult to manage.
* **Trade-offs & New Complexity:**  
  The Orchestrator is a critical coordination point. If the Orchestrator fails to process a `completed` event, the pipeline stalls. (Mitigated by the 5-minute `cleanupStaleRuns` background sweep).

---

### 5.3 Agent Worker Subsystem (`BaseAgent`)

* **What problem does it solve?**  
  Standardizes worker lifecycle management, queue consumption, error capture, database state updates, and liveness reporting across all agent types.
* **Why is it needed here?**  
  Implements the **Template Method Design Pattern**. Subclasses (`LLMAgent`, `HTTPAgent`, `TransformAgent`) only implement their specific execution logic:
  ```typescript
  abstract execute(input: unknown, config: unknown): Promise<unknown>;
  ```
  The base class automatically manages BullMQ worker listeners, database transactions (`status = RUNNING`, `attempts++`, `status = COMPLETED`), and 30-second heartbeat pings.
* **What would happen without it?**  
  Each new agent implementation would need to duplicate 100+ lines of boilerplate for database updates, try/catch blocks, error formatting, Redis connections, and heartbeat reporting. A bug in one worker's database update logic could break pipeline synchronization.
* **Trade-offs & New Complexity:**  
  Inheritance locks agent worker implementations into a class-based structure, which requires careful constructor dependency injection (`PrismaClient`).

---

### 5.4 Smart Template Interpolation Engine (`interpolateTemplate`)

```mermaid
flowchart LR
    INPUT["Upstream Output:<br/>{ data: { user: { name: 'Alice' } }, body: 'Feedback' }"] --> ENGINE["Interpolation Engine"]
    TEMPLATE["Prompt Template:<br/>Analyze {{user.name}}'s comment: {{body}}"] --> ENGINE
    ENGINE --> RESULT["Resolved Prompt:<br/>Analyze Alice's comment: Feedback"]

    style INPUT fill:#1a1a2e,stroke:#0f3460,color:#e0e0e0
    style ENGINE fill:#533483,stroke:#e94560,color:#e0e0e0
    style RESULT fill:#065f46,stroke:#047857,color:#fff
```

* **What problem does it solve?**  
  Enables seamless, dynamic data transfer between heterogeneous agent nodes producing varying JSON shapes.
* **Why is it needed here?**  
  An HTTP Agent outputs `{ data: { id: 1, body: "..." }, status: 200, headers: {...} }`. An LLM downstream needs to reference `{{body}}` or `{{user.name}}`. The engine provides a 4-tier resolution hierarchy:
  1. **Direct Property Lookup**: `input[key]`
  2. **Deep Dot-Notation Traversal**: Recursively navigates `user.address.city`
  3. **HTTP Wrapper Auto-Fallback**: Automatically unwraps `data.body` when writing `{{body}}`
  4. **Universal Serialization (`{{input}}`)**: Stringifies the complete JSON payload for raw LLM ingestion
* **What would happen without it?**  
  Users would have to manually insert custom JavaScript transform nodes between every single step in their workflow to reshape JSON keys, adding friction to workflow building.
* **Trade-offs & New Complexity:**  
  String interpolation requires regex matching (`/\{\{([^}]+)\}\}/g`). If upstream keys are missing, placeholders evaluate to empty strings `""`, which must be handled gracefully by prompt templates.

---

### 5.5 Real-Time Observability via Server-Sent Events (SSE)

* **What problem does it solve?**  
  Streams real-time execution status updates to the browser without overwhelming the database with polling queries.
* **Why is it needed here?**  
  Monitoring a live workflow execution requires instant visual feedback (node changes from gray $\rightarrow$ blue $\rightarrow$ green). SSE provides unidirectional server-to-client push over standard HTTP with native browser reconnection.
* **What would happen without it?**  
  The frontend would poll `GET /api/runs/:runId` every 1–2 seconds. With 100 active users watching executions, that creates 50–100 requests per second hitting PostgreSQL with heavy JOIN queries on `tasks`.
* **Trade-offs & New Complexity:**  
  *Current Implementation*: Uses a Node.js `EventEmitter` singleton (`RunEmitter`). This works within a single server instance, but in a multi-instance production cluster, it requires **Redis Pub/Sub** so events emitted on Instance A reach SSE sockets on Instance B.

---

### 5.6 In-Context Draft Persistence & Auth Modal

* **What problem does it solve?**  
  Prevents data loss when an unauthenticated user spends time designing a workflow graph and clicks "Save".
* **Why is it needed here?**  
  Standard web applications redirect unauthenticated users to `/login`, wiping out unsaved client state. Orqestr:
  1. Serializes the canvas graph into `localStorage` (`orqestr_draft_workflow`).
  2. Displays an in-place `AuthModal` overlay over the canvas (no route change).
  3. Upon login/register, automatically executes the pending `POST /api/workflow` API mutation with the active canvas state.
  4. Automatically restores the draft if the user refreshes or accidentally closes the tab.
* **What would happen without it?**  
  Users who build complex workflows before logging in would lose their work upon clicking save, creating a frustrating user experience.
* **Trade-offs & New Complexity:**  
  Requires client-side synchronization between `localStorage`, React state, and Axios mutation hooks.

---

## 6. End-to-End Workflow Execution Lifecycle

The following sequence diagram represents the complete execution path of a workflow:

```mermaid
sequenceDiagram
    participant User as User Browser
    participant API as Express API
    participant Orch as Orchestrator
    participant DB as PostgreSQL
    participant Queue as BullMQ (Redis)
    participant Worker as Agent Worker
    participant LLM as Groq API
    participant Bus as RunEmitter
    participant SSE as SSE Endpoint

    User->>API: POST /api/workflow/:id/run { input }
    API->>Orch: orchestrator.triggerRun(workflowId, input, userId)

    Note over Orch: Step 1: Initialize Execution
    Orch->>DB: Fetch WorkflowDefinition JSON
    Orch->>DB: INSERT WorkflowRun (status: RUNNING)
    Orch->>DB: INSERT Task rows (1 per node, status: PENDING)
    Orch->>DB: UPDATE Tasks with dependsOn IDs (Pass 2)

    Note over Orch: Step 2: Dispatch Root Nodes
    Orch->>DB: UPDATE Root Tasks (input = run.input)
    Orch->>Queue: addTaskToQueue(agentType, { taskId, input, config })
    Orch->>Bus: emit("run:id", { taskId, status: RUNNING })
    Bus->>SSE: push event
    SSE-->>User: Live Event: TASK_RUNNING

    API-->>User: 200 OK { runId, status: "RUNNING" }

    Note over Worker: Step 3: Worker Processes Task
    Queue->>Worker: Worker pops job (acquires Redis lock)
    Worker->>DB: UPDATE Task (status: RUNNING, attempts: 1)
    Worker->>DB: UPDATE Agent (status: BUSY)

    alt LLM Agent Execution
        Worker->>Worker: interpolateTemplate(prompt, input)
        Worker->>LLM: POST chat/completions
        LLM-->>Worker: Generated text response
    else HTTP Agent Execution
        Worker->>Worker: Validated HTTP REST request
    else Transform Agent Execution
        Worker->>LLM: POST chat/completions (JSON formatting instructions)
        LLM-->>Worker: Clean structured JSON
    end

    Worker->>DB: UPDATE Task (status: COMPLETED, output: JSON)
    Worker->>DB: UPDATE Agent (status: ONLINE, tasksHandled + 1)
    Worker->>Queue: Acknowledge job completion

    Note over Orch: Step 4: QueueEvents Catches Completion
    Queue->>Orch: QueueEvents "completed" listener fires (jobId)
    Orch->>Bus: emit("run:id", { taskId, status: COMPLETED, output })
    Bus->>SSE: push event
    SSE-->>User: Live Event: TASK_COMPLETED

    Note over Orch: Step 5: Resolve Downstream Tasks
    Orch->>DB: Query all tasks for runId
    Orch->>Orch: Filter tasks where all dependsOn IDs are COMPLETED
    Orch->>DB: UPDATE Downstream Tasks (input = completed.output)
    Orch->>Queue: Dispatch newly unblocked tasks
    Orch->>Bus: emit("run:id", { taskId, status: RUNNING })
    Bus->>SSE: push event
    SSE-->>User: Live Event: TASK_RUNNING

    Note over Orch: Step 6: Pipeline Completion
    Orch->>DB: All tasks COMPLETED -> UPDATE WorkflowRun (status: COMPLETED)
    Orch->>DB: Invalidate Dashboard Cache in Redis
    Orch->>Bus: emit("run:id", { type: RUN_COMPLETED })
    Bus->>SSE: push event
    SSE-->>User: Live Event: RUN_COMPLETED
```

### 6.2 Multi-Parent Fan-In Dependency Resolution Flow
When multiple upstream tasks converge on a single downstream task (e.g. Node B and Node C both feed into Node D):

```mermaid
sequenceDiagram
    participant WorkerB as Worker (Task B)
    participant WorkerC as Worker (Task C)
    participant QE as QueueEvents Listener
    participant Orch as Orchestrator
    participant DB as PostgreSQL
    participant Queue as BullMQ (Redis)

    WorkerB->>DB: UPDATE Task B (status: COMPLETED, output: { b: 1 })
    WorkerC->>DB: UPDATE Task C (status: COMPLETED, output: { c: 2 })

    par Concurrent Event Evaluation
        QE->>Orch: onTaskCompleted(Task B)
        Orch->>DB: SELECT * FROM tasks WHERE runId = ?
        Note over Orch: Sees Task B is COMPLETED, but Task C is RUNNING.<br/>Task D dependencies NOT fully satisfied. No-op.
    and
        QE->>Orch: onTaskCompleted(Task C)
        Orch->>DB: SELECT * FROM tasks WHERE runId = ?
        Note over Orch: Both Task B and Task C are COMPLETED!<br/>Task D dependencies fully satisfied!
        Orch->>DB: Atomic Claim: UPDATE Task D WHERE status = PENDING -> RUNNING
        alt Claim Succeeded (count === 1)
            Orch->>Orch: Merge inputs: { b: 1, c: 2, "Task B": { b: 1 }, "Task C": { c: 2 } }
            Orch->>Queue: addTaskToQueue(Task D, { jobId: taskD.id })
            Orch->>DB: Invalidate Dashboard Cache
        else Claim Skipped (count === 0)
            Note over Orch: Sibling parent tick already claimed and queued Task D. Skip.
        end
    end
```

### 6.3 Interactive Run Cancellation Flow
Users can abort in-flight workflow executions directly from the UI:

```mermaid
sequenceDiagram
    participant User as User Browser
    participant API as Express API
    participant DB as PostgreSQL
    participant Bus as RunEmitter
    participant SSE as SSE Endpoint
    participant Orch as Orchestrator

    User->>API: POST /api/runs/:runId/cancel
    API->>DB: Transaction: UPDATE WorkflowRun (status: CANCELLED)<br/>UPDATE tasks WHERE status = PENDING (status: CANCELLED)
    API->>Bus: emit("run:id", { type: RUN_CANCELLED })
    Bus->>SSE: Push RUN_CANCELLED event
    SSE-->>User: Live Event: RUN_CANCELLED (UI updates to Cancelled badge)
    API-->>User: 200 OK { success: true, status: "CANCELLED" }

    Note over Orch: In-flight worker jobs may complete,<br/>but Orchestrator terminal status guard drops completions<br/>when status is CANCELLED.<br/>Zero downstream tasks are dispatched.
```

### 6.4 Ephemeral OAuth 2.0 State & One-Time Code Exchange Flow

```mermaid
sequenceDiagram
    participant User as Browser
    participant API as Express Server
    participant Redis as Redis Cache
    participant Provider as Google / GitHub
    participant DB as PostgreSQL

    User->>API: GET /api/auth/google (or /github)
    API->>API: Generate 32-byte cryptographic state
    API->>Redis: SET oauth:state:{state} = "valid" (TTL: 300s)
    API-->>User: 302 Redirect to Provider with state

    User->>Provider: Consent & Authorize
    Provider-->>API: GET /api/auth/google/callback?code=...&state=...

    API->>Redis: GET & DEL oauth:state:{state} (Atomic validation & consumption)
    alt State invalid or missing
        API-->>User: 302 Redirect /auth/login?error=invalid_state
    else State valid
        API->>Provider: Exchange authorization code for profile
        API->>DB: Upsert User row
        API->>API: Generate 32-byte exchangeCode
        API->>Redis: SET oauth:exchange:{exchangeCode} = { userId } (TTL: 60s)
        API-->>User: 302 Redirect to /auth/callback?code={exchangeCode}
    end

    Note over User: Browser reads code from query string (Zero tokens in URL)
    User->>API: POST /api/auth/oauth/exchange { code } (Rate limited: 15 req/min)
    API->>Redis: GET & DEL oauth:exchange:{code}
    API->>DB: INSERT RefreshToken (7d) & Sign AccessToken (15m)
    API-->>User: 200 OK { accessToken, refreshToken, user }
```

### 6.5 Workflow Versioning & One-Click Rollback Flow

```mermaid
sequenceDiagram
    participant User as User Browser
    participant API as Express API
    participant DB as PostgreSQL

    Note over User: Workflow Edit & Snapshot
    User->>API: PUT /api/workflow/:id { definition }
    API->>DB: In Transaction:<br/>1. Fetch current definition & version (v1)<br/>2. INSERT WorkflowVersion (version: 1, definition: v1)<br/>3. UPDATE WorkflowDefinition (version: 2, definition: v2)
    API-->>User: 200 OK { workflow }

    Note over User: Inspection & Rollback
    User->>API: GET /api/workflow/:id/versions
    API->>DB: SELECT * FROM workflow_versions WHERE workflowId = ? ORDER BY version DESC
    API-->>User: 200 OK [ Version 1 ]

    User->>API: POST /api/workflow/:id/versions/1/restore
    API->>DB: In Transaction:<br/>1. INSERT WorkflowVersion (version: 2, definition: v2 snapshot)<br/>2. UPDATE WorkflowDefinition (version: 3, definition: v1 restored)
    API-->>User: 200 OK { workflow: version 3 restored }
```

---

## 7. Formal State Machines & Lifecycle Enforcements

### 7.1 `WorkflowRun` State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: Initial trigger record created
    PENDING --> RUNNING: First root tasks dispatched
    RUNNING --> COMPLETED: All tasks successfully resolved (or non-critical error)
    RUNNING --> FAILED: Any critical task exhausts retries
    RUNNING --> CANCELLED: Operator issues POST /api/runs/:id/cancel
    RUNNING --> FAILED: cleanupStaleRuns() timeout sweep (> 10m inactive)
    COMPLETED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

#### Transition Enforcement in Code:
* **Terminal Status Protection**: Once a run enters `COMPLETED`, `FAILED`, or `CANCELLED`, it is immutable. In `onTaskCompleted` and `onTaskFailed`, the orchestrator explicitly checks:
  ```typescript
  if (workflowRun.status === RunStatus.CANCELLED || workflowRun.status === RunStatus.FAILED) return;
  ```
* **Atomic Completion Transition**: The transition to `COMPLETED` is guarded by an atomic conditional SQL update:
  ```typescript
  await this.prisma.workflowRun.updateMany({
    where: { id: workflowRun.id, status: RunStatus.RUNNING },
    data: { status: RunStatus.COMPLETED },
  });
  ```
  If the run was concurrently cancelled or marked failed, `count === 0` and the completion update is safely discarded.

---

### 7.2 `Task` State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: Inserted on workflow trigger
    PENDING --> RUNNING: Claimed atomically by dispatchUnblockedTasks()
    RUNNING --> RUNNING: Attempt failed & attemptsMade < maxAttempts (Exponential Backoff)
    RUNNING --> COMPLETED: Agent worker returns successful output
    RUNNING --> FAILED: Agent worker error & attemptsMade >= maxAttempts
    PENDING --> CANCELLED: WorkflowRun cancelled by user or critical task failure
    COMPLETED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

#### Transition Enforcement in Code:
* **Atomic Claiming**: `PENDING` $\rightarrow$ `RUNNING` is executed via conditional atomic update:
  ```typescript
  const claim = await this.prisma.task.updateMany({
    where: { id: task.id, status: TaskStatus.PENDING },
    data: { status: TaskStatus.RUNNING },
  });
  if (claim.count === 0) continue; // Sibling thread claimed task
  ```
* **Retry Status Invariant**: A failing intermediate attempt (`attemptsMade + 1 < maxAttempts`) does **not** set `status = FAILED`. The task remains in `RUNNING` while BullMQ schedules the next retry delay. Only when all attempts are exhausted does the status transition to `FAILED`.
* **Cascade Cancellation**: When a run fails critically or is cancelled, pending tasks are transitioned via bulk update:
  ```typescript
  await this.prisma.task.updateMany({
    where: { runId: workflowRun.id, status: TaskStatus.PENDING },
    data: { status: TaskStatus.CANCELLED },
  });
  ```

---

### 7.3 Authentication & Session State Machine

```mermaid
stateDiagram-v2
    [*] --> ANONYMOUS: Visitor visits /workflows/new
    ANONYMOUS --> AUTHENTICATED: Local Login / Register / OAuth Exchange
    AUTHENTICATED --> ACTIVE_SESSION: 15m Access Token + 7d Refresh Token in Cookie
    ACTIVE_SESSION --> TOKEN_EXPIRED: Access Token expires after 15m
    TOKEN_EXPIRED --> ACTIVE_SESSION: Axios interceptor calls POST /api/auth/refresh
    TOKEN_EXPIRED --> LOGGED_OUT: Refresh token expired or revoked in DB
    ACTIVE_SESSION --> LOGGED_OUT: User logs out (POST /api/auth/logout deletes DB row)
    LOGGED_OUT --> [*]
```

---

## 8. Concurrency, Race Conditions & Distributed Invariants

In a distributed workflow orchestrator, concurrency bugs corrupt pipeline state, duplicate costly LLM API calls, or hang executions indefinitely. Orqestr eliminates these race conditions through code-enforced database and queue invariants.

Each concurrency scenario is analyzed below using the format:  
`Problem → Naive Approach → Race Condition / Failure Mode → Implemented Solution → Tradeoffs & Limitations`.

---

### 8.1 Multi-Parent Fan-In Race (Converging DAG Branches)

* **Problem**: In converging workflows (e.g., Node B and Node C both feed into Node D), both parent tasks execute in parallel on independent worker threads and may complete within milliseconds of each other.
* **Naive Approach**: When any task completes, check if all dependencies are met; if so, push the downstream task to BullMQ:
  ```typescript
  // NAIVE (BROKEN): Concurrent calls both see dependencies satisfied
  if (task.dependsOn.every(depId => resolvedSet.has(depId))) {
    await jobQueue.addTaskToQueue(task.type, taskData);
  }
  ```
* **Race Condition / Failure Mode**: If Worker B and Worker C finish at timestamp $T_0$, both call `onTaskCompleted` concurrently. Both query PostgreSQL, both find that all dependencies for Node D are satisfied (`status === COMPLETED`), and both push Node D to BullMQ. Node D executes twice, doubling cost, corrupting downstream data, and causing duplicate downstream pipeline forks.
* **Implemented Solution (Atomic Database Claiming + Job Deduplication + Compensation Rollback)**:
  1. **Atomic Conditional Claim**: Before enqueueing, `dispatchUnblockedTasks` executes an atomic conditional SQL update in PostgreSQL:
     ```typescript
     const claimResult = await this.prisma.task.updateMany({
       where: { id: task.id, status: TaskStatus.PENDING },
       data: { status: TaskStatus.RUNNING },
     });
     if (claimResult.count === 0) continue; // Sibling thread already claimed; skip
     ```
     Because PostgreSQL executes `UPDATE ... WHERE` atomically per row lock, exactly one concurrent thread updates `count: 1`. The second thread receives `count: 0` and silently skips.
  2. **BullMQ Job ID Deduplication**: The task is pushed to BullMQ with an explicit `jobId: task.id`. If a job with that ID already exists in Redis, BullMQ rejects the duplicate.
  3. **Queue Failure Compensation Rollback**: Queue insertion is wrapped in a `try / catch` block. If Redis throws an exception or network error, the task is atomically reverted back to `PENDING` to prevent permanently orphaned `RUNNING` tasks.
* **Tradeoffs & Limitations**: Requires an extra database write (`updateMany`) before enqueueing. In a clustered multi-orchestrator environment, an additional Redis distributed lock (`SET run:${runId}:dispatch:lock NX EX 10`) provides defense-in-depth against database query lag.

---

### 8.2 Parallel Task Failure vs. Completion Race (Terminal State Overwrite)

* **Scenario**: Two parallel tasks (B and C) run concurrently. Task B fails critically at $T_0$, transitioning the workflow run to `FAILED`. At $T_0 + 20\text{ms}$, Task C completes successfully.
* **Naive Approach**: Task C's completion handler queries the run's tasks, observes that all active tasks have finished, and marks the workflow run `COMPLETED`:
  ```typescript
  // NAIVE (BROKEN): Overwrites FAILED with COMPLETED
  if (allTasksFinished) {
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "COMPLETED" } });
  }
  ```
* **Race Condition / Failure Mode**: The failed run is overwritten to `COMPLETED`. The operator or user is told the workflow succeeded, even though a critical component crashed.
* **Implemented Solution (Terminal Status Guard + Critical Validation + Conditional Update)**:
  1. **Terminal Status Guard**: At the top of `onTaskCompleted` and `onTaskFailed`, the orchestrator verifies:
     ```typescript
     if (workflowRun.status === RunStatus.CANCELLED || workflowRun.status === RunStatus.FAILED) return;
     ```
  2. **Critical Step Validation**: When checking if the pipeline is finished, the orchestrator inspects whether any task critically failed (`hasFailedCritical`). If true, it marks the run `FAILED`, never `COMPLETED`.
  3. **Atomic Conditional Status Transition**:
     ```typescript
     await this.prisma.workflowRun.updateMany({
       where: { id: workflowRun.id, status: RunStatus.RUNNING },
       data: { status: RunStatus.COMPLETED },
     });
     ```
     If the run was already moved to `FAILED` or `CANCELLED`, `count === 0` and the completion write is discarded.
* **Tradeoffs & Limitations**: Terminal status guards guarantee correctness, but in-flight non-critical workers may still finish their current job before noticing the run has ended.

---

### 8.3 Interactive Cancellation Racing with Worker Completion

* **Problem**: An operator clicks "Cancel Run" while workers are actively executing tasks.
* **Naive Approach**: Simply delete the run or update `WorkflowRun.status = CANCELLED` without coordinating with task queues.
* **Race Condition / Failure Mode**: Workers finish their current jobs, report completion to the queue, and the orchestrator unblocks downstream tasks, continuing the workflow despite cancellation.
* **Implemented Solution (Transactional State Freeze & Completion Drop)**:
  1. `POST /api/runs/:runId/cancel` runs a PostgreSQL transaction:
     ```typescript
     await this.prisma.$transaction([
       this.prisma.workflowRun.update({ where: { id: runId }, data: { status: RunStatus.CANCELLED } }),
       this.prisma.task.updateMany({ where: { runId, status: TaskStatus.PENDING }, data: { status: TaskStatus.CANCELLED } }),
     ]);
     ```
  2. Emits `RUN_CANCELLED` over SSE to immediately update UI state.
  3. `onTaskCompleted` checks `workflowRun.status === RunStatus.CANCELLED` and returns immediately without dispatching any downstream tasks.
* **Tradeoffs & Limitations**: Does not abruptly kill running OS threads or in-flight Groq HTTP requests; instead, it prevents any subsequent tasks from ever being dispatched.

---

### 8.4 Queue Insertion Failure & Orphaned Task Compensation Rollback

* **Problem**: A task is claimed in PostgreSQL (`status: RUNNING`), but the network connection to Redis drops or Redis is out of memory before `jobQueue.addTaskToQueue()` succeeds.
* **Naive Approach**: Throw the error up the stack without rolling back database state.
* **Race Condition / Failure Mode**: The task remains stuck in `RUNNING` in PostgreSQL forever. Downstream tasks never unblock. The workflow hangs indefinitely.
* **Implemented Solution**:
  ```typescript
  try {
    await this.jobQueue.addTaskToQueue(task.type, taskData, { jobId: task.id });
  } catch (queueError) {
    // Compensation rollback
    await this.prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.PENDING },
    });
    throw queueError;
  }
  ```
* **Tradeoffs & Limitations**: Reverting to `PENDING` allows the next orchestrator evaluation cycle or manual retry to pick up the task once Redis recovers.

---

### 8.5 Worker Crashes & Redis Lock TTL Expiration

* **Problem**: A worker process running an LLM task is terminated abruptly (OOM kill, server power loss, unhandled native exception).
* **Implemented Solution**:
  - BullMQ workers maintain a Redis lock on active jobs with a periodic heartbeat renewal.
  - If the worker process dies, lock renewal stops.
  - Once the lock TTL expires, BullMQ marks the lock stalled and reassigns the job to an available worker.
  - `attempts` counter increments; if `attempts < maxAttempts`, it retries; otherwise, moves to failed set.
* **Tradeoffs & Limitations**: Guarantees **at-least-once** execution. If a worker crashed after calling Groq but before recording the output in PostgreSQL, the LLM prompt will be re-executed by the next worker.

---

### 8.6 Stale Run Zombie Sweep (`cleanupStaleRuns`)

* **Problem**: Network partitions or unexpected orchestrator restarts could theoretically leave a run in `RUNNING` status with no active worker jobs.
* **Implemented Solution**:
  - A background cron task runs every 5 minutes scanning for `WorkflowRun` rows with `status: RUNNING` and `startedAt < (now - 10 minutes)` that have zero running or pending tasks.
  - Automatically transitions them to `FAILED` with error `"Workflow run timed out after 10 minutes of inactivity"`.
  - Emits `RUN_FAILED` over SSE.
* **Tradeoffs & Limitations**: Protects against zombie runs consuming UI attention. Workflows with legitimate multi-hour tasks must configure longer timeouts.

---

## 9. Security & Threat Modeling Architecture

```mermaid
graph TB
    subgraph INGRESS["Ingress & Perimeter Security"]
        CORS["CORS Configuration (Restricted CLIENT_URL)"]
        RATE["Redis Sliding-Window Rate Limiting (Auth, Test, Webhooks)"]
    end

    subgraph AUTH["Authentication & Tenant Isolation"]
        JWT["15-Minute Stateless Access JWT"]
        REFRESH["7-Day DB-Backed Refresh Token (httpOnly Cookie)"]
        OAUTH["Cryptographic State (300s) + 1-Time Code Exchange (60s)"]
        RBAC["Org Workspace Scoping (OWNER / ADMIN / MEMBER)"]
    end

    subgraph WORKER_SEC["Worker Execution & Egress Hardening"]
        SSRF["SSRF Guard (DNS Pre-resolve, RFC1918 & Metadata Block, 5 Hops)"]
        HTTP_LIMIT["5MB Max Response Body Ceiling (Streaming Counter)"]
        TEMPLATE_SEC["Pure Regex Replacement (Zero eval / Code Execution)"]
        SECRET_ROT["High-Entropy Webhook Secrets (48-char hex, 2^192 keyspace)"]
        LOG_MASK["Centralized Log Redaction (Masks URLs, Bearer, JWT, Keys)"]
    end

    INGRESS --> AUTH
    AUTH --> WORKER_SEC

    style INGRESS fill:#16213e,stroke:#0f3460,color:#e0e0e0
    style AUTH fill:#0f3460,stroke:#533483,color:#e0e0e0
    style WORKER_SEC fill:#533483,stroke:#e94560,color:#e0e0e0
```

### Threat Modeling & Implemented Mitigations:

| Threat / Attack Vector | Risk | Implemented Code Mitigation | Tradeoffs & Considerations |
| :--- | :--- | :--- | :--- |
| **BOLA / IDOR on Run & Workflow Data** | Unauthorized access to another user's/org's executions | `WorkflowRunService.getRunById()` and `WorkflowService.getWorkflowById()` verify user ownership or active organization membership before returning data. | Requires join on `organization_members` for every access check. |
| **Server-Side Request Forgery (SSRF)** | Attacker uses HTTP Agent to probe internal VPC, AWS metadata (`169.254.169.254`), or Redis | `validateUrl()` validates protocol (`http:`, `https:`), resolves DNS, blocks RFC 1918, loopback, link-local, carrier-grade NAT, and cloud metadata. Limits redirects to $\le 5$ hops. | Blocks legitimate requests to internal test domains unless explicitly allowlisted. |
| **OAuth 2.0 Login CSRF** | Attacker binds victim's session to attacker's OAuth account | Server generates 32-byte cryptographic state, stores in Redis (`oauth:state:${state}`, 300s TTL), and validates/deletes atomically on provider callback. | Requires Redis availability during OAuth redirects. |
| **OAuth Token URL Leakage** | JWTs in redirect query strings leak to browser history, referer headers, proxy logs | Server issues an ephemeral single-use 32-byte exchange code in Redis (60s TTL). Client calls `POST /api/auth/oauth/exchange` via POST body. | Adds one quick round-trip HTTP request on frontend callback mount. |
| **Denial of Service via Worker Memory Exhaustion** | Target HTTP server returns a 10GB streaming response, crashing worker | `HttpAgent` checks `Content-Length` header and streams response with a byte counter, rejecting any response exceeding **5MB**. | Legitimate payloads > 5MB are rejected; users must use external storage pre-signed URLs. |
| **Arbitrary Code Execution via Template Engine** | Template injection (`{{constructor.constructor('...')()}}`) | Interpolation uses regex matching (`/\{\{([^}]+)\}\}/g`) and path traversal. Never invokes `eval()` or template engines. | Cannot execute arbitrary JavaScript expressions inside prompt templates. |
| **Webhook Timing & Brute-Force Attacks** | Attacker guesses webhook tokens to trigger unmetered runs | Tokens are 48-character cryptographic hex strings ($2^{192}$ keyspace). Rate limited via Redis sliding-window filter. Ingestion responds immediately with `200 OK`. | Tokens must be carefully stored by callers. |
| **Credential Leakage in Production Logs** | Plaintext database URLs, Redis passwords, JWTs, or API keys logged to stdout/files | `log-sanitizer.ts` integrated into Winston formatters. Recursively redacts passwords in DB URLs, Bearer tokens, standalone JWTs, API keys (`gsk_***`), and sensitive keys. | Regex traversal adds minimal overhead (< 1ms) to logging calls. |

---

## 10. Comprehensive Failure Model & Disaster Recovery

### "What Happens When Things Fail?"

| Failure Scenario | Mechanism of Detection | Current Code Handling | Future Scale-Out Improvement |
| :--- | :--- | :--- | :--- |
| **PostgreSQL Primary Crash** | Prisma connection pool throws connection refused | API requests fail with 500 error; Winston logs error with `[req:<id>]`; healthcheck `/health` reports DB down. | Multi-AZ PostgreSQL with automatic failover (AWS RDS / Neon) + PgBouncer read replica routing. |
| **Redis Outage / Unavailability** | `ioredis` emits error event; BullMQ connection fails | `CacheService` catches Redis errors and falls back directly to PostgreSQL; queue dispatches pause. | Redis Cluster with 3 master shards + 3 replicas with automatic sentinel failover. |
| **Worker Process Crash Mid-Task** | BullMQ Redis lock TTL expires without heartbeat | BullMQ releases lock and returns job to `waiting` queue for another worker to process. | Dedicated worker pods managed by Kubernetes with liveness probes and auto-restarts. |
| **API Server Process Crash** | Node.js process exit | Load balancer / reverse proxy routes traffic to surviving instances; in-flight HTTP requests drop. | Stateless API deployment behind AWS ALB with health probes (`/health`) and auto-scaling group. |
| **External LLM Outage / 429 Rate Limit** | Groq SDK throws exception or 429 status | Task catches error, rethrows to BullMQ; BullMQ applies exponential backoff (1s $\rightarrow$ 2s $\rightarrow$ 4s). | Multi-provider fallback routing (Groq $\rightarrow$ OpenAI $\rightarrow$ Anthropic) with circuit breakers. |
| **Target HTTP Host Unreachable / Timeout** | `node-fetch` throws timeout error (30s limit) | Task marked failed; if `critical: false`, passes `{ error }` downstream; if `critical: true`, terminates run. | User-configurable per-node timeout and retry policy. |
| **Queue Insertion Failure** | Redis throws during `jobQueue.addTaskToQueue` | Compensation rollback immediately reverts task status from `RUNNING` to `PENDING` in PostgreSQL. | Persistent outbox pattern in PostgreSQL for queue insertion retries. |
| **Duplicate Job Enqueued** | BullMQ job ID collision | Enforced via `{ jobId: task.id }`; BullMQ rejects duplicate job with identical ID. | Idempotency key stored in Redis with 24h TTL. |
| **Network Partition (API $\leftrightarrow$ Redis)** | Redis commands time out | API returns 503; in-flight tasks in BullMQ continue executing on workers connected to Redis. | Multi-datacenter Redis replication with Raft consensus. |
| **Stale / Orphaned Run** | `cleanupStaleRuns()` cron (runs every 5 min) | Scans for runs stuck in `RUNNING` for > 10m with no active tasks; transitions them to `FAILED`. | Worker heartbeat lease table in PostgreSQL with dynamic lease renewals. |
| **Interactive Run Cancellation** | User calls `POST /api/runs/:id/cancel` | Transaction marks run and pending tasks `CANCELLED`; orchestrator drops late worker completions. | Distributed cancellation signal published to Redis channel to abort active worker threads. |

---

## 11. Observability Architecture (Implemented vs Proposed Scale-Out)

### 11.1 Implemented Today in Codebase
* **Centralized Secure Logging**: Winston logger with console and file transports (`logs/error.log`, `logs/combined.log`).
* **Deep Credential Redaction Engine ([`log-sanitizer.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/log-sanitizer.ts))**: Masks database passwords (`postgresql://user:***@host`), Redis connection strings, Bearer tokens, standalone JWTs, API keys (`gsk_***`, `gh_***`), private keys, and sensitive payload keys.
* **Request Correlation (`x-request-id`)**: Middleware generates a UUID for every incoming request, attaches it to `req.id` and response headers, and logs `[req:<id>]` across all logs.
* **Zero-Leakage 500 Diagnostics**: Internal 500 exceptions log full sanitized stack traces to server logs while returning generic error codes and the `requestId` to clients.
* **Live SSE Streaming**: `GET /api/runs/:runId/stream` pushes live status transitions, node timestamps, and payloads.
* **Healthcheck Probe**: `GET /health` returns application uptime, environment, and system status.
* **Immutable Audit Trail**: All task inputs, outputs, errors, durations, and attempt counts are persisted in PostgreSQL.

### 11.2 Proposed Future Scale-Out Additions
*(Clearly designated as future production improvements)*
* **OpenTelemetry Distributed Tracing**: Trace context propagation (`traceparent` header) flowing from frontend canvas $\rightarrow$ API gateway $\rightarrow$ BullMQ job metadata $\rightarrow$ worker execution $\rightarrow$ external LLM.
* **Prometheus Metrics Exporter**: Expose `/metrics` with gauges for active queue depth (`bullmq_jobs_waiting`), worker utilization, LLM token latency histograms, and HTTP agent duration percentiles.
* **Grafana Dashboards**: Real-time visualization of pipeline throughput, error budgets, and provider rate-limit saturation.

---

## 12. Scalability Bottleneck Analysis & Scale-Out Architecture

### 12.1 Capacity Planning & Illustrative Calculations
*(Note: These figures represent illustrative capacity planning assumptions for system design discussions, not benchmark measurements)*

* **Assumptions**:
  - 10,000 active users; 100 concurrent workflow runs.
  - Average workflow: 5 nodes (1 root, 2 parallel, 1 transform, 1 notification).
  - Average node execution time: LLM = 800ms, HTTP = 200ms. Total run time $\approx 2.5\text{s}$.
* **Throughput Calculations**:
  - 100 concurrent runs $\times$ 5 tasks = 500 concurrent in-flight tasks.
  - Run completion rate: $100\text{ runs} / 2.5\text{s} = 40\text{ runs/sec}$.
  - Task throughput: $40 \times 5 = 200\text{ tasks/sec}$.
  - Queue operations: $200\text{ push/sec} + 200\text{ pop/sec} + 200\text{ complete/sec} = 600\text{ Redis ops/sec}$. (Redis single-instance capacity is ~25,000 ops/sec; Redis load $\approx 2.4\%$).
  - PostgreSQL writes: $200\text{ task updates/sec} + 40\text{ run updates/sec} = 240\text{ writes/sec}$. (Standard PostgreSQL handles 2,000–5,000 writes/sec with connection pooling).
* **Primary System Bottleneck**: External LLM Provider Rate Limits (Groq TPM / RPM). 100 concurrent LLM tasks $\approx 50,000\text{ tokens/sec}$, which saturates standard tier API limits before internal CPU, memory, or database limits are reached.

---

### 12.2 Scale-Out Evolution Path

```mermaid
graph TB
    subgraph CURRENT["Current Implementation (Single Process)"]
        ALL_IN_ONE["Express API + In-Process Orchestrator + In-Process Workers + In-Memory SSE"]
    end

    subgraph SCALE_OUT["Proposed Production Scale-Out Architecture"]
        ALB["Application Load Balancer (AWS ALB / Nginx)"]
        API_POOL["Stateless Express API Cluster (1..N instances)"]
        REDIS_BUS["Redis Pub/Sub Event Backplane (SSE Broadcast)"]
        REDIS_CLUS["Redis Cluster (BullMQ Queues & Repeatables)"]
        ORCH_POOL["Dedicated Orchestrator Workers (Distributed Locks)"]
        WORKER_LLM["Auto-Scaled LLM Worker Fleet (Concurrency: 5)"]
        WORKER_HTTP["Auto-Scaled HTTP Worker Fleet (Concurrency: 20)"]
        WORKER_TF["Auto-Scaled Transform Worker Fleet (Concurrency: 5)"]
        PGBOUNCER["PgBouncer Connection Pooler"]
        PG_PRIMARY["PostgreSQL Primary (Writes)"]
        PG_REPLICA["PostgreSQL Read Replicas (Reads)"]
    end

    CURRENT -.->|"Scale Evolution"| SCALE_OUT

    style CURRENT fill:#1a1a2e,stroke:#e94560,color:#e0e0e0
    style SCALE_OUT fill:#0f3460,stroke:#047857,color:#e0e0e0
```

#### Bottleneck Evolution Analysis:

| Component | Current Single-Instance Limit | Proposed Architecture Change | Why It Solves the Bottleneck | Tradeoffs & Costs |
| :--- | :--- | :--- | :--- | :--- |
| **API Web Tier** | ~1,000 req/sec | Stateless Express API cluster behind ALB | Spreads HTTP ingestion across $N$ CPU cores | Requires external session store (already stateless JWT) |
| **Real-Time SSE** | ~2,000 sockets | Replace `RunEmitter` with Redis Pub/Sub | Allows client on Instance A to receive events from worker on Instance B | Redis Pub/Sub has no replay buffer; clients must fetch initial state via REST |
| **Agent Workers** | Process thread contention | Separate independent worker fleets per agent type | Prevents fast I/O tasks (HTTP) from being blocked behind slow LLM inference | More containers/processes to monitor and deploy |
| **PostgreSQL Connections** | ~100 connections | Deploy PgBouncer in transaction pooling mode | Reuses DB connections across thousands of concurrent tasks | Prepared statements require specific PgBouncer configuration |
| **Database Read Contention** | Dashboard queries compete with writes | Route read queries to PostgreSQL Read Replicas | Eliminates read contention on primary write WAL | Introduces replication lag (< 100ms) on read replicas |

---

## 13. Key Architectural Trade-Offs

| Decision | Chosen Architecture | Alternative Considered | Engineering Trade-Off Rationale |
| :--- | :--- | :--- | :--- |
| **Task Queue** | **BullMQ on Redis** | Apache Kafka | BullMQ provides job-level locks, per-message exponential backoff, delayed scheduling, and dead-letter sets natively. Kafka is an event streaming log lacking per-message retries without blocking partition heads. |
| **Database** | **PostgreSQL (`JSONB`)** | MongoDB | PostgreSQL gives relational foreign key integrity (users, orgs, runs, tasks) and ACID transactions alongside schema flexibility for arbitrary node outputs via `JSONB`. |
| **Real-time Protocol** | **Server-Sent Events (SSE)** | WebSockets | Run monitoring is strictly unidirectional (server $\rightarrow$ client). SSE operates over standard HTTP, supports native browser auto-reconnect, and avoids WebSocket connection upgrade framing overhead. |
| **Workflow Versioning** | **Immutable Snapshots** | Git-style Diff / Delta Trees | Snapshotting enables $O(1)$ instant version retrieval without replaying diff chains, eliminating the risk of corrupted version history. Storage overhead is negligible for JSON graphs (< 50 KB). |
| **Cron Scheduling** | **BullMQ Repeatables** | `node-cron` | In-process `node-cron` fires duplicate triggers if multiple backend replicas are running. BullMQ repeatables use Redis atomic locks to guarantee singleton execution across server instances. |
| **Authentication** | **Custom Dual-Token JWT** | Clerk / Auth0 / NextAuth | Custom JWT provides complete control over token expiration, zero external MAU vendor fees, portable Express middleware compatibility, and in-place draft preservation without page redirects. |
| **Worker Design** | **Abstract `BaseAgent` Class** | Functional Plugins | The Template Method pattern enforces strict database state transitions, error handling, and 30-second heartbeat reporting across all worker implementations. |

---

## 14. Documentation Completeness & Traceability Matrix

| Codebase Area | Current Implementation Status | Documented In Detail | Primary Reference Document |
| :--- | :---: | :---: | :--- |
| **Authentication & Sessions** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md) |
| **OAuth 2.0 State & Exchange** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [FINAL_SECURITY_AUDIT.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/FINAL_SECURITY_AUDIT.md) |
| **Organizations & Workspaces** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md) |
| **Role-Based Access Control (RBAC)**| ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md) |
| **Notifications & Invitations** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [architecture.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/architecture.md) |
| **Workflow Canvas Builder** | ✅ Implemented | ✅ Yes | [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md), [TECH_STACK_JUSTIFICATION.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/TECH_STACK_JUSTIFICATION.md) |
| **DAG Cycle & Kahn's Validation** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [architecture.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/architecture.md) |
| **Node Testing Sandbox** | ✅ Implemented | ✅ Yes | [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md), [FINAL_SECURITY_AUDIT.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/FINAL_SECURITY_AUDIT.md) |
| **Workflow Versioning & Rollback** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md) |
| **Workflow Duplication** | ✅ Implemented | ✅ Yes | [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md) |
| **Orchestrator Execution Engine** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [architecture.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/architecture.md) |
| **Fan-In Concurrency Claiming** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [INTERVIEW_PREP.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/INTERVIEW_PREP.md) |
| **Parallel Failure Race Guard** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [INTERVIEW_PREP.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/INTERVIEW_PREP.md) |
| **Interactive Run Cancellation** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [user-flows.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/user-flows.md) |
| **Agent Workers (LLM/HTTP/Transform)**| ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [architecture.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/architecture.md) |
| **BullMQ Job Queues** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [TECH_STACK_JUSTIFICATION.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/TECH_STACK_JUSTIFICATION.md) |
| **Cron Scheduler & Repeatable Cleanup**| ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [FINAL_SECURITY_AUDIT.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/FINAL_SECURITY_AUDIT.md) |
| **Webhooks & Token Authentication** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [FINAL_SECURITY_AUDIT.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/FINAL_SECURITY_AUDIT.md) |
| **Real-Time SSE Streaming** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [architecture.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/architecture.md) |
| **SSRF Protection & URL Validation** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [FINAL_SECURITY_AUDIT.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/FINAL_SECURITY_AUDIT.md) |
| **Secure Logging & Log Sanitization** | ✅ Implemented | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [FINAL_SECURITY_AUDIT.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/FINAL_SECURITY_AUDIT.md) |
| **Test Suite Coverage (373 Tests)** | ✅ Implemented | ✅ Yes | [CONTRIBUTING.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/CONTRIBUTING.md), [AUDIT_IMPLEMENTATION_LOG.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/.vault/AUDIT_IMPLEMENTATION_LOG.md) |
| **Distributed SSE Fan-Out (Pub/Sub)** | 💡 Future Architecture | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [scaling.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/scaling.md) |
| **Distributed Multi-Orchestrator Locks**| 💡 Future Architecture | ✅ Yes | [system-design.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/system-design.md), [scaling.md](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/docs/scaling.md) |
