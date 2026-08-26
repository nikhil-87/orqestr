# End-to-End User Flows

Complete walkthrough of every user journey in Orqestr — from first visit to watching execution results stream in real time. Covers all edge cases, error paths, and how the system handles each one.

---

## Table of Contents

- [1. Authentication Flow](#1-authentication-flow)
- [2. Building & Saving a Workflow (Unauthenticated → Authenticated)](#2-building--saving-a-workflow-unauthenticated--authenticated)
- [3. Workflow Execution Flow](#3-workflow-execution-flow)
- [4. Task Failure & Retry Handling](#4-task-failure--retry-handling)
- [5. Real-Time Monitoring via SSE](#5-real-time-monitoring-via-sse)
- [6. Multiple Run Clicks & Concurrent Runs](#6-multiple-run-clicks--concurrent-runs)
- [7. Token Expiration Mid-Session](#7-token-expiration-mid-session)
- [8. Workflow Triggered via Webhook or Cron](#8-workflow-triggered-via-webhook-or-cron)
- [9. Stale Run Cleanup](#9-stale-run-cleanup)
- [10. Workspace & Organization Management, Invitations & RBAC](#10-workspace--organization-management-invitations--rbac)
- [11. OAuth Flow with Cryptographic State & One-Time Exchange](#11-oauth-flow-with-cryptographic-state--one-time-exchange)
- [12. Advanced Workflow Builder: Node Testing, DAG Validation, Auto-Layout & Versioning](#12-advanced-workflow-builder-node-testing-dag-validation-auto-layout--versioning)
- [13. Run Cancellation Flow](#13-run-cancellation-flow)
- [14. Workflow Soft-Delete Archival & Scheduler Cleanup](#14-workflow-soft-delete-archival--scheduler-cleanup)

---

## 1. Authentication Flow

```mermaid
flowchart TD
    START(["User visits Orqestr"]) --> CHECK{"Has accessToken<br/>in localStorage?"}

    CHECK -->|Yes| VERIFY["Attach token to Axios headers<br/>GET /api/auth/me"]
    CHECK -->|No| UNAUTH["User is unauthenticated<br/>Can browse /workflows/new freely"]

    VERIFY -->|200 OK| AUTHED["✅ User is authenticated<br/>Full access to all routes"]
    VERIFY -->|401 Unauthorized| TRY_REFRESH["Axios interceptor fires<br/>POST /api/auth/refresh"]

    TRY_REFRESH -->|200 OK| NEW_TOKENS["New accessToken + refreshToken<br/>saved to localStorage<br/>Retry original /me request"]
    TRY_REFRESH -->|401 Failed| CLEAR["Clear all tokens<br/>Redirect to /auth/login"]

    NEW_TOKENS --> AUTHED

    UNAUTH --> CAN_BUILD["Can build workflows on canvas<br/>Cannot save, run, or view dashboard"]

    style AUTHED fill:#065f46,stroke:#047857,color:#fff
    style CLEAR fill:#7f1d1d,stroke:#991b1b,color:#fff
    style CAN_BUILD fill:#1e3a5f,stroke:#2563eb,color:#fff
```

### Route Protection

Every API route except these public endpoints requires the `authenticate` middleware (JWT Bearer token):

| Route | Auth Required? | Why |
|-------|---------------|-----|
| `POST /api/auth/register` | ❌ No | Creating an account (rate-limited) |
| `POST /api/auth/login` | ❌ No | Logging in (rate-limited) |
| `POST /api/auth/refresh` | ❌ No | Refreshing expired tokens (rate-limited) |
| `POST /api/auth/logout` | ❌ No | Invalidate refresh token from cookie or body |
| `GET /api/auth/google` | ❌ No | Initiates Google OAuth with cryptographic state |
| `GET /api/auth/google/callback` | ❌ No | Consumes state, issues one-time exchange code |
| `GET /api/auth/github` | ❌ No | Initiates GitHub OAuth with cryptographic state |
| `GET /api/auth/github/callback` | ❌ No | Consumes state, issues one-time exchange code |
| `POST /api/auth/oauth/exchange` | ❌ No | Single-use ephemeral code exchange for session tokens (rate-limited) |
| `POST /api/webhooks/trigger/:token` | ❌ No | External webhook trigger (token-protected, rate-limited) |
| `GET /api/runs/:runId/stream` | ✅ Yes | SSE stream (authenticated via JWT query token/Bearer header & authorized by run ownership or org membership) |
| `POST /api/runs/:id/cancel` | ✅ Yes | Interactive run cancellation |
| `POST /api/agents/test` | ✅ Yes | Direct agent node execution testing (rate-limited at 20 req/min, SSRF guarded) |
| **Everything else** (`/api/workflow/*`, `/api/runs`, `/api/dashboard`, `/api/agents`, `/api/organizations`, `/api/notifications`) | ✅ Yes | Protected by `authenticate` middleware |

### Registration

```mermaid
sequenceDiagram
    participant Browser
    participant API as Express API
    participant DB as PostgreSQL

    Browser->>API: POST /api/auth/register { email, password, name }
    API->>DB: Check if email already exists

    alt Email already taken
        DB-->>API: User found
        API-->>Browser: 409 Conflict "Email already in use"
    else New user
        DB-->>API: No user found
        API->>DB: Hash password (bcrypt) → Create User row
        API->>DB: Create RefreshToken row (7-day expiry)
        API-->>Browser: 201 Created { accessToken, refreshToken, user }
        Note over Browser: Stores tokens in localStorage<br/>Sets Authorization header
    end
```

### Login

```mermaid
sequenceDiagram
    participant Browser
    participant API as Express API
    participant DB as PostgreSQL

    Browser->>API: POST /api/auth/login { email, password }
    API->>DB: Find user by email

    alt User not found
        API-->>Browser: 401 "Invalid credentials"
    else User found
        API->>API: bcrypt.compare(password, user.hashedPassword)
        alt Password mismatch
            API-->>Browser: 401 "Invalid credentials"
        else Password matches
            API->>DB: Create new RefreshToken row
            API-->>Browser: 200 OK { accessToken (15min), refreshToken (7d), user }
            Note over Browser: Stores tokens in localStorage
        end
    end
```

---

## 2. Building & Saving a Workflow (Unauthenticated → Authenticated)

This is the most interesting flow — a user can start building without being logged in, and the system ensures they never lose their work.

```mermaid
flowchart TD
    OPEN(["User opens /workflows/new"]) --> DRAFT_CHECK{"Draft in localStorage?<br/>(orqestr_draft_workflow)"}

    DRAFT_CHECK -->|Yes| RESTORE["Restore nodes, edges, name<br/>from saved draft<br/>Toast: 'Restored your unsaved workflow draft'"]
    DRAFT_CHECK -->|No| BLANK["Start with empty canvas"]

    RESTORE --> BUILD
    BLANK --> BUILD["User drags nodes from palette<br/>Connects edges<br/>Configures node settings"]

    BUILD --> SAVE_CLICK["User clicks 'Save Workflow'"]

    SAVE_CLICK --> AUTH_CHECK{"Is user<br/>authenticated?"}

    AUTH_CHECK -->|Yes| PERFORM_SAVE["POST /api/workflow<br/>{ name, definition }"]
    AUTH_CHECK -->|No| SNAPSHOT["Snapshot canvas to localStorage<br/>{ name, nodes, edges }<br/>key: orqestr_draft_workflow"]

    SNAPSHOT --> MODAL["Open AuthModal overlay<br/>over the canvas (no redirect!)"]

    MODAL --> AUTH_CHOICE{"User action"}

    AUTH_CHOICE -->|Register| REGISTER["POST /api/auth/register<br/>{ email, password, name }"]
    AUTH_CHOICE -->|Login| LOGIN["POST /api/auth/login<br/>{ email, password }"]
    AUTH_CHOICE -->|Close modal| BACK["Back to canvas<br/>Draft remains in localStorage"]

    REGISTER --> TOKENS["Receive accessToken + refreshToken<br/>Store in localStorage"]
    LOGIN --> TOKENS

    TOKENS --> AUTO_SAVE["AuthModal onSuccess fires<br/>→ performSave() called automatically"]

    AUTO_SAVE --> PERFORM_SAVE

    PERFORM_SAVE -->|201 Created| SUCCESS["Clear draft from localStorage<br/>Toast: 'Workflow saved successfully'<br/>Redirect to /workflows"]
    PERFORM_SAVE -->|Error| ERROR["Toast: error message<br/>Draft remains safe in localStorage"]

    style SNAPSHOT fill:#1e3a5f,stroke:#2563eb,color:#fff
    style MODAL fill:#3b0764,stroke:#7c3aed,color:#fff
    style SUCCESS fill:#065f46,stroke:#047857,color:#fff
    style ERROR fill:#7f1d1d,stroke:#991b1b,color:#fff
```

### Why this matters

Most apps redirect you to `/login` when you click save — your entire canvas state is gone. Orqestr:

1. **Saves the draft to localStorage** before showing the auth modal
2. **Shows the auth modal as an overlay** on top of the canvas (no page navigation)
3. **Automatically calls performSave()** after successful login/register
4. **Clears the draft** only after the API confirms the save succeeded
5. **Recovers the draft on reload** — if the user refreshes or navigates away, the canvas restores from localStorage on next visit

### What happens if the browser crashes after draft save?

The draft persists in `localStorage`. On next visit to `/workflows/new`, the `useEffect` hook reads `orqestr_draft_workflow`, restores the nodes/edges/name, and shows a toast notification.

---

## 3. Workflow Execution Flow

When a user clicks **"Trigger Run"** on a saved workflow:

```mermaid
sequenceDiagram
    participant Browser
    participant API as Express API
    participant Orch as Orchestrator
    participant DB as PostgreSQL
    participant Redis as BullMQ (Redis)
    participant Worker as Agent Worker
    participant LLM as Groq API
    participant Bus as RunEmitter
    participant SSE as SSE Stream Endpoint

    Browser->>API: POST /api/workflow/:id/run { input: {} }
    API->>Orch: orchestrator.triggerRun(workflowId, input, userId)

    Note over Orch: Phase 1: Setup
    Orch->>DB: Fetch WorkflowDefinition
    Orch->>DB: Create WorkflowRun (status: RUNNING)
    Orch->>DB: Create Task rows (one per node, status: PENDING)

    Note over Orch: Phase 2: Dependency Resolution
    Orch->>Orch: Build adjacency map from edges
    Orch->>DB: Update each task with dependsOn (array of task IDs)

    Note over Orch: Phase 3: Dispatch Root Tasks
    Orch->>Orch: Find nodes with zero dependencies
    Orch->>DB: Set root tasks' input = workflow input
    Orch->>Redis: addTaskToQueue(agentType, { taskId, input, config })
    Orch->>Bus: emit("run:id", { taskId, status: RUNNING })
    Bus->>SSE: push event
    SSE-->>Browser: SSE event: TASK_RUNNING

    API-->>Browser: 200 OK { runId, status: "RUNNING" }
    Browser->>SSE: GET /api/runs/:runId/stream (SSE connection)

    Note over Worker: Phase 4: Task Processing
    Redis->>Worker: Worker picks up job (acquires Redis lock)
    Worker->>DB: Mark Task -> RUNNING, increment attempts
    Worker->>DB: Mark Agent -> BUSY

    alt LLM Agent
        Worker->>Worker: interpolateTemplate(promptTemplate, input)
        Worker->>LLM: POST /chat/completions { model, messages }
        LLM-->>Worker: { choices: [{ message: { content } }] }
    else HTTP Agent
        Worker->>Worker: Make validated HTTP request
    else Transform Agent
        Worker->>LLM: POST /chat/completions (transform instructions)
        LLM-->>Worker: Structured JSON
    end

    Worker->>DB: Mark Task -> COMPLETED, save output
    Worker->>DB: Mark Agent -> ONLINE, increment tasksHandled
    Worker->>Redis: Job finished (BullMQ emits completed event)

    Note over Orch: Phase 5: Chain Propagation
    Redis->>Orch: QueueEvents "completed" listener fires
    Orch->>Bus: emit("run:id", { taskId, status: COMPLETED, output })
    Bus->>SSE: push event
    SSE-->>Browser: SSE event: TASK_COMPLETED
    Orch->>DB: Find all pending tasks
    Orch->>Orch: Check which tasks have all dependencies resolved
    Orch->>DB: Set unblocked tasks' input = previous task's output
    Orch->>Redis: Dispatch newly unblocked tasks
    Orch->>Bus: emit("run:id", { taskId, status: RUNNING })
    Bus->>SSE: push event
    SSE-->>Browser: SSE event: TASK_RUNNING

    Note over Orch: Phase 6: Run Completion
    Orch->>DB: All tasks done -> Mark WorkflowRun -> COMPLETED
    Orch->>Bus: emit("run:id", { type: RUN_COMPLETED })
    Bus->>SSE: push event
    SSE-->>Browser: SSE event: RUN_COMPLETED
    Orch->>DB: Invalidate dashboard cache
```

### How data flows between nodes

When Task A completes with an output like `{ data: { body: "Hello", user: { name: "Alice" } } }`, the orchestrator takes this entire output and sets it as the **input** for the next downstream task (Task B).

Inside Task B's agent, the template engine resolves any `{{placeholders}}` in the prompt against this input:

| Placeholder | Resolves to |
|-------------|------------|
| `{{body}}` | `"Hello"` (auto-unwraps `data.body`) |
| `{{user.name}}` | `"Alice"` (deep dot-notation traversal) |
| `{{data.body}}` | `"Hello"` (explicit path) |
| `{{input}}` | Full JSON stringified payload |

---

## 4. Task Failure & Retry Handling

```mermaid
flowchart TD
    EXECUTE["Agent executes task"] --> RESULT{"Task outcome"}

    RESULT -->|Success| COMPLETED["Mark task COMPLETED<br/>Save output to DB<br/>Dispatch downstream tasks"]

    RESULT -->|Error thrown| RETRY_CHECK{"Attempt count<br/>vs maxAttempts (3)"}

    RETRY_CHECK -->|"Attempt < 3"| RETRY["BullMQ auto-retries<br/>Exponential backoff:<br/>1s → 2s → 4s"]
    RETRY_CHECK -->|"Attempt = 3"| EXHAUSTED["All retries exhausted<br/>Task marked FAILED in DB"]

    RETRY --> EXECUTE

    EXHAUSTED --> CRITICAL_CHECK{"Is task marked<br/>as critical?"}

    CRITICAL_CHECK -->|"critical: true"| FAIL_RUN["🔴 ENTIRE RUN FAILS<br/>1. Mark WorkflowRun → FAILED<br/>2. Cancel all PENDING tasks<br/>3. Emit RUN_FAILED via SSE"]

    CRITICAL_CHECK -->|"critical: false"| CONTINUE["🟡 Run continues<br/>1. Mark this task FAILED<br/>2. Pass { error: reason } as downstream input<br/>3. Dispatch unblocked tasks<br/>4. Run may still COMPLETE"]

    style COMPLETED fill:#065f46,stroke:#047857,color:#fff
    style FAIL_RUN fill:#7f1d1d,stroke:#991b1b,color:#fff
    style CONTINUE fill:#78350f,stroke:#b45309,color:#fff
    style RETRY fill:#1e3a5f,stroke:#2563eb,color:#fff
```

### What happens at each retry attempt

| Attempt | Backoff Delay | What happens |
|---------|--------------|-------------|
| 1st try | — | Agent calls `execute()`. On error: task stays FAILED in DB, error re-thrown to BullMQ |
| 2nd try | 1 second | BullMQ moves job to delayed set, waits 1s, re-queues. Agent re-processes. `attempts` incremented to 2. |
| 3rd try | 2 seconds | Same as above. `attempts` incremented to 3. |
| Final failure | — | BullMQ moves job to failed set. Orchestrator's `QueueEvents.on("failed")` fires. Critical check runs. |

### Critical vs Non-Critical — real example

Consider a 3-node pipeline: `HTTP Agent → LLM Agent → Transform Agent`

**If LLM Agent is critical (default) and fails all 3 retries:**
- LLM Agent task → `FAILED`
- Transform Agent task → `CANCELLED` (was still `PENDING`)
- WorkflowRun → `FAILED`
- SSE emits `RUN_FAILED`

**If LLM Agent is non-critical and fails all 3 retries:**
- LLM Agent task → `FAILED`
- Transform Agent receives `{ error: "Groq API returned 429 rate limit" }` as its input
- Transform Agent still runs and tries to work with whatever it got
- WorkflowRun → `COMPLETED` (with partial failure)

---

## 5. Real-Time Monitoring via SSE

```mermaid
sequenceDiagram
    participant Browser
    participant API as Express API
    participant Emitter as RunEmitter (Singleton)
    participant Orch as Orchestrator

    Browser->>API: GET /api/runs/:runId/stream
    API->>API: Set headers: text/event-stream, no-cache, keep-alive
    API->>Browser: event: connected { runId }

    API->>Emitter: runEmitter.on("run:{runId}", listener)

    Note over Orch: During execution...

    Orch->>Emitter: emit("run:{runId}", { taskId, status: RUNNING })
    Emitter->>API: Listener fires
    API->>Browser: event: workflow-update { taskId, status: RUNNING }

    Orch->>Emitter: emit("run:{runId}", { taskId, status: COMPLETED, output })
    Emitter->>API: Listener fires
    API->>Browser: event: workflow-update { taskId, status: COMPLETED, output }

    Orch->>Emitter: emit("run:{runId}", { type: RUN_COMPLETED })
    Emitter->>API: Listener fires
    API->>Browser: event: workflow-update { type: RUN_COMPLETED }

    Note over Browser: Browser closes connection

    Browser->>API: Connection closed
    API->>Emitter: runEmitter.off("run:{runId}", listener)
    API->>API: res.end()
    Note over Emitter: Listener removed<br/>No memory leak
```

### What if the browser disconnects mid-run?

The SSE connection is cleaned up (`req.on("close")` removes the event listener), but the **run continues executing on the backend**. The run is completely independent of the SSE connection. The user can reconnect by opening the Run Monitor page again — it will fetch the current state from the database and re-establish the SSE stream.

---

## 6. Multiple Run Clicks & Concurrent Runs

### What happens if the user clicks "Trigger Run" 5 times rapidly?

```mermaid
flowchart TD
    CLICK1["Click 1: POST /api/workflow/:id/run"] --> RUN1["Creates WorkflowRun #1<br/>Creates Tasks #1a, #1b, #1c<br/>Dispatches to BullMQ"]
    CLICK2["Click 2: POST /api/workflow/:id/run"] --> RUN2["Creates WorkflowRun #2<br/>Creates Tasks #2a, #2b, #2c<br/>Dispatches to BullMQ"]
    CLICK3["Click 3: POST /api/workflow/:id/run"] --> RUN3["Creates WorkflowRun #3<br/>..."]
    CLICK4["Click 4"] --> RUN4["WorkflowRun #4"]
    CLICK5["Click 5"] --> RUN5["WorkflowRun #5"]

    RUN1 & RUN2 & RUN3 & RUN4 & RUN5 --> QUEUE["BullMQ Queues<br/>(All jobs are independent)"]

    QUEUE --> WORKERS["Agent Workers process<br/>jobs one at a time<br/>(concurrency: 1 per worker)"]

    style QUEUE fill:#533483,stroke:#e94560,color:#e0e0e0
```

**Each click creates a completely independent run.** There is no deduplication or click throttling at the API level. Each run gets:

- Its own `WorkflowRun` row with a unique `runId`
- Its own set of `Task` rows (one per node)
- Its own BullMQ jobs in the queue

The runs execute **concurrently** — all their root tasks enter the queues and workers process them in order. Since each worker has `concurrency: 1`, BullMQ processes one job at a time per worker, but multiple workers across different agent types process in parallel.

**If you want to prevent this:** The frontend can disable the "Run" button while `isPending` is true (the mutation hook's loading state), but the backend does not block multiple runs — this is by design, since batch runs and stress testing require it.

---

## 7. Token Expiration Mid-Session

```mermaid
flowchart TD
    REQUEST["User action triggers API call<br/>(e.g., save workflow, trigger run)"] --> SEND["Axios sends request<br/>Authorization: Bearer {accessToken}"]

    SEND --> RESPONSE{"Response status"}

    RESPONSE -->|200 OK| SUCCESS["✅ Request succeeded"]
    RESPONSE -->|401 Unauthorized| INTERCEPT["Axios interceptor catches 401"]

    INTERCEPT --> REFRESHING{"Is another refresh<br/>already in progress?"}

    REFRESHING -->|Yes| QUEUE_IT["Add request to refresh queue<br/>(wait for ongoing refresh)"]
    REFRESHING -->|No| START_REFRESH["Set isRefreshing = true<br/>POST /api/auth/refresh<br/>{ refreshToken from localStorage }"]

    START_REFRESH --> REFRESH_RESULT{"Refresh result"}

    REFRESH_RESULT -->|200 OK| UPDATE["Store new accessToken + refreshToken<br/>in localStorage<br/>Update Axios default header"]
    REFRESH_RESULT -->|401 Failed| LOGOUT["Clear all tokens<br/>Clear localStorage"]

    UPDATE --> REPLAY["Replay original failed request<br/>with new accessToken"]
    UPDATE --> DRAIN_QUEUE["Replay all queued requests<br/>with new token"]

    REPLAY --> SUCCESS
    DRAIN_QUEUE --> SUCCESS

    LOGOUT --> REDIRECT_CHECK{"Is user on<br/>/workflows/new or /auth/*?"}

    REDIRECT_CHECK -->|Yes| STAY["Stay on page<br/>(don't disrupt builder canvas)"]
    REDIRECT_CHECK -->|No| REDIRECT["Redirect to /auth/login<br/>?redirect={currentPath}"]

    style SUCCESS fill:#065f46,stroke:#047857,color:#fff
    style LOGOUT fill:#7f1d1d,stroke:#991b1b,color:#fff
    style STAY fill:#1e3a5f,stroke:#2563eb,color:#fff
```

### Why the builder page doesn't redirect

The Axios interceptor explicitly checks: if the current page is `/workflows/new` or any `/auth/*` page, it does **not** redirect to login. This prevents the builder from losing canvas state. Instead, the user stays on the page, and if they try to save, the AuthModal appears.

### What if 5 API calls fail simultaneously with 401?

Only the **first** failing call triggers the refresh. The other 4 are added to a `refreshQueue` array. Once the refresh completes, all 5 queued requests are replayed with the new token. This prevents 5 simultaneous refresh requests hitting the server.

---

## 8. Workflow Triggered via Webhook or Cron

### Webhook Trigger (External Service)

```mermaid
sequenceDiagram
    participant External as External Service
    participant API as Express API
    participant DB as PostgreSQL
    participant Orch as Orchestrator

    External->>API: POST /api/webhooks/trigger/:token { payload }

    API->>DB: Find Webhook by token (indexed lookup)

    alt Token not found
        API-->>External: 404 Not Found
    else Token found but webhook disabled
        API-->>External: 403 Forbidden "Webhook is disabled"
    else Valid & enabled
        API->>Orch: orchestrator.triggerRun(workflowId, payload)
        Orch->>DB: Create WorkflowRun + Tasks
        API->>DB: Update webhook.lastCalledAt
        API-->>External: 200 OK { runId }
        Note over External: Returns immediately<br/>Workflow executes async in background
    end
```

**No JWT required.** The webhook uses its own high-entropy secret token (48-char hex) for authentication, completely separate from user JWTs.

### Cron Scheduled Run

```mermaid
sequenceDiagram
    participant BullMQ as BullMQ Scheduler
    participant Worker as SchedulerWorker
    participant Orch as Orchestrator
    participant DB as PostgreSQL

    Note over BullMQ: Cron time reached<br/>(e.g., "0 9 * * *" = 9 AM daily)

    BullMQ->>Worker: Repeatable job fires
    Worker->>DB: Fetch WorkflowSchedule + input payload

    alt Schedule disabled
        Worker->>Worker: Skip (log warning)
    else Schedule active
        Worker->>Orch: orchestrator.triggerRun(workflowId, input)
        Orch->>DB: Create WorkflowRun + Tasks
        Worker->>DB: Update schedule.lastRunAt
        Note over Orch: Normal execution flow continues
    end
```

---

## 9. Stale Run Cleanup

Runs can get stuck in `RUNNING` status if a worker crashes, Redis loses a job, or a network partition occurs. The orchestrator runs a background cleanup every 5 minutes:

```mermaid
flowchart TD
    TIMER["⏰ Every 5 minutes<br/>cleanupStaleRuns()"] --> QUERY["Query: Find all WorkflowRuns where<br/>status = RUNNING<br/>AND startedAt < (now - 10 minutes)<br/>AND zero tasks are RUNNING or COMPLETED"]

    QUERY --> FOUND{"Stale runs found?"}

    FOUND -->|No| DONE["No action needed"]
    FOUND -->|Yes| CLEANUP["For each stale run:"]

    CLEANUP --> FAIL_RUN["Mark WorkflowRun → FAILED<br/>error: 'Run timed out — no task<br/>progressed for more than 10 minutes'"]
    FAIL_RUN --> CANCEL_TASKS["Mark all PENDING tasks → CANCELLED"]
    CANCEL_TASKS --> EMIT["Emit RUN_FAILED via SSE<br/>(in case anyone is watching)"]

    style TIMER fill:#1e3a5f,stroke:#2563eb,color:#fff
    style FAIL_RUN fill:#7f1d1d,stroke:#991b1b,color:#fff
```

**Why the condition checks for zero RUNNING/COMPLETED tasks:**
If at least one task is actively running or has completed, the run is making progress — it's not stale. The cleanup only catches runs where literally nothing happened for 10 minutes (e.g., all tasks are still `PENDING` and no worker ever picked them up).

---

## Complete User Journey Summary

```mermaid
flowchart TD
    A(["🌐 User visits Orqestr"]) --> B{"Has account?"}

    B -->|No| C["Register<br/>POST /api/auth/register"]
    B -->|Yes| D["Login<br/>POST /api/auth/login"]
    B -->|"Doesn't care yet"| E["Go straight to<br/>/workflows/new"]

    C --> F["✅ Authenticated<br/>Tokens stored"]
    D --> F

    E --> G["Build workflow on canvas<br/>Drag nodes, connect edges,<br/>configure prompts/URLs"]

    G --> H["Click Save"]
    H --> I{"Authenticated?"}
    I -->|Yes| J["POST /api/workflow<br/>Saved to DB"]
    I -->|No| K["Draft → localStorage<br/>AuthModal opens<br/>Login/Register in-place"]
    K --> F
    F --> J

    J --> L["Workflow saved ✅<br/>Redirect to /workflows"]

    L --> M["Click Trigger Run<br/>POST /api/workflow/:id/run"]

    M --> N["Orchestrator creates Run + Tasks<br/>Builds dependency graph<br/>Dispatches root tasks to Redis"]

    N --> O["Workers process tasks<br/>LLM calls, HTTP fetches,<br/>JSON transforms"]

    O --> P{"Task result"}

    P -->|Success| Q["Output saved<br/>Downstream tasks unblocked"]
    P -->|Failure, retries left| R["Exponential backoff retry<br/>1s → 2s → 4s"]
    P -->|Failure, critical| S["🔴 Entire run fails<br/>Pending tasks cancelled"]
    P -->|Failure, non-critical| T["🟡 Run continues<br/>Error passed downstream"]

    R --> O
    Q --> U{"All tasks done?"}
    T --> U

    U -->|Yes| V["✅ Run COMPLETED<br/>Dashboard cache invalidated"]
    U -->|No| O

    V --> W["User sees results in<br/>Run Monitor via live SSE stream"]

    style F fill:#065f46,stroke:#047857,color:#fff
    style J fill:#065f46,stroke:#047857,color:#fff
    style V fill:#065f46,stroke:#047857,color:#fff
    style S fill:#7f1d1d,stroke:#991b1b,color:#fff
    style K fill:#3b0764,stroke:#7c3aed,color:#fff
```

---

## 10. Workspace & Organization Management, Invitations & RBAC

Orqestr supports multi-tenant collaborative workspaces with strict role-based access control (`OWNER`, `ADMIN`, `MEMBER`).

```mermaid
sequenceDiagram
    participant Owner as Workspace Owner
    participant API as Express API
    participant DB as PostgreSQL
    participant Invitee as Invited User

    Owner->>API: POST /api/organizations { name: "Acme Corp" }
    API->>DB: INSERT Organization + OrganizationMember (role: OWNER)
    API-->>Owner: 201 Created { organization }

    Owner->>API: POST /api/organizations/:id/members { email: "bob@example.com", role: "MEMBER" }
    API->>DB: Verify caller is OWNER or ADMIN
    API->>DB: INSERT OrganizationMember
    API->>DB: INSERT Notification (type: "WORKSPACE_INVITE", recipient: Bob)
    API-->>Owner: 201 Created

    Note over Invitee: In-App Notification Delivery
    Invitee->>API: GET /api/notifications
    API-->>Invitee: 200 OK [ { title: "Workspace Invitation", message: "Invited to Acme Corp" } ]
    Invitee->>API: PATCH /api/notifications/:id/read
    API-->>Invitee: 200 OK

    Note over Invitee: Organization Switching
    Invitee->>API: GET /api/organizations
    API-->>Invitee: 200 OK [ Personal, Acme Corp ]
    Note over Invitee: Client stores active organization ID.<br/>Injects x-organization-id header on subsequent requests.
```

### RBAC Permissions Matrix

| Action | `OWNER` | `ADMIN` | `MEMBER` |
| :--- | :---: | :---: | :---: |
| **View Workflows & Runs** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Create & Edit Workflows** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Trigger Runs & Test Nodes** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Manage Schedules & Webhooks** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Invite Members** | ✅ Yes | ✅ Yes | ❌ No (403) |
| **Change Member Roles** | ✅ Yes | ❌ No (403) | ❌ No (403) |
| **Remove Members** | ✅ Yes | ✅ Yes (non-owners) | ❌ Only Self (Leave) |
| **Delete Workflow** | ✅ Yes | ✅ Yes | ❌ No (403 Forbidden) |
| **Delete Organization** | ✅ Yes | ❌ No (403) | ❌ No (403) |

---

## 11. OAuth Flow with Cryptographic State & One-Time Exchange

To prevent CSRF state attacks and eliminate token leakage in browser history or referer headers, Orqestr uses a cryptographic state parameter and an ephemeral single-use exchange code:

```mermaid
sequenceDiagram
    participant User as Browser
    participant API as Express Server
    participant Redis as Redis Cache
    participant OAuth as Google / GitHub
    participant DB as PostgreSQL

    User->>API: GET /api/auth/google (or /github)
    API->>API: Generate 32-byte cryptographic state
    API->>Redis: SET oauth:state:{state} = "valid" (TTL: 300s)
    API-->>User: 302 Redirect to Provider with state

    User->>OAuth: Authorize Application
    OAuth-->>API: GET /api/auth/google/callback?code=...&state=...

    API->>Redis: GET & DEL oauth:state:{state} (Atomic consumption)
    alt State missing or invalid
        API-->>User: 302 Redirect to /auth/login?error=invalid_state
    else State verified
        API->>OAuth: Exchange authorization code for profile
        API->>DB: Upsert User row
        API->>API: Generate 32-byte exchangeCode
        API->>Redis: SET oauth:exchange:{exchangeCode} = { userId } (TTL: 60s)
        API-->>User: 302 Redirect to /auth/callback?code={exchangeCode}
    end

    Note over User: Client reads ?code=... (zero tokens in URL)
    User->>API: POST /api/auth/oauth/exchange { code } (Rate limited)
    API->>Redis: GET & DEL oauth:exchange:{code}
    API->>DB: Issue RefreshToken (7d) & AccessToken (15m)
    API-->>User: 200 OK { accessToken, refreshToken, user }
    Note over User: Session resets active workspace to Personal
```

---

## 12. Advanced Workflow Builder: Node Testing, DAG Validation, Auto-Layout & Versioning

The visual workflow composition canvas integrates developer safeguards and utilities:

1. **Direct Node Testing (`POST /api/agents/test`)**:
   - Allows users to test any individual agent node (LLM inference, HTTP request, or data transformation) with mock input before saving the workflow.
   - Protected by authentication, Redis rate limiting (20 req/min), SSRF validation, and a 5MB response size limit.
2. **DAG Validation & Topological Integrity**:
   - Kahn's algorithm validates that the graph has at least one node and is completely free of cycles or self-referencing loops prior to saving or triggering.
3. **Auto-Layout (Dagre Algorithm)**:
   - One-click topological auto-layout organizes chaotic canvas nodes into clean left-to-right or top-to-bottom execution hierarchies.
4. **Undo / Redo & JSON Import / Export**:
   - History stack enables multi-level undo/redo operations on canvas state.
   - Workflows can be exported to portable JSON definitions and imported across workspaces.
5. **Workflow Version Snapshots & One-Click Restore**:
   - Every `PUT /api/workflow/:id` creates an immutable `WorkflowVersion` record.
   - Users can inspect historical versions and rollback via `POST /api/workflow/:id/versions/:version/restore`.
6. **Workflow Duplication**:
   - `POST /api/workflow/:id/duplicate` clones graph definitions into new independent blueprints.

---

## 13. Run Cancellation Flow

Users can abort long-running or runaway workflow executions directly from the UI or API:

```mermaid
sequenceDiagram
    participant User as User Browser
    participant API as Express API
    participant DB as PostgreSQL
    participant Orch as Orchestrator
    participant Bus as RunEmitter
    participant SSE as SSE Stream

    User->>API: POST /api/runs/:runId/cancel
    API->>DB: In Transaction: UPDATE WorkflowRun (status: CANCELLED)<br/>UPDATE tasks WHERE status = PENDING (status: CANCELLED)
    API->>Bus: emit("run:id", { type: RUN_CANCELLED })
    Bus->>SSE: push event
    SSE-->>User: Live Event: RUN_CANCELLED
    API-->>User: 200 OK { success: true, status: "CANCELLED" }

    Note over Orch: In-flight worker jobs may finish,<br/>but Orchestrator drops completions<br/>and skips unblocking downstream tasks.
```

---

## 14. Workflow Soft-Delete Archival & Scheduler Cleanup

When a user deletes a workflow, the system guarantees audit record preservation while cleaning up all active background jobs:

```mermaid
sequenceDiagram
    participant User as User / Workspace Admin
    participant API as Express Server
    participant DB as PostgreSQL
    participant Scheduler as SchedulerService
    participant Queue as BullMQ (Redis)

    User->>API: DELETE /api/workflow/:id
    API->>DB: Fetch workflow & verify canAccess()
    alt In Organization Workspace
        API->>DB: Verify caller role is OWNER or ADMIN
        Note over API: MEMBER receives 403 Forbidden
    end

    API->>DB: UPDATE WorkflowDefinition SET isArchived = true
    API->>Scheduler: removeRepeatableJob(workflowId)
    Scheduler->>Queue: schedulerQueue.removeRepeatableByKey(repeatableJobKey)
    Scheduler->>DB: UPDATE WorkflowSchedule SET enabled = false WHERE workflowId = :id

    API-->>User: 200 OK { success: true, message: "Workflow archived" }

    Note over DB: All historical WorkflowRuns, Tasks,<br/>and WorkflowVersions remain intact for audit.<br/>Future GET /api/workflow/:id queries return 404.
```

### Deletion Invariants:
1. **RBAC Guard**: In organization workspaces, only `OWNER` or `ADMIN` members can delete workflows (`MEMBER` receives `403 Forbidden`).
2. **Audit Preservation**: Hard deletes would cascade and delete historical runs and tasks. Soft-delete (`isArchived = true`) keeps the historical audit trail intact while removing the workflow from active listings.
3. **Automated Scheduler Purging**: The associated repeatable BullMQ cron job is immediately unregistered from Redis to prevent phantom executions of deleted workflows.
4. **Execution Prohibition**: Any attempt to trigger an archived workflow via REST (`POST /api/workflow/:id/run`) or webhook returns 404 `NotFoundError("Workflow", id)`.

