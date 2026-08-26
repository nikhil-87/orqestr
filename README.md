![Orqestr](./preview.png)

# Orqestr

<div align="center">

[![Live Web App](https://img.shields.io/badge/Live_App-orqestr--client.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://orqestr-client.vercel.app/)
[![API Docs](https://img.shields.io/badge/Swagger_API_Docs-Interactive-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)](https://orqestr-api.onrender.com/api/docs)
[![API Health](https://img.shields.io/badge/API_Health-Live-46a2f1?style=for-the-badge&logo=render&logoColor=white)](https://orqestr-api.onrender.com/health)

</div>

> 🚀 **Live Deployments**:
> - **Web Application**: [https://orqestr-client.vercel.app](https://orqestr-client.vercel.app/)
> - **Interactive Swagger API Docs**: [https://orqestr-api.onrender.com/api/docs](https://orqestr-api.onrender.com/api/docs)
> - **Backend Health Check**: [`GET https://orqestr-api.onrender.com/health`](https://orqestr-api.onrender.com/health)

A distributed multi-agent workflow platform where AI agents work together asynchronously to run multi-step pipelines. Built with Next.js, Express, BullMQ, Redis, PostgreSQL (via Prisma), and Groq for ultra-fast LLM inference.

I built Orqestr because chaining AI models and API calls synchronously gets messy fast. Orqestr lets you visually connect agents on a canvas, passes data between them automatically, runs tasks across distributed queues with retries, and streams execution progress live to your browser in real time.

---

## ⚡ Tech Stack

* **Frontend**: Next.js 16 (App Router, Turbopack), React 19, React Flow (`@xyflow/react`), TailwindCSS, Lucide Icons, TanStack React Query (`@tanstack/react-query` & Devtools), Axios
* **Backend**: Node.js, Express, TypeScript, Winston Logger, Swagger UI (`swagger-ui-express`)
* **Queue & Background Jobs**: BullMQ on Redis
* **Database**: PostgreSQL (tested with Neon Cloud & local Postgres) via Prisma ORM
* **AI Provider**: Groq Cloud API (defaulting to `openai/gpt-oss-120b` and `openai/gpt-oss-20b`)
* **Testing**: Vitest (373 unit & integration tests across server and client)

---

## 🏗️ Architecture & How It Works

> **System Design Master Doc**: See [`docs/system-design.md`](docs/system-design.md) for the complete engineering design (problem motivation, functional/non-functional requirements, data ownership, failure handling, security, and component trade-offs).
>
> **Detailed diagrams**: See [`docs/architecture.md`](docs/architecture.md) for Mermaid-based system diagrams (component overview, execution sequence, agent lifecycle, database ERD, and queue retry flow).
>
> **Scaling design**: See [`docs/scaling.md`](docs/scaling.md) for how the architecture evolves to handle 10,000+ concurrent workflow runs.
>
> **End-to-end flows**: See [`docs/user-flows.md`](docs/user-flows.md) for complete user journeys covering auth, draft persistence, execution, retries, failure handling, and every edge case.

```mermaid
graph LR
    A["🖥️ Next.js<br/>Canvas + SSE Monitor"] -->|REST / SSE| B["⚙️ Express API<br/>Auth · Workflows · Runs"]
    B -->|triggerRun| C["🎯 Orchestrator<br/>DAG Resolution"]
    C -->|Dispatch Tasks| D["📨 BullMQ<br/>Redis Queues"]
    D --> E["🤖 LLM Agent"]
    D --> F["🤖 HTTP Agent"]
    D --> G["🤖 Transform Agent"]
    E -->|Results| H[("🗄️ PostgreSQL")]
    F -->|Results| H
    G -->|Results| H
    C -->|Live Events| I["📡 SSE Stream"]
    I -->|Real-time| A
```

1. **Build**: Drag and connect agent nodes on the canvas. Configure their prompts or HTTP endpoints.
2. **Execute**: Trigger a run with an optional JSON payload.
3. **Orchestrate**: The orchestrator builds a dependency graph, creates database records for the run and its tasks, and pushes unblocked tasks to BullMQ queues.
4. **Process**: Distributed agent workers pull jobs from Redis, execute them, save results to Postgres, and report heartbeats.
5. **Stream**: As tasks finish, the orchestrator pipes their output into downstream node prompts and pushes live updates to the frontend via Server-Sent Events (SSE).

---

## 🚀 Features

### 1. Visual Workflow Builder
* **Interactive Canvas**
  * Drag-and-drop agent nodes with customizable inputs and labels
  * Connect ports with directional edges to create complex DAG (Directed Acyclic Graph) pipelines
  * Mark nodes as **Critical** (fails the whole run if the node fails) or non-critical (skips and continues)
* **Node Configuration Panel**
  * **LLM Agent**: Model selector (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`), temperature, max tokens, and prompt template
  * **HTTP Agent**: URL, HTTP method (`GET`, `POST`, `PUT`, `DELETE`), custom headers JSON, and body JSON
  * **Transform Agent**: Plain English description of the desired output JSON schema
  * **Inline Variables Guide**: Toggleable in-app guide explaining placeholder syntax directly above inputs
* **Zero-Data-Loss Draft Persistence**
  * Automatically serializes canvas state to `localStorage` (`orqestr_draft_workflow`)
  * Anonymous workflow creation: Build without logging in; clicking Save opens an in-context auth modal that signs you in and saves immediately without wiping the canvas
  * Automatic draft recovery on reload

### 2. Multi-Agent Worker Ecosystem
* **Groq LLM Agent (`LLM_AGENT`)**
  * High-speed inference using fast open-source models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`)
  * Dynamic prompt variable interpolation before execution
* **HTTP Agent (`HTTP_AGENT`)**
  * Calls any external REST API with dynamic headers and interpolated request bodies
  * Returns response data, status code, and response headers
* **Transform Agent (`TRANSFORM_AGENT`)**
  * Takes messy LLM outputs or unstructured data and transforms them into clean, structured JSON matching your target schema
  * Built-in Markdown code block stripping and robust JSON parsing
* **BaseAgent Architecture**
  * Extensible abstract class using the Template Method pattern
  * Automated task lifecycle management (queue listening, status updating, error handling)
  * Periodic 30-second heartbeat reporting to PostgreSQL for live health monitoring

### 3. Smart Prompt Template & Data Binding Engine
* **Direct Property Resolution**: `{{propertyName}}` pulls top-level properties from upstream task outputs
* **Automatic Wrapper Fallback**: When an HTTP Agent returns `{ data: { body: "..." } }`, writing `{{body}}` automatically resolves to `data.body`
* **Deep Dot-Notation Paths**: Access nested objects easily (e.g. `{{user.fullName}}`, `{{user.address.city}}`)
* **Universal Wildcard (`{{input}}`)**: Injects the entire upstream task output formatted as a JSON string

### 4. Real-Time Observability & Run Monitor
* **Live SSE Streaming**: Unidirectional streaming over `/api/runs/:runId/stream` with automatic reconnection and clean listener teardown on disconnect
* **Interactive Run Canvas**: Real-time node status colors (Pending, Running, Completed, Failed)
* **Step Inspector Panel**: Click any node on the Run Monitor canvas to view its exact incoming input payload and outgoing output JSON

### 5. Authentication & Multi-Tenancy
* **Dual-Token JWT System**: 15-minute access tokens + 7-day refresh tokens
* **Environment-Aware Cookies**: Configured with `sameSite: "lax"` and local HTTP support so token refresh works seamlessly across `localhost:3000` and `localhost:8000`
* **Silent Token Refresh**: Axios response interceptor queues concurrent requests during refresh and retries them automatically without session drops
* **Cross-Tab Synchronization**: Uses `storage` events so logging in or out in one tab updates all other open tabs immediately
* **Multi-Tenant Workspaces & RBAC**: In-app workspace switcher, organization creation, team invitations, and role-based permissions (`OWNER`, `ADMIN`, `MEMBER`) with query-cache tenant isolation

### 6. Workflow Versioning, Cron & Webhooks
* **Full Snapshot Versioning**: Every workflow update creates an immutable snapshot record in `WorkflowVersion`, enabling one-click rollbacks
* **BullMQ Repeatable Cron Jobs**: Schedule recurring workflows with standard cron expressions and automatic timezone handling
* **Inbound Webhook Triggers**: Trigger workflows externally using high-entropy secret tokens without requiring user authentication

### 7. Developer Experience & Docs
* **Interactive API Documentation**: Swagger / OpenAPI 3.0 UI available at `http://localhost:8000/api/docs`
* **Health Endpoint**: `GET /health` for container orchestration checks
* **Test Suite**: 373 unit & integration tests covering the engine, agents, templates, auth, schedulers, organizations, and security logging

---

## 📁 Project Structure

```
Orqestr/
├── client/                         # Next.js 16 Frontend
│   ├── app/                        # App router (Builder, Monitor, Dashboard, Auth)
│   ├── components/                 # UI, visual canvas, node types, auth modals
│   ├── hooks/                      # Custom hooks (SSE stream, mutations, queries)
│   ├── lib/                        # Axios instance, types, utility helpers
│   └── providers/                  # AuthProvider, ReactFlowProvider
├── server/                         # Express Backend & Workers
│   ├── __tests__/                  # 262 Vitest unit & integration tests
│   ├── agents/                     # Agent implementations (LLM, HTTP, Transform)
│   ├── api/                        # Modular REST API routes, controllers, services
│   ├── config/                     # Typed environment variables & clients
│   ├── events/                     # RunEmitter event bus for SSE
│   ├── middleware/                 # Auth, organization, logging, error handlers
│   ├── orchestrator/               # Workflow execution & dependency engine
│   ├── prisma/                     # Database schema & migrations
│   ├── queues/                     # BullMQ queue & worker configurations
│   ├── swagger/                    # OpenAPI 3.0 definitions
│   └── utils/                      # Template interpolation, errors, helpers
├── docs/                           # Public documentation
│   ├── system-design.md            # Comprehensive system design document
│   ├── architecture.md             # System architecture diagrams (Mermaid)
│   ├── scaling.md                  # Scaling design & distributed architecture
│   ├── user-flows.md               # End-to-end user journeys & edge cases
│   └── running-locally.md          # Full local setup guide
├── docker-compose.yml              # Local infrastructure definition
├── package.json                    # Root workspace package.json
└── pnpm-workspace.yaml             # pnpm workspace configuration
```

---

## 🛠️ Quickstart: Running Locally

> For the full step-by-step guide with troubleshooting, see [`docs/running-locally.md`](docs/running-locally.md).

### Prerequisites
* **Node.js**: v20 or higher
* **pnpm**: v8 or higher (`npm i -g pnpm`)
* **Docker**: For running Redis locally
* **PostgreSQL Database**: Either a free cloud [Neon Database](https://neon.tech) (recommended for zero local DB hassle) or local Postgres
* **Groq API Key**: Free API key from [console.groq.com](https://console.groq.com)

---

### Step 1: Environment Variables

**1. Create `server/.env`:**
```env
PORT=8000

# Database URL (Neon connection string or local postgres)
DATABASE_URL=postgresql://user:password@ep-your-subdomain.us-east-2.aws.neon.tech/neondb?sslmode=require

# Local Docker Redis
REDIS_URL=redis://localhost:6379

# Client URL (for CORS)
CLIENT_URL=http://localhost:3000

# Groq AI Key & Model
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b

# JWT Secrets (generate any random strings)
JWT_SECRET=super_secret_jwt_access_key_12345
JWT_REFRESH_SECRET=super_secret_jwt_refresh_key_12345
```

**2. Create `client/.env.local`:**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

### Step 2: Start Redis

Start Redis in a lightweight Docker container:

```bash
docker run -d --name agent_platform_redis -p 6379:6379 redis:7-alpine
```

---

### Step 3: Install Dependencies & Sync Database

```bash
# 1. Install all dependencies
pnpm install

# 2. Push schema to database and generate Prisma client
cd server
pnpm prisma db push
pnpm prisma generate
cd ..
```

---

### Step 4: Run the App

Start both the backend server and frontend client concurrently:

```bash
pnpm dev
```

* **Frontend**: `http://localhost:3000`
* **Backend API**: `http://localhost:8000`
* **Swagger Docs**: `http://localhost:8000/api/docs`
* **Health Check**: `http://localhost:8000/health`

---

## 🧪 Try a Sample Multi-Agent Workflow

1. Go to **`http://localhost:3000/workflows/new`**.
2. Build a 3-step customer support triaging pipeline:
   * **Step 1 — HTTP Agent**:
     * **URL**: `https://dummyjson.com/comments/1`
     * **Method**: `GET`
   * **Step 2 — LLM Agent**:
     * **Model**: `openai/gpt-oss-120b`
     * **Prompt Template**:
       ```
       Analyze this customer feedback and identify the sentiment and urgency:
       Comment: {{body}}
       ```
   * **Step 3 — Transform Agent**:
     * **Description**:
       ```
       Extract sentiment, urgencyLevel, and actionPlan into clean JSON.
       ```
3. Connect **Node 1 ➔ Node 2 ➔ Node 3**.
4. Click **Save Workflow** and **Trigger Run**.
5. Watch the **Run Monitor** execute each step live and inspect the output JSON!

---

## 📡 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **Auth** | | |
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Login and receive JWT access + refresh tokens |
| `POST` | `/api/auth/refresh` | Silent token refresh |
| `GET` | `/api/auth/me` | Fetch current authenticated user |
| **Workflows** | | |
| `GET` | `/api/workflow` | List user/organization workflows |
| `POST` | `/api/workflow` | Create a new workflow definition |
| `GET` | `/api/workflow/:id` | Get workflow definition by ID |
| `PUT` | `/api/workflow/:id` | Update workflow and snapshot previous version |
| `DELETE`| `/api/workflow/:id` | Delete a workflow |
| `POST` | `/api/workflow/:id/run`| Trigger an execution run with an input payload |
| `GET` | `/api/workflow/:id/versions` | List historical versions |
| `POST` | `/api/workflow/:id/versions/:v/restore` | Rollback to a previous version |
| `POST` | `/api/workflow/:id/duplicate` | Duplicate a workflow definition |
| **Runs & SSE** | | |
| `GET` | `/api/runs` | List all workflow runs |
| `GET` | `/api/runs/:id` | Get run details and task outputs |
| `POST` | `/api/runs/:id/cancel` | Cancel an in-flight run |
| `GET` | `/api/runs/:id/stream`| Live SSE event stream |
| **Scheduling & Webhooks** | | |
| `POST` | `/api/workflow/${id}/schedule` | Configure a recurring cron schedule |
| `DELETE`| `/api/workflow/${id}/schedule` | Remove a schedule |
| `POST` | `/api/workflow/${id}/webhook` | Generate an inbound webhook secret |
| `POST` | `/api/webhooks/trigger/:token`| Trigger a run via external webhook POST |

Full interactive schemas and parameters can be tested live at **`http://localhost:8000/api/docs`**.

---

## 🧪 Testing

Run the Vitest test suite (155 tests covering the orchestrator, agent workers, template parser, authentication, and scheduling):

```bash
# Run all tests
pnpm test:server

# Watch mode during development
pnpm test:server:watch
```
