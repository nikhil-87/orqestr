import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowRunService } from "../../api/run/run.service";
import { NotFoundError, ValidationError } from "../../utils/errors";

function createMockRunRepository() {
  return {
    findAllByUser: vi.fn(),
    findById: vi.fn(),
    findByWorkflowId: vi.fn(),
    findOrgMembership: vi.fn(),
    cancelRun: vi.fn(),
  };
}

describe("WorkflowRunService", () => {
  let repo: ReturnType<typeof createMockRunRepository>;
  let service: WorkflowRunService;

  beforeEach(() => {
    repo = createMockRunRepository();
    service = new WorkflowRunService(repo as any);
  });

  describe("getAllRuns", () => {
    it("returns all runs for the user and org", async () => {
      const runs = [{ id: "run-1", workflowId: "wf-1" }];
      repo.findAllByUser.mockResolvedValue(runs);

      const result = await service.getAllRuns("user-1", "org-1");

      expect(repo.findAllByUser).toHaveBeenCalledWith("user-1", "org-1");
      expect(result).toEqual(runs);
    });
  });

  describe("getRunById", () => {
    it("returns the run when it belongs to the user", async () => {
      const run = { id: "run-1", userId: "user-1", workflow: { organizationId: null, userId: "user-1" } };
      repo.findById.mockResolvedValue(run);

      const result = await service.getRunById("run-1", "user-1");

      expect(repo.findById).toHaveBeenCalledWith("run-1");
      expect(result).toEqual(run);
    });

    it("returns the run when it belongs to user's workflow", async () => {
      const run = { id: "run-1", userId: null, workflow: { userId: "user-1", organizationId: null } };
      repo.findById.mockResolvedValue(run);

      const result = await service.getRunById("run-1", "user-1");

      expect(result).toEqual(run);
    });

    it("returns the run when user is an active member in the workflow's organization", async () => {
      const run = { id: "run-1", userId: "other-user", workflow: { userId: "other-user", organizationId: "org-1" } };
      repo.findById.mockResolvedValue(run);
      repo.findOrgMembership.mockResolvedValue({ id: "mem-1", role: "MEMBER" });

      const result = await service.getRunById("run-1", "user-1", "org-1");

      expect(result).toEqual(run);
      expect(repo.findOrgMembership).toHaveBeenCalledWith("org-1", "user-1");
    });

    it("allows direct navigation to org run when user is an active member without org header", async () => {
      const run = { id: "run-1", userId: "other-user", workflow: { userId: "other-user", organizationId: "org-1" } };
      repo.findById.mockResolvedValue(run);
      repo.findOrgMembership.mockResolvedValue({ id: "mem-1", role: "MEMBER" });

      const result = await service.getRunById("run-1", "user-1");

      expect(result).toEqual(run);
      expect(repo.findOrgMembership).toHaveBeenCalledWith("org-1", "user-1");
    });

    it("throws NotFoundError when user was removed from the organization", async () => {
      const run = { id: "run-1", userId: "other-user", workflow: { userId: "other-user", organizationId: "org-1" } };
      repo.findById.mockResolvedValue(run);
      repo.findOrgMembership.mockResolvedValue(null);

      await expect(service.getRunById("run-1", "user-1", "org-1")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when org header does not match workflow organization", async () => {
      const run = { id: "run-1", userId: "other-user", workflow: { userId: "other-user", organizationId: "org-1" } };
      repo.findById.mockResolvedValue(run);

      await expect(service.getRunById("run-1", "user-1", "org-wrong")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when organization header is provided for personal run", async () => {
      const run = { id: "run-1", userId: "user-1", workflow: { userId: "user-1", organizationId: null } };
      repo.findById.mockResolvedValue(run);

      await expect(service.getRunById("run-1", "user-1", "org-1")).rejects.toThrow(NotFoundError);
    });

    it("throws ValidationError when id is empty", async () => {
      await expect(service.getRunById("", "user-1")).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when run does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getRunById("nonexistent", "user-1")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws NotFoundError when run belongs to another user and different org", async () => {
      repo.findById.mockResolvedValue({ id: "run-1", userId: "user-2", workflow: { userId: "user-2", organizationId: "org-2" } });

      await expect(service.getRunById("run-1", "user-1", "org-1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("getRunsByWorkflowId", () => {
    it("returns runs accessible to the user", async () => {
      const runs = [
        { id: "run-1", workflowId: "wf-1", userId: "user-1", workflow: { organizationId: null, userId: "user-1" } },
        { id: "run-2", workflowId: "wf-1", userId: "user-2", workflow: { organizationId: null, userId: "user-2" } },
      ];
      repo.findByWorkflowId.mockResolvedValue(runs);

      const result = await service.getRunsByWorkflowId("wf-1", "user-1");

      expect(repo.findByWorkflowId).toHaveBeenCalledWith("wf-1");
      expect(result).toEqual([{ id: "run-1", workflowId: "wf-1", userId: "user-1", workflow: { organizationId: null, userId: "user-1" } }]);
    });

    it("throws ValidationError when workflow id is empty", async () => {
      await expect(service.getRunsByWorkflowId("", "user-1")).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("cancelRun", () => {
    it("cancels run when authorized", async () => {
      const run = {
        id: "run-1",
        status: "RUNNING",
        userId: "user-1",
        workflow: { organizationId: null, userId: "user-1" },
      };
      repo.findById.mockResolvedValue(run);
      repo.cancelRun.mockResolvedValue({ ...run, status: "CANCELLED" });

      const result = await service.cancelRun("run-1", "user-1");

      expect(repo.cancelRun).toHaveBeenCalledWith("run-1");
      expect(result.status).toBe("CANCELLED");
    });

    it("rejects cancellation if run is already completed", async () => {
      const run = {
        id: "run-1",
        status: "COMPLETED",
        userId: "user-1",
        workflow: { organizationId: null, userId: "user-1" },
      };
      repo.findById.mockResolvedValue(run);

      await expect(service.cancelRun("run-1", "user-1")).rejects.toThrow(ValidationError);
    });
  });
});
