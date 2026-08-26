import { describe, it, expect, vi, beforeEach } from "vitest";
import { SchedulerService } from "../../api/scheduler/scheduler.service";
import { SchedulerRepository } from "../../api/scheduler/scheduler.repository";
import { WorkflowRepository } from "../../api/workflow/workflow.repository";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors";
import { schedulerQueue } from "../../api/scheduler/scheduler.worker";

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

function createMockSchedulerRepo() {
  return {
    findByWorkflowId: vi.fn(),
    findById: vi.fn(),
    findAllEnabled: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateLastRun: vi.fn(),
  } as unknown as SchedulerRepository;
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

describe("SchedulerService", () => {
  let schedulerRepo: ReturnType<typeof createMockSchedulerRepo>;
  let workflowRepo: ReturnType<typeof createMockWorkflowRepo>;
  let service: SchedulerService;

  const mockWf = {
    id: "wf-1",
    userId: "user-1",
    organizationId: null,
    name: "Scheduled WF",
  };

  const mockSchedule = {
    id: "sched-1",
    workflowId: "wf-1",
    userId: "user-1",
    cronExpression: "0 0 * * *",
    timezone: "UTC",
    input: {},
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    schedulerRepo = createMockSchedulerRepo();
    workflowRepo = createMockWorkflowRepo();
    service = new SchedulerService(schedulerRepo, workflowRepo);
  });

  describe("createSchedule", () => {
    it("creates schedule and registers repeatable job when cron is valid", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (schedulerRepo.findByWorkflowId as any).mockResolvedValue(null);
      (schedulerRepo.create as any).mockResolvedValue(mockSchedule);

      const result = await service.createSchedule(
        "wf-1",
        { cronExpression: "0 0 * * *" },
        "user-1",
      );

      expect(schedulerRepo.create).toHaveBeenCalled();
      expect(schedulerQueue.add).toHaveBeenCalled();
      expect(result.cronExpression).toBe("0 0 * * *");
    });

    it("throws ValidationError when cron expression is invalid", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);

      await expect(
        service.createSchedule("wf-1", { cronExpression: "invalid-cron" }, "user-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ConflictError when schedule already exists for workflow", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (schedulerRepo.findByWorkflowId as any).mockResolvedValue(mockSchedule);

      await expect(
        service.createSchedule("wf-1", { cronExpression: "0 0 * * *" }, "user-1"),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("updateSchedule", () => {
    it("updates schedule and re-registers job", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (schedulerRepo.findByWorkflowId as any).mockResolvedValue(mockSchedule);
      (schedulerRepo.update as any).mockResolvedValue({
        ...mockSchedule,
        cronExpression: "*/5 * * * *",
      });

      const result = await service.updateSchedule(
        "wf-1",
        { cronExpression: "*/5 * * * *" },
        "user-1",
      );

      expect(schedulerRepo.update).toHaveBeenCalled();
      expect(result.cronExpression).toBe("*/5 * * * *");
    });
  });

  describe("deleteSchedule", () => {
    it("deletes schedule and unregisters repeatable job", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (schedulerRepo.findByWorkflowId as any).mockResolvedValue(mockSchedule);
      (schedulerRepo.delete as any).mockResolvedValue(mockSchedule);

      const result = await service.deleteSchedule("wf-1", "user-1");

      expect(schedulerRepo.delete).toHaveBeenCalledWith("wf-1");
      expect(result.id).toBe("sched-1");
    });

    it("throws NotFoundError when schedule does not exist", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);
      (schedulerRepo.findByWorkflowId as any).mockResolvedValue(null);

      await expect(service.deleteSchedule("wf-1", "user-1")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("Multi-tenant organization authorization", () => {
    const orgWf = {
      id: "wf-org-1",
      userId: "user-creator",
      organizationId: "org-1",
      name: "Org Workflow",
    };

    it("allows active organization member to get schedule without org header", async () => {
      (workflowRepo.findById as any).mockResolvedValue(orgWf);
      (workflowRepo.findOrgMembership as any).mockResolvedValue({ id: "mem-1", role: "MEMBER" });
      (schedulerRepo.findByWorkflowId as any).mockResolvedValue(mockSchedule);

      const result = await service.getSchedule("wf-org-1", "user-member");

      expect(result).toEqual(mockSchedule);
      expect(workflowRepo.findOrgMembership).toHaveBeenCalledWith("org-1", "user-member");
    });

    it("denies access when user was removed from the organization", async () => {
      (workflowRepo.findById as any).mockResolvedValue(orgWf);
      (workflowRepo.findOrgMembership as any).mockResolvedValue(null);

      await expect(service.getSchedule("wf-org-1", "user-removed")).rejects.toThrow(NotFoundError);
    });

    it("rejects personal workflow access when organization header is provided", async () => {
      (workflowRepo.findById as any).mockResolvedValue(mockWf);

      await expect(service.getSchedule("wf-1", "user-1", "org-1")).rejects.toThrow(NotFoundError);
    });
  });
});
