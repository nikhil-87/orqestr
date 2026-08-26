import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, generateTestToken } from "../helpers/app";
import { redis } from "../../config/redis.config";

function createMockPrisma() {
  return {
    workflowDefinition: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workflowRun: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    agent: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
}

function createMockOrchestrator() {
  return { triggerRun: vi.fn(), start: vi.fn(), stop: vi.fn(), prisma: {} };
}

describe("Agents API", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let app: ReturnType<typeof createTestApp>;
  let token: string;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma() as any;
    app = createTestApp(createMockOrchestrator(), prisma);
    token = generateTestToken();
  });

  describe("GET /api/agents", () => {
    it("returns all agents", async () => {
      const agents = [
        {
          id: "agent-1",
          name: "LLM_AGENT_1",
          type: "LLM_AGENT",
          status: "ONLINE",
          lastSeenAt: new Date().toISOString(),
          tasksHandled: 10,
          tasksFailed: 1,
        },
      ];
      prisma.agent.findMany.mockResolvedValue(agents);

      const res = await request(app)
        .get("/api/agents")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("LLM_AGENT_1");
    });

    it("returns 401 without auth", async () => {
      await request(app).get("/api/agents").expect(401);
    });
  });

  describe("GET /api/agents/:id", () => {
    it("returns a single agent by id", async () => {
      const agent = { id: "agent-1", name: "HTTP_AGENT_1", type: "HTTP_AGENT" };
      prisma.agent.findUnique.mockResolvedValue(agent);

      const res = await request(app)
        .get("/api/agents/agent-1")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.id).toBe("agent-1");
    });

    it("returns 404 for non-existent agent", async () => {
      prisma.agent.findUnique.mockResolvedValue(null);

      await request(app)
        .get("/api/agents/nonexistent")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  describe("POST /api/agents/test", () => {
    it("returns 401 when unauthenticated", async () => {
      await request(app)
        .post("/api/agents/test")
        .send({
          data: {
            type: "LLM_AGENT",
            config: { promptTemplate: "Test" },
          },
        })
        .expect(401);
    });

    it("successfully tests an LLM agent", async () => {
      const res = await request(app)
        .post("/api/agents/test")
        .set("Authorization", `Bearer ${token}`)
        .send({
          data: {
            type: "LLM_AGENT",
            config: { promptTemplate: "Say hello to {{name}}" },
            input: { name: "Alice" },
          },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.output).toBeDefined();
    });

    it("returns failure payload gracefully when config is invalid", async () => {
      const res = await request(app)
        .post("/api/agents/test")
        .set("Authorization", `Bearer ${token}`)
        .send({
          data: {
            type: "LLM_AGENT",
            config: {},
          },
        })
        .expect(200);

      expect(res.body.success).toBe(false);
      expect(res.body.data.success).toBe(false);
      expect(res.body.data.error).toContain("requires a promptTemplate");
    });

    it("blocks requests exceeding the agent test rate limit with 429", async () => {
      (redis.incr as any).mockResolvedValueOnce(21); // 21st request against limit of 20
      (redis.ttl as any).mockResolvedValueOnce(45);

      const res = await request(app)
        .post("/api/agents/test")
        .set("Authorization", `Bearer ${token}`)
        .send({
          data: {
            type: "LLM_AGENT",
            config: { promptTemplate: "Test" },
          },
        })
        .expect(429);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe("RATE_LIMIT_EXCEEDED");
    });
  });
});
