import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowService } from "../../api/workflow/workflow.service";
import { NotFoundError, ValidationError } from "../../utils/errors";

function createMockWorkflowRepository() {
  return {
    findAllByUser: vi.fn(),
    findById: vi.fn(),
    findOrgMembership: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    createVersion: vi.fn(),
    findVersionsByWorkflowId: vi.fn(),
    findVersion: vi.fn(),
  };
}

function createMockOrchestrator() {
  return {
    triggerRun: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    prisma: {},
  };
}

vi.mock("../cache/cache.service", () => ({
  cacheService: {
    get: vi.fn().mockResolvedValue(null), // always cache miss in tests
    set: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("WorkflowService", () => {
  let repo: ReturnType<typeof createMockWorkflowRepository>;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;
  let schedulerService: { removeRepeatableJob: ReturnType<typeof vi.fn> };
  let service: WorkflowService;

  beforeEach(() => {
    repo = createMockWorkflowRepository();
    orchestrator = createMockOrchestrator();
    schedulerService = {
      removeRepeatableJob: vi.fn().mockResolvedValue(undefined),
    };
    service = new WorkflowService(repo as any, orchestrator as any, schedulerService as any);
  });

  describe("getAllWorkflows", () => {
    it("returns all workflows for the user", async () => {
      const workflows = [{ id: "1", name: "Test Workflow" }];
      repo.findAllByUser.mockResolvedValue(workflows);

      const result = await service.getAllWorkflows("user-1");

      expect(repo.findAllByUser).toHaveBeenCalledWith("user-1", undefined);
      expect(result).toEqual(workflows);
    });
  });

  describe("getWorkflowById", () => {
    it("returns the workflow when it belongs to the user", async () => {
      const workflow = { id: "wf-1", name: "Test", userId: "user-1", organizationId: null };
      repo.findById.mockResolvedValue(workflow);

      const result = await service.getWorkflowById("wf-1", "user-1");

      expect(repo.findById).toHaveBeenCalledWith("wf-1");
      expect(result).toEqual(workflow);
    });

    it("throws ValidationError when id is empty", async () => {
      await expect(service.getWorkflowById("", "user-1")).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws NotFoundError when workflow does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getWorkflowById("nonexistent", "user-1")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws NotFoundError when personal workflow belongs to another user", async () => {
      const workflow = { id: "wf-1", name: "Test", userId: "user-2", organizationId: null };
      repo.findById.mockResolvedValue(workflow);

      await expect(service.getWorkflowById("wf-1", "user-1")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("allows organization member to access organization workflow on direct navigation (no org header)", async () => {
      const workflow = { id: "wf-org-1", name: "Org WF", userId: "creator-user", organizationId: "org-1" };
      repo.findById.mockResolvedValue(workflow);
      repo.findOrgMembership.mockResolvedValue({ id: "mem-1", organizationId: "org-1", userId: "user-1", role: "MEMBER" });

      const result = await service.getWorkflowById("wf-org-1", "user-1", undefined);

      expect(repo.findOrgMembership).toHaveBeenCalledWith("org-1", "user-1");
      expect(result).toEqual(workflow);
    });

    it("allows organization member to access organization workflow with matching org header", async () => {
      const workflow = { id: "wf-org-1", name: "Org WF", userId: "creator-user", organizationId: "org-1" };
      repo.findById.mockResolvedValue(workflow);
      repo.findOrgMembership.mockResolvedValue({ id: "mem-1", organizationId: "org-1", userId: "user-1", role: "ADMIN" });

      const result = await service.getWorkflowById("wf-org-1", "user-1", "org-1");

      expect(result).toEqual(workflow);
    });

    it("rejects access to organization workflow if user is NOT a member of that organization", async () => {
      const workflow = { id: "wf-org-1", name: "Org WF", userId: "creator-user", organizationId: "org-1" };
      repo.findById.mockResolvedValue(workflow);
      repo.findOrgMembership.mockResolvedValue(null); // not a member

      await expect(service.getWorkflowById("wf-org-1", "user-stranger")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("rejects cross-tenant access when client passes Org B header for Org A workflow", async () => {
      const workflow = { id: "wf-org-1", name: "Org WF", userId: "creator-user", organizationId: "org-1" };
      repo.findById.mockResolvedValue(workflow);
      repo.findOrgMembership.mockResolvedValue({ id: "mem-1", organizationId: "org-1", userId: "user-1", role: "MEMBER" });

      await expect(service.getWorkflowById("wf-org-1", "user-1", "org-2")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("rejects personal workflow if client passes an organization header", async () => {
      const workflow = { id: "wf-personal", name: "Personal WF", userId: "user-1", organizationId: null };
      repo.findById.mockResolvedValue(workflow);

      await expect(service.getWorkflowById("wf-personal", "user-1", "org-1")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("createWorkflow", () => {
    it("creates a workflow with valid data", async () => {
      const data = {
        name: "New Workflow",
        definition: {
          nodes: [{ id: "node-1", type: "LLM_AGENT", name: "Step 1", critical: true, config: {} }],
          edges: [],
        },
      };
      const created = { id: "wf-1", ...data, userId: "user-1", organizationId: null };
      repo.create.mockResolvedValue(created);

      const result = await service.createWorkflow(data as any, "user-1");

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New Workflow" }),
        "user-1",
      );
      expect(result).toEqual(created);
    });

    it("throws ValidationError when name is empty", async () => {
      const data = { name: "", definition: {} };

      await expect(service.createWorkflow(data, "user-1")).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("updateWorkflow", () => {
    it("updates a personal workflow when user is the owner", async () => {
      const current = { id: "wf-1", name: "Old Name", version: 1, userId: "user-1", organizationId: null, definition: {} };
      repo.findById.mockResolvedValue(current);
      repo.update.mockResolvedValue({ ...current, name: "New Name", version: 2 });

      const result = await service.updateWorkflow("wf-1", { name: "New Name" }, "user-1");

      expect(repo.createVersion).toHaveBeenCalledWith(expect.objectContaining({ workflowId: "wf-1", version: 1 }));
      expect(repo.update).toHaveBeenCalledWith("wf-1", expect.objectContaining({ name: "New Name", version: 2 }));
      expect(result.name).toBe("New Name");
    });

    it("allows authorized organization member to update organization workflow", async () => {
      const current = { id: "wf-org", name: "Old Org Name", version: 1, userId: "creator", organizationId: "org-1", definition: {} };
      repo.findById.mockResolvedValue(current);
      repo.findOrgMembership.mockResolvedValue({ id: "mem-1", organizationId: "org-1", userId: "editor-user", role: "MEMBER" });
      repo.update.mockResolvedValue({ ...current, name: "Updated Org Name", version: 2 });

      const result = await service.updateWorkflow("wf-org", { name: "Updated Org Name" }, "editor-user", "org-1");

      expect(repo.update).toHaveBeenCalled();
      expect(result.name).toBe("Updated Org Name");
    });

    it("rejects update if user is not a member of the organization", async () => {
      const current = { id: "wf-org", name: "Org Name", version: 1, userId: "creator", organizationId: "org-1", definition: {} };
      repo.findById.mockResolvedValue(current);
      repo.findOrgMembership.mockResolvedValue(null);

      await expect(service.updateWorkflow("wf-org", { name: "Hacked" }, "attacker", "org-1")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("triggerRun", () => {
    it("delegates to orchestrator and returns the run", async () => {
      const workflow = { id: "wf-1", name: "Test", userId: "user-1", organizationId: null };
      repo.findById.mockResolvedValue(workflow);

      const runResult = { runId: "run-1", status: "RUNNING", workflowId: "wf-1" };
      orchestrator.triggerRun.mockResolvedValue(runResult);

      const result = await service.triggerRun("wf-1", { prompt: "hello" }, "user-1");

      expect(orchestrator.triggerRun).toHaveBeenCalledWith(
        "wf-1",
        { prompt: "hello" },
        "user-1",
      );
      expect(result).toEqual(runResult);
    });
  });

  describe("deleteWorkflow", () => {
    it("deletes a workflow when it belongs to the user", async () => {
      const workflow = { id: "wf-1", name: "Test", userId: "user-1", organizationId: null };
      repo.findById.mockResolvedValue(workflow);
      repo.delete.mockResolvedValue(workflow);

      const result = await service.deleteWorkflow("wf-1", "user-1");

      expect(repo.delete).toHaveBeenCalledWith("wf-1");
      expect(result).toEqual(workflow);
    });

    it("throws ValidationError when id is empty", async () => {
      await expect(service.deleteWorkflow("", "user-1")).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when workflow does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.deleteWorkflow("nonexistent", "user-1")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws NotFoundError when workflow belongs to another user", async () => {
      const workflow = { id: "wf-1", name: "Test", userId: "user-2" };
      repo.findById.mockResolvedValue(workflow);

      await expect(service.deleteWorkflow("wf-1", "user-1")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("enforces RBAC: rejects deletion by an organization MEMBER with 403 Forbidden", async () => {
      const orgWf = { id: "wf-org-1", name: "Org WF", organizationId: "org-1", userId: "creator" };
      repo.findById.mockResolvedValue(orgWf);
      repo.findOrgMembership.mockResolvedValue({ role: "MEMBER" });

      await expect(service.deleteWorkflow("wf-org-1", "user-member", "org-1")).rejects.toThrow(
        "Only organization owners and admins can delete workflows",
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("enforces RBAC: allows deletion by an organization ADMIN and removes scheduler job", async () => {
      const orgWf = { id: "wf-org-1", name: "Org WF", organizationId: "org-1", userId: "creator" };
      repo.findById.mockResolvedValue(orgWf);
      repo.findOrgMembership.mockResolvedValue({ role: "ADMIN" });
      repo.delete.mockResolvedValue(orgWf);

      const res = await service.deleteWorkflow("wf-org-1", "user-admin", "org-1");

      expect(repo.delete).toHaveBeenCalledWith("wf-org-1");
      expect(schedulerService.removeRepeatableJob).toHaveBeenCalledWith("wf-org-1");
      expect(res).toEqual(orgWf);
    });

    it("enforces RBAC: allows deletion by an organization OWNER and removes scheduler job", async () => {
      const orgWf = { id: "wf-org-1", name: "Org WF", organizationId: "org-1", userId: "creator" };
      repo.findById.mockResolvedValue(orgWf);
      repo.findOrgMembership.mockResolvedValue({ role: "OWNER" });
      repo.delete.mockResolvedValue(orgWf);

      const res = await service.deleteWorkflow("wf-org-1", "user-owner", "org-1");

      expect(repo.delete).toHaveBeenCalledWith("wf-org-1");
      expect(schedulerService.removeRepeatableJob).toHaveBeenCalledWith("wf-org-1");
      expect(res).toEqual(orgWf);
    });
  });
});
