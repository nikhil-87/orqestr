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
    $connect: vi.fn(),
    $disconnect: vi.fn(),
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

describe("Orchestrator", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma() as any;
    prisma.workflowRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.task.updateMany.mockResolvedValue({ count: 1 });
    prisma.workflowRun.findUnique.mockResolvedValue({
      id: "run-1",
      status: "RUNNING",
      userId: "user-1",
    });
    orchestrator = new Orchestrator(prisma as any);
  });

  describe("triggerRun", () => {
    const workflowDefinition = {
      id: "wf-1",
      name: "Test Workflow",
      definition: {
        nodes: [
          { id: "node-1", type: "LLM_AGENT", name: "Step 1", critical: true, config: {} },
          {
            id: "node-2",
            type: "HTTP_AGENT",
            name: "Step 2",
            critical: true,
            config: {},
          },
        ],
        edges: [{ id: "edge-1", source: "node-1", target: "node-2" }],
      },
    };

    it("fetches the workflow definition and returns a run", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(workflowDefinition);
      prisma.workflowRun.create.mockResolvedValue({
        id: "run-1",
        workflowId: "wf-1",
        status: "RUNNING",
      });
      prisma.task.create
        .mockResolvedValueOnce({ id: "task-1", nodeId: "node-1" })
        .mockResolvedValueOnce({ id: "task-2", nodeId: "node-2" });
      prisma.task.findMany.mockResolvedValue([]);

      const result = await orchestrator.triggerRun("wf-1", { prompt: "hello" });

      expect(prisma.workflowDefinition.findUnique).toHaveBeenCalledWith({
        where: { id: "wf-1" },
      });
      expect(prisma.workflowRun.create).toHaveBeenCalled();
      expect(result).toHaveProperty("runId");
      expect(result).toHaveProperty("status", "RUNNING");
    });

    it("throws if workflow is not found", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(null);

      await expect(orchestrator.triggerRun("nonexistent", {})).rejects.toThrow(
        "Workflow not found",
      );
    });

    it("dispatches first-wave tasks (nodes with no dependencies)", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue(workflowDefinition);
      prisma.workflowRun.create.mockResolvedValue({
        id: "run-1",
        workflowId: "wf-1",
        status: "RUNNING",
      });
      prisma.task.create
        .mockResolvedValueOnce({ id: "task-1", nodeId: "node-1" })
        .mockResolvedValueOnce({ id: "task-2", nodeId: "node-2" });

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);

      await orchestrator.triggerRun("wf-1", { prompt: "hello" });

      expect(addTaskSpy).toHaveBeenCalledTimes(1);
      expect(addTaskSpy).toHaveBeenCalledWith(
        "LLM_AGENT",
        "Step 1",
        expect.objectContaining({
          taskId: "task-1",
          input: { prompt: "hello" },
        }),
      );
    });
  });

  describe("buildDependencyMap", () => {
    it("resolves dependencies from edges correctly", () => {
      const nodes = [
        { id: "a", type: "LLM_AGENT", name: "A", critical: true, config: {} },
        { id: "b", type: "LLM_AGENT", name: "B", critical: true, config: {} },
        { id: "c", type: "LLM_AGENT", name: "C", critical: true, config: {} },
      ];
      const edges = [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ];

      const map = (orchestrator as any).buildDependencyMap(nodes, edges);

      expect(map.get("a")).toEqual([]);
      expect(map.get("b")).toEqual(["a"]);
      expect(map.get("c")).toEqual(["b"]);
    });

    it("handles nodes with multiple dependencies", () => {
      const nodes = [
        { id: "a", type: "LLM_AGENT", name: "A", critical: true, config: {} },
        { id: "b", type: "LLM_AGENT", name: "B", critical: true, config: {} },
        { id: "c", type: "LLM_AGENT", name: "C", critical: true, config: {} },
      ];
      const edges = [
        { id: "e1", source: "a", target: "c" },
        { id: "e2", source: "b", target: "c" },
      ];

      const map = (orchestrator as any).buildDependencyMap(nodes, edges);

      expect(map.get("a")).toEqual([]);
      expect(map.get("b")).toEqual([]);
      expect(map.get("c")).toEqual(["a", "b"]);
    });

    it("handles nodes with no edges", () => {
      const nodes = [
        { id: "a", type: "LLM_AGENT", name: "A", critical: true, config: {} },
        { id: "b", type: "LLM_AGENT", name: "B", critical: true, config: {} },
      ];
      const edges: { id: string; source: string; target: string }[] = [];

      const map = (orchestrator as any).buildDependencyMap(nodes, edges);

      expect(map.get("a")).toEqual([]);
      expect(map.get("b")).toEqual([]);
    });
  });

  describe("dispatchUnblockedTasks", () => {
    it("does nothing when no unblocked tasks exist", async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: "task-1", status: "PENDING", dependsOn: ["task-0"], critical: true },
      ]);

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);

      await (orchestrator as any).dispatchUnblockedTasks("run-1", {});

      expect(addTaskSpy).not.toHaveBeenCalled();
    });

    it("dispatches tasks whose dependencies are all resolved", async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: "task-1", status: "COMPLETED", dependsOn: [], critical: true },
        {
          id: "task-2",
          status: "PENDING",
          dependsOn: ["task-1"],
          critical: true,
          type: "HTTP_AGENT",
          name: "HTTP Step",
          nodeId: "node-2",
        },
      ]);
      prisma.workflowRun.findUnique.mockResolvedValue({
        workflow: {
          definition: {
            nodes: [
              {
                id: "node-2",
                type: "HTTP_AGENT",
                name: "HTTP Step",
                critical: true,
                config: { url: "http://example.com" },
              },
            ],
          },
        },
      });
      prisma.task.update.mockResolvedValue({});

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);

      await (orchestrator as any).dispatchUnblockedTasks("run-1", { key: "value" });

      expect(addTaskSpy).toHaveBeenCalledWith(
        "HTTP_AGENT",
        "HTTP Step",
        expect.objectContaining({
          taskId: "task-2",
          input: { key: "value" },
        }),
        expect.anything(),
      );
    });

    it("rejects cyclic workflow definitions", async () => {
      const cyclicWorkflow = {
        id: "wf-cyclic",
        name: "Cyclic Workflow",
        definition: {
          nodes: [
            { id: "node-1", type: "LLM_AGENT", name: "Step 1", critical: true, config: {} },
            { id: "node-2", type: "HTTP_AGENT", name: "Step 2", critical: true, config: {} },
          ],
          edges: [
            { id: "edge-1", source: "node-1", target: "node-2" },
            { id: "edge-2", source: "node-2", target: "node-1" },
          ],
        },
      };
      prisma.workflowDefinition.findUnique.mockResolvedValue(cyclicWorkflow);

      await expect(orchestrator.triggerRun("wf-cyclic", {})).rejects.toThrow();
    });

    it("rejects empty workflow definitions with no nodes", async () => {
      const emptyWorkflow = {
        id: "wf-empty",
        name: "Empty Workflow",
        definition: {
          nodes: [],
          edges: [],
        },
      };
      prisma.workflowDefinition.findUnique.mockResolvedValue(emptyWorkflow);

      await expect(orchestrator.triggerRun("wf-empty", {})).rejects.toThrow();
    });
  });

  describe("dispatchUnblockedTasks", () => {
    it("merges outputs from multiple upstream parent tasks (fan-in)", async () => {
      prisma.task.findMany.mockResolvedValue([
        {
          id: "task-a",
          name: "TaskA",
          status: "COMPLETED",
          output: { greeting: "hello" },
          dependsOn: [],
          critical: true,
        },
        {
          id: "task-b",
          name: "TaskB",
          status: "COMPLETED",
          output: { target: "world" },
          dependsOn: [],
          critical: true,
        },
        {
          id: "task-c",
          name: "TaskC",
          status: "PENDING",
          dependsOn: ["task-a", "task-b"],
          critical: true,
          type: "LLM_AGENT",
          nodeId: "node-c",
        },
      ]);

      prisma.workflowRun.findUnique.mockResolvedValue({
        workflow: {
          definition: {
            nodes: [
              { id: "node-c", type: "LLM_AGENT", name: "TaskC", critical: true, config: {} },
            ],
          },
        },
      });
      prisma.task.update.mockResolvedValue({});

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);

      await (orchestrator as any).dispatchUnblockedTasks("run-1", null);

      expect(addTaskSpy).toHaveBeenCalledOnce();
      expect(addTaskSpy).toHaveBeenCalledWith(
        "LLM_AGENT",
        "TaskC",
        expect.objectContaining({
          taskId: "task-c",
          input: expect.objectContaining({
            greeting: "hello",
            target: "world",
            TaskA: { greeting: "hello" },
            TaskB: { target: "world" },
          }),
        }),
        expect.anything(),
      );
    });

    it("treats failed non-critical tasks as resolved", async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: "task-1", status: "FAILED", dependsOn: [], critical: false, name: "Step1", output: { error: "fail" } },
        {
          id: "task-2",
          status: "PENDING",
          dependsOn: ["task-1"],
          critical: true,
          type: "LLM_AGENT",
          name: "LLM Step",
          nodeId: "node-2",
        },
      ]);
      prisma.workflowRun.findUnique.mockResolvedValue({
        workflow: {
          definition: {
            nodes: [
              {
                id: "node-2",
                type: "LLM_AGENT",
                name: "LLM Step",
                critical: true,
                config: {},
              },
            ],
          },
        },
      });
      prisma.task.update.mockResolvedValue({});

      const addTaskSpy = vi.mocked(QueueModule.JobQueue.addTaskToQueue);

      await (orchestrator as any).dispatchUnblockedTasks("run-1", { error: "fail" });

      expect(addTaskSpy).toHaveBeenCalledOnce();
    });
  });

  describe("onTaskCompleted", () => {
    it("marks the run as completed when all tasks are done", async () => {
      const mockQueue = {
        getJob: vi.fn().mockResolvedValue({
          id: "job-1",
          data: { taskId: "task-1" },
        }),
      };
      vi.mocked(QueueModule.JobQueue.getQueueByAgentType).mockReturnValue(
        mockQueue as any,
      );

      prisma.task.findUnique.mockResolvedValue({
        id: "task-1",
        runId: "run-1",
        status: "COMPLETED",
        output: { result: "done" },
        dependsOn: [],
      });
      prisma.task.findMany.mockResolvedValue([{ id: "task-1", status: "COMPLETED", dependsOn: [] }]);

      await (orchestrator as any).onTaskCompleted("job-1", "LLM_AGENT");

      expect(prisma.workflowRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "run-1" }),
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
    });

    it("does not update the run to COMPLETED if the run was CANCELLED", async () => {
      const mockQueue = {
        getJob: vi.fn().mockResolvedValue({
          id: "job-1",
          data: { taskId: "task-1" },
        }),
      };
      vi.mocked(QueueModule.JobQueue.getQueueByAgentType).mockReturnValue(
        mockQueue as any,
      );

      prisma.task.findUnique.mockResolvedValue({
        id: "task-1",
        runId: "run-1",
        status: "COMPLETED",
        output: { result: "done" },
        dependsOn: [],
      });
      prisma.task.findMany.mockResolvedValue([{ id: "task-1", status: "COMPLETED", dependsOn: [] }]);
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run-1",
        status: "CANCELLED",
        userId: "user-1",
      });

      await (orchestrator as any).onTaskCompleted("job-1", "LLM_AGENT");

      expect(prisma.workflowRun.update).not.toHaveBeenCalled();
    });

    it("does not complete the run if some tasks are still pending", async () => {
      const mockQueue = {
        getJob: vi.fn().mockResolvedValue({
          id: "job-1",
          data: { taskId: "task-1" },
        }),
      };
      vi.mocked(QueueModule.JobQueue.getQueueByAgentType).mockReturnValue(
        mockQueue as any,
      );

      prisma.task.findUnique.mockResolvedValue({
        id: "task-1",
        runId: "run-1",
        status: "COMPLETED",
        output: { result: "done" },
        dependsOn: [],
        critical: true,
        type: "LLM_AGENT",
        name: "Step 1",
        nodeId: "node-1",
      });
      prisma.task.findMany.mockResolvedValue([
        { id: "task-1", status: "COMPLETED", dependsOn: [], critical: true },
        { id: "task-2", status: "PENDING", dependsOn: [], critical: true },
      ]);

      await (orchestrator as any).onTaskCompleted("job-1", "LLM_AGENT");

      expect(prisma.workflowRun.update).not.toHaveBeenCalled();
    });
  });

  describe("onTaskFailed", () => {
    it("does not fail run if retries remain for the job", async () => {
      const mockQueue = {
        getJob: vi.fn().mockResolvedValue({
          id: "job-1",
          attemptsMade: 1,
          opts: { attempts: 3 },
          data: { taskId: "task-1" },
        }),
      };
      vi.mocked(QueueModule.JobQueue.getQueueByAgentType).mockReturnValue(
        mockQueue as any,
      );

      prisma.task.findUnique.mockResolvedValue({
        id: "task-1",
        runId: "run-1",
        name: "Critical Step",
        critical: true,
      });

      await (orchestrator as any).onTaskFailed("job-1", "Temporary glitch", "LLM_AGENT");

      expect(prisma.workflowRun.update).not.toHaveBeenCalled();
    });

    it("fails the entire run when a critical task fails all attempts", async () => {
      const mockQueue = {
        getJob: vi.fn().mockResolvedValue({
          id: "job-1",
          attemptsMade: 3,
          opts: { attempts: 3 },
          data: { taskId: "task-1" },
        }),
      };
      vi.mocked(QueueModule.JobQueue.getQueueByAgentType).mockReturnValue(
        mockQueue as any,
      );

      prisma.task.findUnique.mockResolvedValue({
        id: "task-1",
        runId: "run-1",
        name: "Critical Step",
        critical: true,
      });

      await (orchestrator as any).onTaskFailed("job-1", "Something broke", "LLM_AGENT");

      expect(prisma.workflowRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "run-1" },
          data: expect.objectContaining({ status: "FAILED", error: "Something broke" }),
        }),
      );
      expect(prisma.task.updateMany).toHaveBeenCalled();
    });

    it("continues the run when a non-critical task fails all attempts", async () => {
      const mockQueue = {
        getJob: vi.fn().mockResolvedValue({
          id: "job-1",
          attemptsMade: 3,
          opts: { attempts: 3 },
          data: { taskId: "task-1" },
        }),
      };
      vi.mocked(QueueModule.JobQueue.getQueueByAgentType).mockReturnValue(
        mockQueue as any,
      );

      prisma.task.findUnique.mockResolvedValue({
        id: "task-1",
        runId: "run-1",
        name: "Non-critical Step",
        critical: false,
      });
      prisma.task.findMany.mockResolvedValue([
        { id: "task-1", status: "FAILED", dependsOn: [] },
        { id: "task-2", status: "COMPLETED", dependsOn: [] },
      ]);

      const emitSpy = vi.mocked(RunEmitterModule.runEmitter.emit);

      await (orchestrator as any).onTaskFailed("job-1", "Minor issue", "LLM_AGENT");

      expect(emitSpy).toHaveBeenCalledWith(
        "run:run-1",
        expect.objectContaining({ status: "FAILED" }),
      );
      expect(prisma.workflowRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "run-1" }),
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
    });
  });
});
