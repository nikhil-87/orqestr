import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookService } from "../../api/webhook/webhook.service";
import { WebhookRepository } from "../../api/webhook/webhook.repository";
import { WorkflowRepository } from "../../api/workflow/workflow.repository";
import { ApiError, ConflictError, NotFoundError } from "../../utils/errors";

function createMockWebhookRepo() {
  return {
    findByWorkflowId: vi.fn(),
    findByToken: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateLastCalled: vi.fn(),
  } as unknown as WebhookRepository;
}

function createMockWorkflowRepo() {
  return {
    findById: vi.fn(),
    findAllByUser: vi.fn(),
    findOrgMembership: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as WorkflowRepository;
}

function createMockOrchestrator() {
  return {
    triggerRun: vi.fn().mockResolvedValue({ runId: "run-1", status: "RUNNING" }),
    start: vi.fn(),
    stop: vi.fn(),
    prisma: {},
  } as any;
}

describe("WebhookService", () => {
  let webhookRepo: ReturnType<typeof createMockWebhookRepo>;
  let workflowRepo: ReturnType<typeof createMockWorkflowRepo>;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;
  let service: WebhookService;

  const mockWf = {
    id: "wf-1",
    userId: "user-1",
    organizationId: null,
    name: "Sample Webhook WF",
  };

  const mockWebhook = {
    id: "wh-1",
    workflowId: "wf-1",
    userId: "user-1",
    token: "token-abc-123",
    enabled: true,
    lastCalledAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    webhookRepo = createMockWebhookRepo();
    workflowRepo = createMockWorkflowRepo();
    orchestrator = createMockOrchestrator();
    service = new WebhookService(webhookRepo, workflowRepo, orchestrator);
  });

  describe("createWebhook", () => {
    it("creates a new webhook with token for workflow", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (webhookRepo.findByWorkflowId as any).mockResolvedValue(null);
      (webhookRepo.create as any).mockResolvedValue(mockWebhook);

      const result = await service.createWebhook("wf-1", "user-1");

      expect(webhookRepo.create).toHaveBeenCalled();
      expect(result.token).toBe("token-abc-123");
    });

    it("throws ConflictError if webhook already exists for workflow", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (webhookRepo.findByWorkflowId as any).mockResolvedValue(mockWebhook);

      await expect(service.createWebhook("wf-1", "user-1")).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe("regenerateToken", () => {
    it("updates webhook with newly generated token", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (webhookRepo.findByWorkflowId as any).mockResolvedValue(mockWebhook);
      (webhookRepo.update as any).mockResolvedValue({
        ...mockWebhook,
        token: "token-new-456",
      });

      const result = await service.regenerateToken("wf-1", "user-1");

      expect(webhookRepo.update).toHaveBeenCalled();
      expect(result.token).toBe("token-new-456");
    });
  });

  describe("triggerByToken", () => {
    it("triggers run and updates lastCalledAt on valid token", async () => {
      (webhookRepo.findByToken as any).mockResolvedValue(mockWebhook);

      const result = await service.triggerByToken("token-abc-123", { data: "test" });

      expect(orchestrator.triggerRun).toHaveBeenCalledWith(
        "wf-1",
        { data: "test" },
        "user-1",
      );
      expect(webhookRepo.updateLastCalled).toHaveBeenCalledWith("token-abc-123", expect.any(Date));
      expect(result.runId).toBe("run-1");
    });

    it("throws NotFoundError on invalid token", async () => {
      (webhookRepo.findByToken as any).mockResolvedValue(null);

      await expect(service.triggerByToken("invalid-token", {})).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws ApiError(403) when webhook is disabled", async () => {
      (webhookRepo.findByToken as any).mockResolvedValue({
        ...mockWebhook,
        enabled: false,
      });

      await expect(service.triggerByToken("token-abc-123", {})).rejects.toThrow(
        ApiError,
      );
    });
  });

  describe("Multi-tenant organization authorization", () => {
    const orgWf = {
      id: "wf-org-1",
      userId: "user-creator",
      organizationId: "org-1",
      name: "Org Webhook WF",
    };

    it("allows active organization member to get webhook without org header", async () => {
      (workflowRepo.findById as any).mockResolvedValue(orgWf);
      (workflowRepo.findOrgMembership as any).mockResolvedValue({ id: "mem-1", role: "MEMBER" });
      (webhookRepo.findByWorkflowId as any).mockResolvedValue(mockWebhook);

      const result = await service.getWebhook("wf-org-1", "user-member");

      expect(result).toEqual(mockWebhook);
      expect(workflowRepo.findOrgMembership).toHaveBeenCalledWith("org-1", "user-member");
    });

    it("denies access when user was removed from the organization", async () => {
      (workflowRepo.findById as any).mockResolvedValue(orgWf);
      (workflowRepo.findOrgMembership as any).mockResolvedValue(null);

      await expect(service.getWebhook("wf-org-1", "user-removed")).rejects.toThrow(NotFoundError);
    });

    it("rejects personal workflow access when organization header is provided", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);

      await expect(service.getWebhook("wf-1", "user-1", "org-1")).rejects.toThrow(NotFoundError);
    });
  });
});
