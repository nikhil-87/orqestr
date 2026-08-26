import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, generateTestToken } from "../helpers/app";
import { createMockPrisma, MockPrismaClient } from "../helpers/prisma";

function createMockOrchestrator() {
  return {
    triggerRun: vi.fn().mockResolvedValue({ runId: "run-999", status: "RUNNING" }),
    start: vi.fn(),
    stop: vi.fn(),
    prisma: {},
  };
}

describe("Webhook API", () => {
  let prisma: MockPrismaClient;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;
  let app: ReturnType<typeof createTestApp>;
  let token: string;

  const mockWf = {
    id: "wf-123",
    name: "Sample WF",
    userId: "test-user-id",
    organizationId: null,
  };

  const mockWebhook = {
    id: "wh-1",
    workflowId: "wf-123",
    userId: "test-user-id",
    token: "valid-secret-token",
    enabled: true,
    lastCalledAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    orchestrator = createMockOrchestrator();
    app = createTestApp(orchestrator, prisma);
    token = generateTestToken("test-user-id");
  });

  describe("POST /api/workflow/:id/webhook", () => {
    it("creates webhook for workflow", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.webhook.findUnique.mockResolvedValue(null);
      prisma.webhook.create.mockResolvedValue(mockWebhook as any);

      const res = await request(app)
        .post("/api/workflow/wf-123/webhook")
        .set("Authorization", `Bearer ${token}`)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBe("valid-secret-token");
    });
  });

  describe("GET /api/workflow/:id/webhook", () => {
    it("returns webhook for workflow", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.webhook.findUnique.mockResolvedValue(mockWebhook as any);

      const res = await request(app)
        .get("/api/workflow/wf-123/webhook")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("wh-1");
    });
  });

  describe("POST /api/webhooks/trigger/:token (public)", () => {
    it("triggers run with payload without authentication token", async () => {
      prisma.webhook.findUnique.mockResolvedValue(mockWebhook as any);
      prisma.webhook.update.mockResolvedValue(mockWebhook as any);

      const res = await request(app)
        .post("/api/webhooks/trigger/valid-secret-token")
        .send({ event: "order.placed", orderId: "12345" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(orchestrator.triggerRun).toHaveBeenCalledWith(
        "wf-123",
        { event: "order.placed", orderId: "12345" },
        "test-user-id",
      );
    });

    it("returns 404 on invalid token", async () => {
      prisma.webhook.findUnique.mockResolvedValue(null);

      await request(app)
        .post("/api/webhooks/trigger/unknown-token")
        .send({})
        .expect(404);
    });

    it("returns 403 on disabled webhook", async () => {
      prisma.webhook.findUnique.mockResolvedValue({
        ...mockWebhook,
        enabled: false,
      } as any);

      await request(app)
        .post("/api/webhooks/trigger/valid-secret-token")
        .send({})
        .expect(403);
    });
  });
});
