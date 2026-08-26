# Scaling Orqestr — System Design at Scale

This document explains how Orqestr's architecture would evolve to handle **10,000+ concurrent workflow runs**, **multi-region deployment**, and **enterprise-grade reliability**. Each section covers the current design, why it breaks at scale, and the production-grade solution.

---

## Current vs Scaled Architecture

### Current Architecture (Single-Process)

Everything runs in one Node.js process — the API server, orchestrator, agent workers, and SSE connections all share the same runtime. This is great for local development and small-to-medium workloads.

```mermaid
graph TB
    subgraph SINGLE_PROCESS["Single Node.js Process"]
        API["Express API"]
        ORCH["Orchestrator"]
        WORKERS["Agent Workers"]
        SSE["SSE Connections"]
    end

    BROWSER["Browser"] -->|"REST + SSE"| SINGLE_PROCESS
    SINGLE_PROCESS --> PG[("PostgreSQL")]
    SINGLE_PROCESS --> REDIS[("Redis")]
    SINGLE_PROCESS -->|"LLM Calls"| GROQ["Groq API"]

    style SINGLE_PROCESS fill:#1a1a2e,stroke:#e94560,color:#e0e0e0
```

**What breaks at scale:**
- Single process = single point of failure
- SSE connections are stateful and pinned to one server
- Orchestrator is an in-memory EventEmitter, not visible to other processes
- No way to independently scale workers vs API servers
- One slow LLM call can starve the event loop for API responses

---

### Scaled Architecture (Distributed)

```mermaid
graph TB
    subgraph EDGE["Edge / Load Balancing"]
        LB["Load Balancer<br/>(Nginx / AWS ALB)"]
        CDN["CDN<br/>(Vercel Edge / CloudFront)"]
    end

    subgraph API_TIER["API Tier (Horizontally Scaled)"]
        API1["API Server 1"]
        API2["API Server 2"]
        API3["API Server N"]
    end

    subgraph ORCH_TIER["Orchestrator Service (Isolated)"]
        ORCH1["Orchestrator 1"]
        ORCH2["Orchestrator 2"]
    end

    subgraph WORKER_POOLS["Worker Pools (Auto-Scaled)"]
        subgraph LLM_POOL["LLM Worker Pool"]
            LLM1["LLM Worker 1"]
            LLM2["LLM Worker 2"]
            LLMN["LLM Worker N"]
        end
        subgraph HTTP_POOL["HTTP Worker Pool"]
            HTTP1["HTTP Worker 1"]
            HTTP2["HTTP Worker 2"]
        end
        subgraph TRANSFORM_POOL["Transform Worker Pool"]
            TF1["Transform Worker 1"]
            TF2["Transform Worker 2"]
        end
    end

    subgraph DATA_TIER["Data Tier"]
        subgraph PG_CLUSTER["PostgreSQL Cluster"]
            PG_PRIMARY[("Primary (Writes)")]
            PG_READ1[("Read Replica 1")]
            PG_READ2[("Read Replica 2")]
        end
        subgraph REDIS_CLUSTER["Redis Cluster"]
            REDIS1[("Shard 1")]
            REDIS2[("Shard 2")]
            REDIS3[("Shard 3")]
        end
        PUBSUB["Redis Pub/Sub<br/>(Realtime Event Bus)"]
    end

    subgraph EXTERNAL["External"]
        GROQ["Groq API (Rate Limited)"]
        EXT["3rd Party APIs"]
        WEBHOOKS["Webhook Callers"]
    end

    CDN -->|"Static Assets"| BROWSER["Browser"]
    BROWSER -->|"REST"| LB
    BROWSER -->|"SSE"| LB
    WEBHOOKS -->|"POST /trigger"| LB

    LB --> API1
    LB --> API2
    LB --> API3

    API1 -->|"triggerRun()"| REDIS_CLUSTER
    API2 -->|"triggerRun()"| REDIS_CLUSTER
    API3 -->|"triggerRun()"| REDIS_CLUSTER

    API1 -->|"Subscribe"| PUBSUB
    API2 -->|"Subscribe"| PUBSUB
    API3 -->|"Subscribe"| PUBSUB

    API1 -->|"Read Queries"| PG_READ1
    API2 -->|"Read Queries"| PG_READ1
    API3 -->|"Read Queries"| PG_READ2

    API1 -->|"Write Queries"| PG_PRIMARY
    API2 -->|"Write Queries"| PG_PRIMARY
    API3 -->|"Write Queries"| PG_PRIMARY

    ORCH1 -->|"Listen QueueEvents"| REDIS_CLUSTER
    ORCH2 -->|"Listen QueueEvents"| REDIS_CLUSTER

    ORCH1 -->|"Dispatch Tasks"| REDIS_CLUSTER
    ORCH2 -->|"Dispatch Tasks"| REDIS_CLUSTER

    ORCH1 -->|"Publish SSE events"| PUBSUB
    ORCH2 -->|"Publish SSE events"| PUBSUB

    ORCH1 -->|"Read / Write"| PG_PRIMARY
    ORCH2 -->|"Read / Write"| PG_PRIMARY

    REDIS_CLUSTER --> LLM_POOL
    REDIS_CLUSTER --> HTTP_POOL
    REDIS_CLUSTER --> TRANSFORM_POOL

    LLM_POOL -->|"Chat API"| GROQ
    TRANSFORM_POOL -->|"Chat API"| GROQ
    HTTP_POOL --> EXT

    LLM_POOL -->|"Task Updates"| PG_PRIMARY
    HTTP_POOL -->|"Task Updates"| PG_PRIMARY
    TRANSFORM_POOL -->|"Task Updates"| PG_PRIMARY

    style EDGE fill:#0d2137,stroke:#16213e,color:#e0e0e0
    style API_TIER fill:#16213e,stroke:#0f3460,color:#e0e0e0
    style ORCH_TIER fill:#0f3460,stroke:#533483,color:#e0e0e0
    style WORKER_POOLS fill:#2d1b69,stroke:#e94560,color:#e0e0e0
    style DATA_TIER fill:#1a1a2e,stroke:#0f3460,color:#e0e0e0
    style EXTERNAL fill:#0d2137,stroke:#16213e,color:#e0e0e0
```

---

## Scaling Each Component

### 1. API Servers — Horizontal Scaling

**Problem**: A single Express server handles all REST + SSE connections. Under 10k concurrent runs, the event loop saturates.

**Solution**: Run N stateless API instances behind a load balancer.

```mermaid
graph LR
    LB["Load Balancer<br/>Sticky Sessions for SSE"]

    LB --> API1["API Server 1 (us-east-1a)"]
    LB --> API2["API Server 2 (us-east-1b)"]
    LB --> API3["API Server 3 (us-east-1c)"]

    API1 --> PG[("PostgreSQL Primary")]
    API2 --> PG
    API3 --> PG

    API1 --> PUBSUB["Redis Pub/Sub"]
    API2 --> PUBSUB
    API3 --> PUBSUB

    style LB fill:#533483,stroke:#e94560,color:#e0e0e0
```

**Key decisions:**
- **Sticky sessions** for SSE connections (ALB cookie affinity) so reconnects go to the same server
- API servers are stateless — any server can handle any REST request
- Health check endpoint (`GET /health`) enables auto-scaling groups to detect unhealthy instances

---

### 2. SSE — Cross-Instance Broadcasting with Redis Pub/Sub

**Problem**: `RunEmitter` is a Node.js `EventEmitter` singleton. It only exists in the process that runs the orchestrator. Other API server instances can't receive events.

**Solution**: Replace `EventEmitter` with Redis Pub/Sub. The orchestrator publishes to a Redis channel, all API servers subscribe and forward to their connected SSE clients.

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Redis as Redis Pub/Sub
    participant API1 as API Server 1
    participant API2 as API Server 2
    participant Browser1 as Browser (on API1)
    participant Browser2 as Browser (on API2)

    Orch->>Redis: PUBLISH run:{runId} { taskId, status }

    Redis-->>API1: Message on run:{runId}
    Redis-->>API2: Message on run:{runId}

    API1-->>Browser1: SSE event: task_completed
    API2-->>Browser2: SSE event: task_completed

    Note over Redis: All API servers receive all<br/>events. Each filters for its<br/>connected SSE clients.
```

**What changes in code:**
```
// Current (single-process)
runEmitter.emit(`run:${runId}`, event);

// Scaled (distributed)
redis.publish(`run:${runId}`, JSON.stringify(event));
```

---

### 3. Orchestrator — Isolated Service with Distributed Locking

**Problem**: The orchestrator currently runs inside the API server process. At scale, it needs to be a dedicated service that can run multiple instances without double-dispatching tasks.

**Solution**: Extract orchestrator into its own process. Use Redis distributed locks (`SETNX`) to ensure only one orchestrator instance processes a given run's completion event.

```mermaid
graph TB
    subgraph ORCH_CLUSTER["Orchestrator Cluster"]
        O1["Orchestrator 1"]
        O2["Orchestrator 2"]
    end

    subgraph LOCKING["Redis Distributed Lock"]
        LOCK["SETNX run:{runId}:lock<br/>TTL: 30s"]
    end

    EVENTS["QueueEvents<br/>completed signal"] --> O1
    EVENTS --> O2

    O1 -->|"Try acquire lock"| LOCK
    O2 -->|"Try acquire lock"| LOCK

    LOCK -->|"Lock acquired"| O1
    LOCK -->|"Lock denied"| O2

    O1 -->|"Dispatch next tasks"| QUEUE["BullMQ"]
    O2 -->|"Skip (lock held)"| SKIP["No-op"]

    style ORCH_CLUSTER fill:#0f3460,stroke:#533483,color:#e0e0e0
    style LOCKING fill:#533483,stroke:#e94560,color:#e0e0e0
```

**Why not partition by runId instead?**
Partitioning (e.g., consistent hashing of runId to orchestrator instance) is more efficient but adds complexity around rebalancing when instances join or leave. Distributed locking is simpler and correct for this throughput range.

**Current Invariant Foundation (Implemented in Code):**
Even within the current architecture, critical distributed invariants are enforced at the database and queue layer:
- **Atomic Task Claiming**: Before queueing downstream tasks in multi-parent fan-in scenarios, `dispatchUnblockedTasks` uses `prisma.task.updateMany({ where: { id, status: PENDING }, data: { status: RUNNING } })`. Sibling parent completion loops that see `count === 0` exit immediately.
- **Queue-Level Deduplication**: BullMQ jobs are submitted with `{ jobId: task.id }`, ensuring Redis rejects duplicate job insertions.
- **Queue Insertion Compensation**: If BullMQ throws during insertion, task status reverts to `PENDING` to avoid permanently orphaned tasks.
- **Status Guards & Atomic Finalization**: `onTaskCompleted` respects terminal run states (`FAILED` / `CANCELLED`), and finalizes successful runs via atomic conditional update on `RUNNING` status.

---

### 4. Worker Pools — Independent Auto-Scaling

**Problem**: All agent workers run in the API server process. An LLM call that takes 5 seconds blocks nothing thanks to async, but 1000 concurrent LLM calls saturate the Groq rate limit and starve HTTP workers.

**Solution**: Run each agent type as a separate deployable pool with independent scaling policies.

```mermaid
graph TB
    subgraph SCALING["Auto-Scaling Configuration"]
        direction LR
        LLM_SCALE["LLM Pool<br/>Scale on: queue depth > 50<br/>Min: 2, Max: 20<br/>Concurrency: 5/worker"]
        HTTP_SCALE["HTTP Pool<br/>Scale on: queue depth > 100<br/>Min: 1, Max: 10<br/>Concurrency: 20/worker"]
        TRANSFORM_SCALE["Transform Pool<br/>Scale on: queue depth > 50<br/>Min: 1, Max: 10<br/>Concurrency: 5/worker"]
    end

    REDIS[("Redis Cluster")] --> LLM_SCALE
    REDIS --> HTTP_SCALE
    REDIS --> TRANSFORM_SCALE

    LLM_SCALE -->|"Groq API (rate limited)"| GROQ["Groq"]
    HTTP_SCALE -->|"REST calls"| EXT["External APIs"]
    TRANSFORM_SCALE -->|"Groq API"| GROQ

    style SCALING fill:#2d1b69,stroke:#e94560,color:#e0e0e0
```

**Key insight**: LLM workers are rate-limited by the provider (Groq). Scaling beyond the rate limit just wastes containers. Use BullMQ's `limiter: { max: 100, duration: 60000 }` to cap throughput per queue.

---

### 5. Database — Read Replicas & Connection Pooling

**Problem**: A single PostgreSQL instance handles all reads and writes. Dashboard queries (`COUNT`, `GROUP BY`) compete with task status updates.

**Solution**:

```mermaid
graph TB
    subgraph WRITES["Write Path"]
        API_W["API Servers"]
        ORCH_W["Orchestrators"]
        WORKER_W["Workers"]
    end

    subgraph READS["Read Path"]
        API_R["API Servers (Dashboard, Lists)"]
        MONITOR["SSE / Run Monitor"]
    end

    WRITES -->|"INSERT, UPDATE"| PRIMARY[("Primary PostgreSQL")]
    PRIMARY -->|"Streaming Replication"| REPLICA1[("Read Replica 1")]
    PRIMARY -->|"Streaming Replication"| REPLICA2[("Read Replica 2")]

    READS --> REPLICA1
    READS --> REPLICA2

    POOL["PgBouncer Connection Pooler"] --> PRIMARY
    POOL --> REPLICA1
    POOL --> REPLICA2

    API_W --> POOL
    ORCH_W --> POOL
    WORKER_W --> POOL
    API_R --> POOL
    MONITOR --> POOL

    style WRITES fill:#0f3460,stroke:#533483,color:#e0e0e0
    style READS fill:#16213e,stroke:#0f3460,color:#e0e0e0
```

**Prisma configuration for read replicas:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")          // Primary (writes)
  directUrl = env("DATABASE_DIRECT_URL")  // Direct connection (migrations)
}
```

---

### 6. Multi-Tenant Fairness — Noisy Neighbor Prevention

**Problem**: Tenant A schedules 5,000 workflows. Tenant B's single interactive run waits behind 5,000 jobs.

**Solution**: Tenant-aware queue management with priority lanes and concurrency caps.

```mermaid
graph TB
    subgraph INGRESS["Incoming Runs"]
        INTERACTIVE["Interactive Runs (User clicked Run)"]
        CRON["Cron / Scheduled Runs"]
        WEBHOOK["Webhook Triggers"]
    end

    subgraph PRIORITY["Priority Queue System"]
        HIGH["HIGH Priority Queue (Interactive)"]
        DEFAULT["DEFAULT Priority Queue (Cron, Webhooks)"]
    end

    subgraph TENANT_LIMITS["Per-Tenant Limits"]
        COUNTER["Redis Counter (tenant:id:active_tasks)"]
        LIMIT["Concurrency Cap (Free: 10, Pro: 100)"]
    end

    INTERACTIVE -->|"priority: 1"| HIGH
    CRON -->|"priority: 10"| DEFAULT
    WEBHOOK -->|"priority: 5"| DEFAULT

    HIGH --> WORKERS["Worker Pool"]
    DEFAULT --> WORKERS

    WORKERS --> COUNTER
    COUNTER -->|"Check limit"| LIMIT
    LIMIT -->|"Under limit"| EXECUTE["Execute Task"]
    LIMIT -->|"Over limit"| DEFER["Delay & Re-queue"]

    style INGRESS fill:#0d2137,stroke:#16213e,color:#e0e0e0
    style PRIORITY fill:#533483,stroke:#e94560,color:#e0e0e0
    style TENANT_LIMITS fill:#0f3460,stroke:#533483,color:#e0e0e0
```

---

### 7. Redis — Cluster Mode for Queue Scalability

**Problem**: Single Redis instance is a bottleneck and single point of failure.

**Solution**: Redis Cluster with multiple shards. BullMQ natively supports Redis Cluster — queues are distributed across shards by key hashing.

```mermaid
graph LR
    subgraph CLUSTER["Redis Cluster (6 nodes)"]
        subgraph SHARD1["Shard 1"]
            M1["Master (Slots 0-5460)"]
            R1["Replica"]
        end
        subgraph SHARD2["Shard 2"]
            M2["Master (Slots 5461-10922)"]
            R2["Replica"]
        end
        subgraph SHARD3["Shard 3"]
            M3["Master (Slots 10923-16383)"]
            R3["Replica"]
        end
    end

    M1 --> R1
    M2 --> R2
    M3 --> R3

    BULLMQ["BullMQ Clients"] --> CLUSTER

    style CLUSTER fill:#533483,stroke:#e94560,color:#e0e0e0
```

**Persistence**: Enable `RDB` snapshots + `AOF` (Append-Only File) to survive Redis restarts without losing queued jobs:
```conf
save 900 1
save 300 10
appendonly yes
appendfsync everysec
```

---

## Summary: Scaling Decision Matrix

| Component | Current Implementation | Proposed Scale-Out Architecture | Why & Trade-Off |
| :--- | :--- | :--- | :--- |
| **API Server** | 1 process | $N$ stateless instances + Load Balancer | Horizontal scaling, fault isolation; requires external session handling (already stateless JWT). |
| **Orchestrator** | In-process | Dedicated service + Redis locks | Prevents double-dispatch, independent scaling; adds Redis distributed locking overhead. |
| **Agent Workers** | In-process | Per-type auto-scaling pools | Rate limit isolation, independent scaling policies; more container processes to manage. |
| **SSE / Real-time** | EventEmitter singleton | Redis Pub/Sub fanout | Cross-instance event broadcasting; requires client REST initial sync due to lack of replay buffer. |
| **PostgreSQL** | Single instance | Primary + Read Replicas + PgBouncer | Separate read/write paths, connection pooling; read replica replication lag (< 100ms). |
| **Redis** | Single instance | Redis Cluster (3 shards + replicas) | High availability, horizontal throughput, persistence; requires Redis Cluster-aware client tooling. |
| **Scheduling** | BullMQ Repeatables | Same (distributed by design) | Already singleton-safe across replicas via Redis sorted sets. |
| **Multi-Tenancy** | Shared DB + organizationId | Same + priority queues + concurrency caps | Prevents noisy neighbors from exhausting queues. |

---

## Growth Scenarios: Deep System Evolution Analysis

The following sections analyze how the system accommodates scale across four distinct growth axes:

### Scenario A — More Users (1K → 10K → 100K → 1M Users)

When user counts scale from early adoption to enterprise levels, the pressure falls primarily on the **Edge Ingress**, **Authentication**, and **Read-Heavy Query Paths**:

1. **Stateless API Tier & Load Balancing**:
   - At 1K users, a single Node.js process easily handles inbound traffic.
   - At 100K+ users, deploy a stateless cluster of Express containers behind an Application Load Balancer (AWS ALB / Cloudflare).
   - Traffic distribution uses round-robin for REST APIs and IP/cookie hash sticky sessions for long-lived SSE connections.
2. **Authentication & Session Scalability**:
   - Because access tokens are **stateless JWTs (15-minute TTL)**, API servers verify them locally using public/private key pairs or HMAC secrets with **zero database queries per authenticated request**.
   - Database lookups occur only during token refresh (once every 15 minutes per active client) and login/logout.
   - At 1M users, refresh token lookups in PostgreSQL are accelerated by the `refresh_tokens(token)` unique index and `refresh_tokens(expiresAt)` cleanup index. An automated nightly cron purges expired tokens to maintain small table size.
3. **Database Connection Pooling**:
   - 1M users generating concurrent requests would quickly exhaust PostgreSQL's `max_connections` limit (typically 100–300).
   - Deploy **PgBouncer** in transaction pooling mode. PgBouncer multiplexes 10,000+ client connections down to ~50 persistent backend database connections.
4. **Cache-Aside Read Protection**:
   - Users repeatedly poll dashboard metrics and workflow lists.
   - `CacheService` caches aggregated dashboard stats and workflow definitions in Redis with targeted 60s–300s TTLs, reducing database load by over 85%.

---

### Scenario B — More Workflows (1K → 50K → 1M Workflow Definitions)

Scaling the volume of stored workflow blueprints impacts database storage, query indexing, and version history:

1. **PostgreSQL Indexing & Query Patterns**:
   - Workflows are partitioned logically by tenancy using composite indexes:
     - `@@index([organizationId])`: Fast filtering for organization workspaces.
     - `@@index([userId])`: Fast filtering for personal workspaces.
     - `@@index([isArchived])`: Excludes soft-deleted workflows from active dashboard listings without table scans.
2. **Visual Graph Storage (`JSONB`)**:
   - Each workflow definition stores React Flow nodes and edges as `JSONB`. Average graph size is 10 KB–50 KB.
   - 1M workflows require approximately 30 GB–50 GB of storage, which easily fits within standard SSD volumes.
   - PostgreSQL's TOAST (The Oversized-Attribute Storage Technique) transparently compresses JSONB payloads > 2 KB out-of-line.
3. **Historical Version Pruning & Cold Archival**:
   - Every `PUT /api/workflow/:id` creates an immutable `WorkflowVersion` row.
   - If workflows update frequently, version tables can balloon to tens of millions of rows.
   - **Scale Strategy**: Implement an automated archival policy. Active versions (last 10 versions) remain in PostgreSQL. Older versions (> 90 days) are archived into cold S3 object storage as compressed JSON files, referenced by an S3 URI.

---

### Scenario C — More Workflow Executions (100 → 1,000 → 10,000 → 100,000 Runs/Min)

This is the most critical scaling axis. High execution throughput strains the task queue, worker concurrency, and database write throughput:

1. **BullMQ Queue Sharding & Redis Memory Management**:
   - Ingesting 100,000 runs/minute with 5 tasks per run generates **500,000 tasks/minute (~8,333 tasks/sec)**.
   - A single Redis instance caps around 25,000 operations/sec. 8,333 tasks/sec (with push, pop, lock renewal, and completion events) exceeds single-thread Redis limits.
   - **Scale Strategy**: Deploy **Redis Cluster** with slot hash-tagging. Partition queues by agent type (`{llm}:queue`, `{http}:queue`, `{transform}:queue`) so that jobs are evenly distributed across independent Redis shards.
2. **Dedicated, Auto-Scaled Worker Fleets**:
   - Separate worker pools prevent slow LLM tasks from starving fast HTTP or Transform tasks.
   - **LLM Fleet**: Concurrency tuned to provider rate limits (e.g. Groq TPM/RPM). Auto-scales on queue latency.
   - **HTTP Fleet**: High concurrency (20–50 concurrent requests per worker container) because I/O wait times are low.
   - **Transform Fleet**: In-memory JSON manipulation workers scaling on CPU utilization.
3. **Queue Backpressure & Concurrency Throttling**:
   - Use BullMQ's built-in queue rate limiters: `limiter: { max: 500, duration: 60000 }` to avoid overwhelming external LLM APIs with HTTP 429 errors.
   - Jobs exceeding the threshold remain in BullMQ's `delayed` sorted set and are pulled as capacity clears.
4. **Idempotency & Deduplication at Scale**:
   - Downstream tasks are pushed with `{ jobId: task.id }` ensuring Redis rejects accidental duplicate job submissions.
   - Terminal status guards and atomic database claiming (`updateMany`) guarantee that even under extreme concurrency, tasks execute at-least-once with idempotent database state transitions.

---

### Scenario D — Global Enterprise Tier (Concurrent Users + High Executions)

When both high user traffic and massive execution volume occur simultaneously:

```mermaid
graph TB
    subgraph INGRESS_LAYER["Global Ingress & Edge"]
        CF["Cloudflare Edge (WAF, DDoS, SSL)"]
        ALB["AWS Application Load Balancer"]
    end

    subgraph API_TIER["Stateless API Fleet (Horizontally Scaled)"]
        API1["API Node 1"]
        API2["API Node 2"]
        APIN["API Node N"]
    end

    subgraph EVENT_BUS["Realtime Event Distribution"]
        REDIS_PUBSUB["Redis Pub/Sub Cluster (Channel per runId)"]
    end

    subgraph QUEUE_TIER["Distributed Queues & Schedulers"]
        REDIS_CLUS["Redis Cluster (6 Shards: 3 Master + 3 Replica)"]
    end

    subgraph WORKER_FLEETS["Dedicated Auto-Scaled Worker Pools"]
        LLM_PODS["LLM Worker Fleet (K8s HPA)"]
        HTTP_PODS["HTTP Worker Fleet (K8s HPA)"]
        TF_PODS["Transform Worker Fleet (K8s HPA)"]
    end

    subgraph DATA_STORAGE["Data Storage & Persistence"]
        PGBOUNCER["PgBouncer Connection Poolers (Master & Replica)"]
        PG_MASTER[("PostgreSQL Primary (Multi-AZ Writes)")]
        PG_REPLICA[("PostgreSQL Read Replicas (Dashboard Reads)")]
        S3_COLD[("AWS S3 Cold Storage (Archived Runs & Versions)")]
    end

    CF --> ALB
    ALB --> API1 & API2 & APIN

    API1 & API2 & APIN --> REDIS_CLUS
    API1 & API2 & APIN --> REDIS_PUBSUB
    API1 & API2 & APIN --> PGBOUNCER

    REDIS_CLUS --> LLM_PODS & HTTP_PODS & TF_PODS
    LLM_PODS & HTTP_PODS & TF_PODS --> PGBOUNCER
    LLM_PODS & HTTP_PODS & TF_PODS --> REDIS_PUBSUB

    PGBOUNCER --> PG_MASTER
    PGBOUNCER --> PG_REPLICA
    PG_MASTER -.->|"Streaming Replication"| PG_REPLICA
    PG_MASTER -.->|"Nightly Archive Worker"| S3_COLD

    style INGRESS_LAYER fill:#0d2137,stroke:#16213e,color:#e0e0e0
    style API_TIER fill:#16213e,stroke:#0f3460,color:#e0e0e0
    style EVENT_BUS fill:#533483,stroke:#e94560,color:#e0e0e0
    style QUEUE_TIER fill:#533483,stroke:#e94560,color:#e0e0e0
    style WORKER_FLEETS fill:#2d1b69,stroke:#e94560,color:#e0e0e0
    style DATA_STORAGE fill:#1a1a2e,stroke:#0f3460,color:#e0e0e0
```

---

## Capacity Reasoning & Illustrative Calculations

*(The calculations below represent illustrative capacity planning assumptions designed for system-design interview discussions, not empirical benchmark measurements)*

### 1. Throughput & Load Assumptions
* **Active User Base**: 100,000 registered users; 2,000 peak concurrent active sessions.
* **Workflow Workload**:
  - 200 concurrent workflow runs in progress at any given second.
  - Average workflow structure: 5 nodes (1 HTTP fetch, 2 parallel LLM analyses, 1 transform, 1 notification).
  - Average run duration: 3 seconds.

### 2. Derived System Demands
* **Run Trigger Rate**:
  $$\text{Runs/sec} = \frac{200 \text{ concurrent runs}}{3 \text{ seconds}} \approx 67 \text{ runs/sec}$$
* **Task Throughput**:
  $$\text{Tasks/sec} = 67 \text{ runs/sec} \times 5 \text{ tasks/run} = 335 \text{ tasks/sec}$$
* **Redis Operations/Sec**:
  - Each task generates: 1 queue push + 1 worker pop + 2 lock heartbeats + 1 completion ack = 5 ops.
  - Plus 67 run status events published over Pub/Sub.
  $$\text{Redis Ops/sec} = (335 \times 5) + 67 \approx 1,742 \text{ ops/sec}$$
  *(A single Redis instance easily handles 25,000–50,000 ops/sec; this consumes < 7% of a single node's capacity).*
* **PostgreSQL Write Throughput**:
  - Run record: 1 insert (start) + 1 update (finish) = 134 writes/sec.
  - Task records: 5 inserts (start) + 5 updates (finish) $\times 67 = 670$ writes/sec.
  $$\text{Total DB Writes/sec} \approx 804 \text{ writes/sec}$$
  *(Standard PostgreSQL on an AWS RDS `db.r6g.xlarge` instance supports 3,000–5,000 writes/sec with PgBouncer).*
* **SSE Concurrent Connections**:
  - 2,000 concurrent active users watching live runs = 2,000 open HTTP sockets.
  - Event loop overhead: Each open socket consumes ~10 KB of memory in Node.js. 2,000 sockets $\approx 20\text{ MB}$, well within standard container memory limits (512 MB–1 GB).

---

## Bottleneck Evolution: What Fails First?

In a system design interview, identifying **which component bottlenecks first and why** demonstrates senior architectural judgment:

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 BOTTLENECK BOTTLENECK PRIORITY HIERARCHY                          │
├─────┬──────────────────────────┬─────────────────────────────┬────────────────────────────────────┤
│ Tier│ Component                │ Breaking Point              │ Root Cause & Mitigation            │
├─────┼──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 1st │ External LLM Provider    │ ~50–100 req/sec             │ Rate limits (Groq TPM/RPM caps).   │
│     │ (Groq / OpenAI)          │                             │ Mitigate with queue rate-limiters  │
│     │                          │                             │ and multi-provider fallback.       │
├─────┼──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 2nd │ PostgreSQL Connections   │ ~100–300 connections        │ Direct worker connections exhaust  │
│     │                          │                             │ pool. Mitigate with PgBouncer.     │
├─────┼──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 3rd │ In-Memory SSE Broadcast  │ Multi-server deployment     │ Node EventEmitter is single-host.  │
│     │                          │                             │ Mitigate with Redis Pub/Sub.       │
├─────┼──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 4th │ Single Redis Memory/CPU  │ ~25,000 ops/sec             │ Redis queue and sorted set I/O.    │
│     │                          │                             │ Mitigate with Redis Cluster.       │
├─────┼──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 5th │ Node.js Event Loop       │ ~1,000 req/sec per node     │ Heavy JSON stringification.        │
│     │                          │                             │ Mitigate with ALB + auto-scaling.  │
└─────┴──────────────────────────┴─────────────────────────────┴────────────────────────────────────┘
```
