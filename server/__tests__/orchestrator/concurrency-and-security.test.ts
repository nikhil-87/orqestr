import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../../orchestrator";
import * as QueueModule from "../../queues";
import * as RunEmitterModule from "../../events/run.emitter";

vi.mock("../../queues", () => ({
  JobQueue: {
    addTaskToQueue: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
    getQueueByAgentType: vi.fn().mockReturnValue({
      getJob: vi.fn().mockResolvedValue({
        id: "mock-job-id",
        data: { taskId: "mock-task-id" },
      }),
    }),
    closeAllQueues: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../events/run.emitter", () => ({
  runEmitter: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

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
      updateMany: vi.fn(),
    },
    agent: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("Orchestrator Concurrency & State Invariant Tests", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma() as any;
    orchestrator = new Orchestrator(prisma as any);
  });

  describe("Parallel branch failure vs completion race", () => {
    it("never overwrites a FAILED workflow run to COMPLETED when a parallel task finishes later", async () => {
      // Setup: Run is already marked FAILED because a critical task failed earlier
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run-parallel",
        status: "FAILED",
        userId: "user-1",
      });

      prisma.task.findUnique.mockResolvedValue({
        id: "task-parallel-ok",
        runId: "run-parallel",
        status: "COMPLETED",
        output: { data: "success" },
        dependsOn: [],
      });

      // Tasks state: one critical step failed, this step completed
      prisma.task.findMany.mockResolvedValue([
        { id: "task-crit-fail", status: "FAILED", critical: true, dependsOn: [] },
        { id: "task-parallel-ok", status: "COMPLETED", critical: false, dependsOn: [] },
      ]);

      const emitSpy = vi.mocked(RunEmitterModule.runEmitter.emit);

      // Parallel non-critical task completes
      await (orchestrator as any).onTaskCompleted("job-2", "LLM_AGENT");

      // Invariant: prisma.workflowRun.updateMany or update MUST NOT mark COMPLETED
      expect(prisma.workflowRun.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );

      // Invariant: RUN_COMPLETED event must NOT be emitted
      const completedEvents = emitSpy.mock.calls.filter(
        (call) => Boolean(call[1] && (call[1] as any).type === "RUN_COMPLETED"),
      );
      expect(completedEvents.length).toBe(0);
    });

    it("marks run as FAILED instead of COMPLETED if any task in allCompleted is critically failed", async () => {
      // Run is still RUNNING in DB when second task completes
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run-1",
        status: "RUNNING",
        userId: "user-1",
      });

      prisma.task.findUnique.mockResolvedValue({
        id: "task-2",
        runId: "run-1",
        status: "COMPLETED",
        output: { done: true },
        dependsOn: [],
      });

      // One task critically failed, one task completed
      prisma.task.findMany.mockResolvedValue([
        { id: "task-1", status: "FAILED", critical: true, dependsOn: [] },
        { id: "task-2", status: "COMPLETED", critical: false, dependsOn: [] },
      ]);

      prisma.workflowRun.updateMany.mockResolvedValue({ count: 1 });

      await (orchestrator as any).onTaskCompleted("job-2", "LLM_AGENT");

      expect(prisma.workflowRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
      expect(prisma.workflowRun.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
    });
  });

  describe("Multi-parent fan-in race condition", () => {
    it("atomically claims task so simultaneous parent completions queue downstream task exactly once", async () => {
      const definition = {
        nodes: [
          { id: "node-a", type: "LLM_AGENT", name: "TaskA", critical: true, config: {} },
          { id: "node-b", type: "LLM_AGENT", name: "TaskB", critical: true, config: {} },
          { id: "node-c", type: "TRANSFORM_AGENT", name: "TaskC", critical: true, config: {} },
        ],
        edges: [
          { id: "e1", source: "node-a", target: "node-c" },
          { id: "e2", source: "node-b", target: "node-c" },
        ],
      };

      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run-fan-in",
        status: "RUNNING",
        workflow: { definition },
      });

      const allTasks = [
        { id: "task-a", nodeId: "node-a", status: "COMPLETED", output: { a: 1 }, dependsOn: [] },
        { id: "task-b", nodeId: "node-b", status: "COMPLETED", output: { b: 2 }, dependsOn: [] },
        { id: "task-c", nodeId: "node-c", type: "TRANSFORM_AGENT", name: "TaskC", status: "PENDING", dependsOn: ["task-a", "task-b"] },
      ];

      prisma.task.findMany.mockResolvedValue(allTasks);

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);

      // Simulate parent A completion: claims task-c successfully (count: 1)
      prisma.task.updateMany.mockResolvedValueOnce({ count: 1 });
      await (orchestrator as any).dispatchUnblockedTasks("run-fan-in", null);

      expect(addTaskSpy).toHaveBeenCalledTimes(1);

      // Simulate parent B completion: task-c is already claimed (count: 0)
      prisma.task.updateMany.mockResolvedValueOnce({ count: 0 });
      await (orchestrator as any).dispatchUnblockedTasks("run-fan-in", null);

      // JobQueue should still have been called only once!
      expect(addTaskSpy).toHaveBeenCalledTimes(1);
    });

    it("rolls back task status to PENDING if JobQueue.addTaskToQueue throws", async () => {
      const definition = {
        nodes: [{ id: "node-1", type: "HTTP_AGENT", name: "Step1", critical: true, config: {} }],
        edges: [],
      };

      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run-fail-queue",
        status: "RUNNING",
        workflow: { definition },
      });

      prisma.task.findMany.mockResolvedValue([
        { id: "task-1", nodeId: "node-1", type: "HTTP_AGENT", name: "Step1", status: "PENDING", dependsOn: [] },
      ]);

      // Atomic claim succeeds
      prisma.task.updateMany.mockResolvedValueOnce({ count: 1 });

      // Queue throws Redis connection error
      vi.mocked(QueueModule.JobQueue.addTaskToQueue).mockRejectedValueOnce(
        new Error("Redis connection dropped"),
      );

      await expect(
        (orchestrator as any).dispatchUnblockedTasks("run-fail-queue", null),
      ).rejects.toThrow("Redis connection dropped");

      // Verify compensation rollback was executed
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1", status: "RUNNING" },
          data: { status: "PENDING", startedAt: null },
        }),
      );
    });
  });

  describe("Cancellation invariants", () => {
    it("does not dispatch unblocked tasks when run status is CANCELLED", async () => {
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run-cancelled",
        status: "CANCELLED",
        workflow: { definition: { nodes: [], edges: [] } },
      });

      prisma.task.findMany.mockResolvedValue([
        { id: "t-1", status: "PENDING", dependsOn: [] },
      ]);

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);
      await (orchestrator as any).dispatchUnblockedTasks("run-cancelled", null);

      expect(addTaskSpy).not.toHaveBeenCalled();
    });

    it("does not dispatch unblocked tasks when run status is FAILED", async () => {
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run-failed",
        status: "FAILED",
        workflow: { definition: { nodes: [], edges: [] } },
      });

      prisma.task.findMany.mockResolvedValue([
        { id: "t-1", status: "PENDING", dependsOn: [] },
      ]);

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);
      await (orchestrator as any).dispatchUnblockedTasks("run-failed", null);

      expect(addTaskSpy).not.toHaveBeenCalled();
    });
  });
});
