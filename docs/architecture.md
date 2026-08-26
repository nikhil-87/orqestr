# Architecture

Current system architecture of Orqestr — how the components connect and how a workflow runs from trigger to completion.

---

## High-Level System Overview

```mermaid
graph TB
    subgraph CLIENT["🖥️ Next.js Frontend"]
        UI["React Flow Canvas<br/>Workflow Builder<br/>(Dagre Layout · Undo/Redo · Import/Export)"]
        MONITOR["Run Monitor<br/>Live SSE Stream · Cancellation"]
        AUTH["Auth & Org Provider<br/>JWT + Silent Refresh · Org Switcher"]
    end

    subgraph API_SERVER["⚙️ Express API Server"]
        ROUTES["REST API Routes<br/>/api/workflow, /api/runs,<br/>/api/auth, /api/scheduler, /api/webhooks,<br/>/api/organizations, /api/notifications, /api/agents"]
        SWAGGER["Swagger UI<br/>/api/docs"]
        MW["Middleware Stack<br/>Auth · Org · Request Logger (Sanitized) · Error Handler"]
        SSE_MGR["SSE Connection Manager<br/>GET /api/runs/:runId/stream"]
    end

    subgraph ORCHESTRATOR["🎯 Orchestrator Engine"]
        DEP["Dependency Graph<br/>DAG Compiler & Validator"]
        DISPATCH["Atomic Task Dispatcher<br/>(Claiming & Deduplication)"]
        EVENTS["QueueEvents Listener<br/>Job Completed / Failed Guards"]
        STALE["Stale Run & Task Cleanup<br/>(10m Timeout Sweep)"]
    end

    subgraph REALTIME["📡 Real-Time Event Bus"]
        RUN_BUS["RunEmitter Event Bus<br/>runEmitter.emit('run:id')"]
    end

    subgraph QUEUES["📨 BullMQ on Redis"]
        Q_LLM["LLM_AGENT Queue"]
        Q_HTTP["HTTP_AGENT Queue"]
        Q_TRANSFORM["TRANSFORM_AGENT Queue"]
        Q_SCHED["Scheduler Queue<br/>BullMQ Repeatable Jobs"]
    end

    subgraph WORKERS["🤖 Agent Workers"]
        W_LLM["LLM Agent<br/>Prompt Interpolation"]
        W_HTTP["HTTP Agent<br/>REST Fetcher"]
        W_TRANSFORM["Transform Agent<br/>JSON Structurer"]
    end

    subgraph DATA["🗄️ Data Layer"]
        PG[("PostgreSQL<br/>(Prisma ORM)")]
        REDIS[("Redis Key-Value")]
        CACHE["Cache Service<br/>Cache-Aside + TTL"]
    end

    subgraph EXTERNAL["☁️ External Services"]
        GROQ["Groq Cloud API<br/>(gpt-oss-120b)"]
        EXT_API["External REST APIs"]
        WEBHOOK_CALLER["Webhook Callers"]
    end

    %% Client to API
    UI -->|"REST API"| ROUTES
    AUTH -->|"POST /api/auth/*"| ROUTES
    MONITOR -->|"EventSource Stream"| SSE_MGR

    %% API routing
    ROUTES -->|"triggerRun()"| ORCHESTRATOR
    ROUTES --> SWAGGER
    ROUTES --> CACHE

    %% SSE Event Bus Connection
    SSE_MGR -->|"Subscribe run:id"| RUN_BUS
    ORCHESTRATOR -->|"Emit status events"| RUN_BUS

    %% Orchestrator Internals
    DEP --> DISPATCH
    EVENTS -->|"Unblock next tasks"| DISPATCH
    DISPATCH -->|"JobQueue.addTaskToQueue()"| QUEUES

    %% Queues to Workers
    Q_LLM --> W_LLM
    Q_HTTP --> W_HTTP
    Q_TRANSFORM --> W_TRANSFORM

    %% Workers to External Services
    W_LLM -->|"Chat Completion"| GROQ
    W_TRANSFORM -->|"Chat Completion"| GROQ
    W_HTTP -->|"Validated HTTP Request"| EXT_API

    %% Workers state & heartbeats to DB
    W_LLM -->|"Update Task / Heartbeat"| PG
    W_HTTP -->|"Update Task / Heartbeat"| PG
    W_TRANSFORM -->|"Update Task / Heartbeat"| PG

    %% BullMQ QueueEvents to Orchestrator
    QUEUES -->|"Job completed / failed signal"| EVENTS

    %% Orchestrator DB operations
    ORCHESTRATOR -->|"Read / Write Runs & Tasks"| PG
    STALE -->|"Find & fail timed-out runs"| PG

    %% Cache to Redis
    CACHE --> REDIS

    %% Webhook ingress
    WEBHOOK_CALLER -->|"POST /api/webhooks/trigger/:token"| ROUTES

    %% Scheduler
    Q_SCHED -->|"Scheduled trigger"| ORCHESTRATOR

    %% Styling
    style CLIENT fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style API_SERVER fill:#16213e,stroke:#0f3460,color:#e0e0e0
    style ORCHESTRATOR fill:#0f3460,stroke:#533483,color:#e0e0e0
    style REALTIME fill:#0f3460,stroke:#e94560,color:#e0e0e0
    style QUEUES fill:#533483,stroke:#e94560,color:#e0e0e0
    style WORKERS fill:#2d1b69,stroke:#e94560,color:#e0e0e0
    style DATA fill:#1a1a2e,stroke:#0f3460,color:#e0e0e0
    style EXTERNAL fill:#0d2137,stroke:#16213e,color:#e0e0e0
```

---

## Workflow Execution Flow

Step-by-step sequence of what happens when a workflow is triggered:

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
    participant SSE as SSE Stream Endpoint

    User->>API: POST /api/workflow/:id/run { input }
    API->>Orch: orchestrator.triggerRun(workflowId, input, userId)

    Note over Orch: Step 1: Initialize Run & DAG
    Orch->>DB: Create WorkflowRun (status: RUNNING)
    Orch->>DB: Create Task rows for all nodes (status: PENDING)
    Orch->>DB: Update tasks with dependsOn IDs (second pass)

    Note over Orch: Step 2: Dispatch Root Tasks
    Orch->>DB: Set root task inputs
    Orch->>Queue: addTaskToQueue(agentType, taskData)
    Orch->>Bus: emit("run:id", { taskId, status: RUNNING })
    Bus->>SSE: push event
    SSE-->>User: SSE event: TASK_RUNNING

    API-->>User: 200 OK { runId, status: "RUNNING" }

    Note over Worker: Step 3: Worker Processes Job
    Queue->>Worker: Worker picks up job (acquires Redis lock)
    Worker->>DB: Mark Task -> RUNNING, increment attempts
    Worker->>DB: Mark Agent -> BUSY

    alt LLM Agent
        Worker->>Worker: interpolateTemplate(prompt, input)
        Worker->>LLM: POST chat/completions (model, prompt)
        LLM-->>Worker: Response text
    else HTTP Agent
        Worker->>Worker: Execute validated HTTP request
    else Transform Agent
        Worker->>LLM: POST chat/completions (transform instructions)
        LLM-->>Worker: Structured JSON
    end

    Worker->>DB: Mark Task -> COMPLETED, save output JSON
    Worker->>DB: Mark Agent -> ONLINE, tasksHandled + 1
    Worker->>Queue: Return job result (BullMQ fires completed event)

    Note over Orch: Step 4: QueueEvents Listener Catches Completion
    Queue->>Orch: QueueEvents "completed" listener fires (jobId)
    Orch->>Bus: emit("run:id", { taskId, status: COMPLETED, output })
    Bus->>SSE: push event
    SSE-->>User: SSE event: TASK_COMPLETED

    Note over Orch: Step 5: Check & Dispatch Downstream Tasks
    Orch->>DB: Fetch tasks for runId & resolve unblocked tasks
    Orch->>DB: Set next tasks' input = completed output
    Orch->>Queue: Dispatch newly unblocked tasks
    Orch->>Bus: emit("run:id", { taskId, status: RUNNING })
    Bus->>SSE: push event
    SSE-->>User: SSE event: TASK_RUNNING

    Note over Orch: Step 6: Final Run Completion
    Orch->>DB: All tasks resolved -> Mark WorkflowRun -> COMPLETED
    Orch->>Bus: emit("run:id", { type: RUN_COMPLETED })
    Bus->>SSE: push event
    SSE-->>User: SSE event: RUN_COMPLETED
```

---

## Agent Worker Lifecycle

Every agent extends the abstract `BaseAgent` class. This is how each worker operates:

```mermaid
stateDiagram-v2
    [*] --> Registering: start()
    Registering --> Listening: Upsert agent row in DB (Status = ONLINE)

    Listening --> Processing: BullMQ delivers job
    Processing --> Executing: Mark task RUNNING in DB

    Executing --> Completed: execute() returns output
    Executing --> Failed: execute() throws error

    Completed --> Listening: Save output to DB, increment tasksHandled
    Failed --> Retrying: attempts < maxAttempts
    Failed --> PermanentlyFailed: attempts >= maxAttempts

    Retrying --> Listening: Exponential backoff (1s -> 2s -> 4s)
    PermanentlyFailed --> Listening: Mark task FAILED, increment tasksFailed

    Listening --> Heartbeat: Every 30 seconds
    Heartbeat --> Listening: Update lastSeenAt in DB

    Listening --> Stopping: SIGINT / SIGTERM
    Stopping --> [*]: Status = OFFLINE, Close worker
```

---

## Database Entity Relationships

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

---

## Queue & Retry Architecture

```mermaid
graph LR
    subgraph PRODUCER["Orchestrator (Producer)"]
        DISPATCH["Dispatch Task"]
    end

    subgraph REDIS_QUEUES["Redis (BullMQ)"]
        WAITING["Waiting List"]
        ACTIVE["Active Set<br/>(locked by worker)"]
        DELAYED["Delayed Set<br/>(backoff retries)"]
        FAILED_SET["Failed Set<br/>(exhausted retries)"]
        COMPLETED_SET["Completed Set<br/>(last 100 kept)"]
    end

    subgraph CONSUMER["Agent Worker (Consumer)"]
        PROCESS["execute(input, config)"]
    end

    DISPATCH -->|"queue.add()"| WAITING
    WAITING -->|"Worker picks job<br/>acquires lock"| ACTIVE
    ACTIVE --> PROCESS

    PROCESS -->|"Success"| COMPLETED_SET
    PROCESS -->|"Error, attempts < 3"| DELAYED
    DELAYED -->|"Exponential backoff<br/>1s -> 2s -> 4s"| WAITING
    PROCESS -->|"Error, attempts = 3"| FAILED_SET

    COMPLETED_SET -->|"QueueEvents completed"| DISPATCH
    FAILED_SET -->|"QueueEvents failed"| DISPATCH

    style PRODUCER fill:#0f3460,stroke:#533483,color:#e0e0e0
    style REDIS_QUEUES fill:#533483,stroke:#e94560,color:#e0e0e0
    style CONSUMER fill:#2d1b69,stroke:#e94560,color:#e0e0e0
```

**Configuration per queue:**
- `attempts: 3` — max retries before moving to failed set
- `backoff: { type: "exponential", delay: 1000 }` — 1s $\rightarrow$ 2s $\rightarrow$ 4s
- `removeOnComplete: 100` — keep last 100 completed jobs for inspection
- `removeOnFail: 500` — keep last 500 failed jobs for debugging

---

## Core Architectural Invariants & Production Controls

The system enforces six core architectural invariants to guarantee reliability and security under concurrency:

### 1. Multi-Parent Fan-In Atomic Task Claiming
When multiple parent nodes complete concurrently and feed into a shared downstream node (fan-in), each parent's completion event triggers `dispatchUnblockedTasks()`. To prevent duplicate job execution:
* The orchestrator issues an atomic conditional update:
  ```typescript
  const claim = await this.prisma.task.updateMany({
    where: { id: task.id, status: TaskStatus.PENDING },
    data: { status: TaskStatus.RUNNING },
  });
  if (claim.count === 0) continue; // Sibling thread claimed task; skip dispatch
  ```
* PostgreSQL serializes row writes; exactly one thread gets `count === 1`.
* The job is pushed to BullMQ with `{ jobId: task.id }` ensuring Redis-level deduplication.
* If queue insertion throws an error, a compensation rollback resets the task status back to `PENDING`.

### 2. Terminal Run Status Immutability
If a parallel task fails critically, the workflow run is marked `FAILED`. Sibling tasks still in progress will complete, but when their completion events arrive:
* `onTaskCompleted` verifies `if (workflowRun.status === RunStatus.CANCELLED || workflowRun.status === RunStatus.FAILED) return;`.
* Run finalization uses atomic conditional updates:
  ```typescript
  await this.prisma.workflowRun.updateMany({
    where: { id: workflowRun.id, status: RunStatus.RUNNING },
    data: { status: RunStatus.COMPLETED },
  });
  ```
  This prevents race conditions where a late successful task overwrites a `FAILED` or `CANCELLED` status.

### 3. Interactive Run Cancellation
Users can cancel running workflows via `POST /api/runs/:id/cancel`:
* In a single PostgreSQL transaction, `WorkflowRun` is updated to `CANCELLED` and all unstarted tasks (`status: PENDING`) are transitioned to `CANCELLED`.
* The orchestrator broadcasts `RUN_CANCELLED` over `RunEmitter` to push real-time updates via SSE.
* In-flight worker jobs finish safely, but their completion events are discarded by terminal status guards.

### 4. Tenant Isolation & Context Propagation
Every workflow, schedule, and run belongs either to a personal user or an organization:
* The frontend Axios client transmits `x-organization-id` from active workspace state.
* `orgMiddleware` checks `organization_members` for `[organizationId, userId]`, rejecting non-members with 403 `FORBIDDEN_ORGANIZATION`.
* `canAccess(workflow, userId, organizationId)` is enforced on all CRUD, trigger, and version restore operations.
* Soft-deleted workflows (`isArchived: true`) are excluded from active listings and cannot be executed.

### 5. SSRF Defense & Payload Protection in Workers
The `HTTP_AGENT` worker executes external network calls under strict security controls:
* **Protocol & IP Whitelist**: Only `http:` and `https:` allowed. RFC 1918 private subnets, loopback, link-local cloud metadata (`169.254.169.254`), and IPv6 equivalents are rejected via `validateUrl()`.
* **DNS Pre-resolution**: Resolves hostnames via `dns.lookup({ all: true })` to prevent DNS rebinding.
* **Redirect Limits**: Manual redirect handling capped at 5 hops, re-validating each destination URL.
* **Response Size Capping**: Rejects responses exceeding **5MB** via `Content-Length` inspection and a streaming byte counter.

### 6. Production Credential Redaction & Request Tracing
All log output across console and file transports passes through a centralized sanitizer ([`log-sanitizer.ts`](file:///c:/Users/nikhil/Desktop/projectss/ai-orchestor/Orqestr/server/utils/log-sanitizer.ts)):
* Database connection strings (`postgresql://user:***@host`), Redis URLs, Bearer tokens, standalone JWTs, and API keys (`gsk_***`, `gh_***`) are masked via regex.
* Payload keys (`password`, `refreshToken`, `secret`, `apiKey`) are sanitized recursively.
* Inbound requests are assigned a unique `x-request-id` UUID logged as `[req:<id>]`.

