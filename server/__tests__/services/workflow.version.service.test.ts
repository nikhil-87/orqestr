import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowService } from "../../api/workflow/workflow.service";
import { WorkflowRepository } from "../../api/workflow/workflow.repository";
import { NotFoundError, ValidationError } from "../../utils/errors";

function createMockRepository() {
  return {
    findAllByUser: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    createVersion: vi.fn(),
    findVersionsByWorkflowId: vi.fn(),
    findVersion: vi.fn(),
  } as unknown as WorkflowRepository;
}

function createMockOrchestrator() {
  return {
    triggerRun: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    prisma: {},
  } as any;
}

describe("WorkflowService - Versioning", () => {
  let repository: ReturnType<typeof createMockRepository>;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;
  let service: WorkflowService;

  const mockWorkflow = {
    id: "wf-1",
    name: "Pipeline v1",
    description: "Initial pipeline",
    definition: { nodes: [], edges: [] },
    version: 1,
    userId: "user-1",
    organizationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository = createMockRepository();
    orchestrator = createMockOrchestrator();
    service = new WorkflowService(repository, orchestrator);
  });

  describe("updateWorkflow", () => {
    it("snapshots previous version and increments version counter on update", async () => {
      (repository.findById as any).mockResolvedValue(mockWorkflow);
      (repository.createVersion as any).mockResolvedValue({
        id: "v-1",
        workflowId: "wf-1",
        version: 1,
        name: mockWorkflow.name,
        description: mockWorkflow.description,
        definition: mockWorkflow.definition,
        createdAt: new Date(),
      });
      (repository.update as any).mockResolvedValue({
        ...mockWorkflow,
        name: "Pipeline v2",
        version: 2,
      });

      const result = await service.updateWorkflow(
        "wf-1",
        { name: "Pipeline v2" },
        "user-1",
      );

      expect(repository.createVersion).toHaveBeenCalledWith({
        workflowId: "wf-1",
        version: 1,
        name: "Pipeline v1",
        description: "Initial pipeline",
        definition: { nodes: [], edges: [] },
      });
      expect(repository.update).toHaveBeenCalledWith("wf-1", {
        name: "Pipeline v2",
        description: "Initial pipeline",
        definition: { nodes: [], edges: [] },
        version: 2,
      });
      expect(result.version).toBe(2);
    });

    it("throws ValidationError when updating with empty name", async () => {
      (repository.findById as any).mockResolvedValue(mockWorkflow);

      await expect(
        service.updateWorkflow("wf-1", { name: "" }, "user-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when updating workflow of another user", async () => {
      (repository.findById as any).mockResolvedValue(mockWorkflow);

      await expect(
        service.updateWorkflow("wf-1", { name: "Hacked" }, "user-2"),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("getWorkflowVersions", () => {
    it("returns version history for workflow owner", async () => {
      (repository.findById as any).mockResolvedValue(mockWorkflow);
      const versions = [
        { id: "v-2", workflowId: "wf-1", version: 2 },
        { id: "v-1", workflowId: "wf-1", version: 1 },
      ];
      (repository.findVersionsByWorkflowId as any).mockResolvedValue(versions);

      const result = await service.getWorkflowVersions("wf-1", "user-1");
      expect(result).toHaveLength(2);
      expect(repository.findVersionsByWorkflowId).toHaveBeenCalledWith("wf-1");
    });
  });

  describe("restoreVersion", () => {
    it("restores historical definition and snapshots current state", async () => {
      const liveWorkflow = {
        ...mockWorkflow,
        version: 3,
        name: "Current Broken Name",
      };
      (repository.findById as any).mockResolvedValue(liveWorkflow);

      const historicalVersion = {
        id: "v-1",
        workflowId: "wf-1",
        version: 1,
        name: "Original Stable Name",
        description: "Stable desc",
        definition: { nodes: [{ id: "1" }], edges: [] },
      };
      (repository.findVersion as any).mockResolvedValue(historicalVersion);
      (repository.createVersion as any).mockResolvedValue({ id: "v-3" });
      (repository.update as any).mockResolvedValue({
        ...liveWorkflow,
        name: historicalVersion.name,
        definition: historicalVersion.definition,
        version: 4,
      });

      const result = await service.restoreVersion("wf-1", 1, "user-1");

      expect(repository.createVersion).toHaveBeenCalledWith({
        workflowId: "wf-1",
        version: 3,
        name: "Current Broken Name",
        description: "Initial pipeline",
        definition: { nodes: [], edges: [] },
      });
      expect(repository.update).toHaveBeenCalledWith("wf-1", {
        name: historicalVersion.name,
        description: historicalVersion.description,
        definition: historicalVersion.definition,
        version: 4,
      });
      expect(result.version).toBe(4);
    });

    it("throws NotFoundError when target version does not exist", async () => {
      (repository.findById as any).mockResolvedValue(mockWorkflow);
      (repository.findVersion as any).mockResolvedValue(null);

      await expect(
        service.restoreVersion("wf-1", 99, "user-1"),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
