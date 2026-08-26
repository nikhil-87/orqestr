import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, generateTestToken } from "../helpers/app";
import { createMockPrisma, MockPrismaClient } from "../helpers/prisma";

vi.mock("../../api/scheduler/scheduler.worker", () => ({
  SCHEDULER_QUEUE_NAME: "WORKFLOW_SCHEDULER",
  schedulerQueue: {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(true),
  },
  SchedulerWorker: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

function createMockOrchestrator() {
  return { triggerRun: vi.fn(), start: vi.fn(), stop: vi.fn(), prisma: {} };
}

describe("Scheduler API", () => {
  let prisma: MockPrismaClient;
  let app: ReturnType<typeof createTestApp>;
  let token: string;

  const mockWf = {
    id: "wf-123",
    name: "Sample WF",
    userId: "test-user-id",
    organizationId: null,
  };

  const mockSchedule = {
    id: "sched-1",
    workflowId: "wf-123",
    userId: "test-user-id",
    cronExpression: "0 12 * * *",
    timezone: "UTC",
    input: {},
    enabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    app = createTestApp(createMockOrchestrator(), prisma);
    token = generateTestToken("test-user-id");
  });

  describe("POST /api/workflow/:id/schedule", () => {
    it("creates a schedule for the workflow", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowSchedule.findUnique.mockResolvedValue(null);
      prisma.workflowSchedule.create.mockResolvedValue(mockSchedule as any);

      const res = await request(app)
        .post("/api/workflow/wf-123/schedule")
        .set("Authorization", `Bearer ${token}`)
        .send({ data: { cronExpression: "0 12 * * *" } })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.cronExpression).toBe("0 12 * * *");
    });
  });

  describe("GET /api/workflow/:id/schedule", () => {
    it("returns schedule of the workflow", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowSchedule.findUnique.mockResolvedValue(mockSchedule as any);

      const res = await request(app)
        .get("/api/workflow/wf-123/schedule")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("sched-1");
    });
  });

  describe("PATCH /api/workflow/:id/schedule/toggle", () => {
    it("toggles enable/disable of schedule", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowSchedule.findUnique.mockResolvedValue(mockSchedule as any);
      prisma.workflowSchedule.update.mockResolvedValue({
        ...mockSchedule,
        enabled: false,
      } as any);

      const res = await request(app)
        .patch("/api/workflow/wf-123/schedule/toggle")
        .set("Authorization", `Bearer ${token}`)
        .send({ data: { enabled: false } })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.enabled).toBe(false);
    });
  });

  describe("DELETE /api/workflow/:id/schedule", () => {
    it("deletes the schedule", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowSchedule.findUnique.mockResolvedValue(mockSchedule as any);
      prisma.workflowSchedule.delete.mockResolvedValue(mockSchedule as any);

      const res = await request(app)
        .delete("/api/workflow/wf-123/schedule")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });
});
