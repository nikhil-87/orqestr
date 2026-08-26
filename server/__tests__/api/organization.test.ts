import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, generateTestToken } from "../helpers/app";
import { createMockPrisma, MockPrismaClient } from "../helpers/prisma";
import { OrgRole } from "@prisma/client";

function createMockOrchestrator() {
  return { triggerRun: vi.fn(), start: vi.fn(), stop: vi.fn(), prisma: {} };
}

describe("Organization API", () => {
  let prisma: MockPrismaClient;
  let app: ReturnType<typeof createTestApp>;
  let token: string;

  const mockOrg = {
    id: "org-123",
    name: "Engineering Corp",
    slug: "engineering-corp",
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [
      {
        id: "mem-1",
        userId: "test-user-id",
        role: OrgRole.OWNER,
        user: { id: "test-user-id", name: "Alice", email: "alice@test.com" },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    app = createTestApp(createMockOrchestrator(), prisma);
    token = generateTestToken("test-user-id");
  });

  describe("POST /api/organizations", () => {
    it("creates an organization with owner membership", async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      prisma.organization.create.mockResolvedValue(mockOrg as any);

      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${token}`)
        .send({ data: { name: "Engineering Corp" } })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Engineering Corp");
    });
  });

  describe("GET /api/organizations", () => {
    it("lists organizations the user belongs to", async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          id: "mem-1",
          userId: "test-user-id",
          organization: mockOrg,
        },
      ] as any);

      const res = await request(app)
        .get("/api/organizations")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe("POST /api/organizations/:id/members", () => {
    it("adds a member when requester is owner", async () => {
      prisma.organizationMember.findUnique.mockImplementation(({ where }: any) => {
        if (where.organizationId_userId?.userId === "test-user-id") {
          return Promise.resolve({ role: OrgRole.OWNER } as any);
        }
        return Promise.resolve(null);
      });
      prisma.organizationMember.create.mockResolvedValue({
        id: "mem-2",
        organizationId: "org-123",
        userId: "user-456",
        role: OrgRole.MEMBER,
        user: { id: "user-456", name: "Bob", email: "bob@test.com" },
      } as any);

      const res = await request(app)
        .post("/api/organizations/org-123/members")
        .set("Authorization", `Bearer ${token}`)
        .send({ data: { userId: "user-456", role: "MEMBER" } })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBe("user-456");
    });
  });

  describe("Org header scoping on workflow routes", () => {
    it("allows access to workflow belonging to org when X-Organization-Id is provided", async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        organizationId: "org-123",
        userId: "test-user-id",
        role: OrgRole.MEMBER,
      } as any);

      prisma.workflowDefinition.findMany.mockResolvedValue([
        {
          id: "wf-org-1",
          name: "Team Workflow",
          organizationId: "org-123",
          userId: "other-user",
        },
      ] as any);

      const res = await request(app)
        .get("/api/workflow")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Organization-Id", "org-123")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Team Workflow");
    });

    it("returns 403 when user is not a member of the organization specified in header", async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await request(app)
        .get("/api/workflow")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Organization-Id", "forbidden-org-999")
        .expect(403);
    });
  });
});
