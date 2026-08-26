import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, generateTestToken } from "../helpers/app";
import { createMockPrisma, MockPrismaClient } from "../helpers/prisma";

function createMockOrchestrator() {
  return { triggerRun: vi.fn(), start: vi.fn(), stop: vi.fn(), prisma: {} };
}

describe("Workflow Versioning API", () => {
  let prisma: MockPrismaClient;
  let app: ReturnType<typeof createTestApp>;
  let token: string;

  const mockWf = {
    id: "wf-123",
    name: "My Workflow",
    description: "Sample desc",
    definition: { nodes: [], edges: [] },
    version: 1,
    userId: "test-user-id",
    organizationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    app = createTestApp(createMockOrchestrator(), prisma);
    token = generateTestToken("test-user-id");
  });

  describe("PUT /api/workflow/:id", () => {
    it("updates workflow and creates version snapshot", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowVersion.create.mockResolvedValue({ id: "v-1" } as any);
      prisma.workflowDefinition.update.mockResolvedValue({
        ...mockWf,
        name: "Updated Workflow",
        version: 2,
      } as any);

      const res = await request(app)
        .put("/api/workflow/wf-123")
        .set("Authorization", `Bearer ${token}`)
        .send({ data: { name: "Updated Workflow" } })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toBe(2);
      expect(prisma.workflowVersion.create).toHaveBeenCalled();
    });

    it("returns 401 without auth", async () => {
      await request(app)
        .put("/api/workflow/wf-123")
        .send({ data: { name: "Updated" } })
        .expect(401);
    });
  });

  describe("GET /api/workflow/:id/versions", () => {
    it("lists all versions of a workflow", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowVersion.findMany.mockResolvedValue([
        { id: "v-2", workflowId: "wf-123", version: 2 },
        { id: "v-1", workflowId: "wf-123", version: 1 },
      ] as any);

      const res = await request(app)
        .get("/api/workflow/wf-123/versions")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe("GET /api/workflow/:id/versions/:version", () => {
    it("returns specific version details", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowVersion.findUnique.mockResolvedValue({
        id: "v-1",
        workflowId: "wf-123",
        version: 1,
        name: "Old Name",
        definition: { nodes: [] },
      } as any);

      const res = await request(app)
        .get("/api/workflow/wf-123/versions/1")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toBe(1);
    });

    it("returns 404 when version not found", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(mockWf as any);
      prisma.workflowVersion.findUnique.mockResolvedValue(null);

      await request(app)
        .get("/api/workflow/wf-123/versions/99")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  describe("POST /api/workflow/:id/versions/:version/restore", () => {
    it("restores specified version and returns newly bumped workflow", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue({ ...mockWf, version: 3 } as any);
      prisma.workflowVersion.findUnique.mockResolvedValue({
        id: "v-1",
        workflowId: "wf-123",
        version: 1,
        name: "Version 1 Name",
        description: "Version 1 desc",
        definition: { nodes: [] },
      } as any);
      prisma.workflowVersion.create.mockResolvedValue({ id: "v-3" } as any);
      prisma.workflowDefinition.update.mockResolvedValue({
        ...mockWf,
        name: "Version 1 Name",
        version: 4,
      } as any);

      const res = await request(app)
        .post("/api/workflow/wf-123/versions/1/restore")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toBe(4);
    });
  });
});
