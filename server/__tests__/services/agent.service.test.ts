import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentService } from "../../api/agent/agent.service";
import { NotFoundError, ValidationError } from "../../utils/errors";

function createMockAgentRepository() {
  return {
    findAll: vi.fn(),
    findById: vi.fn(),
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

describe("AgentService", () => {
  let repo: ReturnType<typeof createMockAgentRepository>;
  let service: AgentService;

  beforeEach(() => {
    repo = createMockAgentRepository();
    service = new AgentService(repo as any);
  });

  describe("getAllAgents", () => {
    it("returns all agents", async () => {
      const agents = [{ id: "agent-1", name: "LLM_AGENT_1", type: "LLM_AGENT" }];
      repo.findAll.mockResolvedValue(agents);

      const result = await service.getAllAgents();

      expect(repo.findAll).toHaveBeenCalled();
      expect(result).toEqual(agents);
    });
  });

  describe("getAgentById", () => {
    it("returns the agent when it exists", async () => {
      const agent = { id: "agent-1", name: "LLM_AGENT_1" };
      repo.findById.mockResolvedValue(agent);

      const result = await service.getAgentById("agent-1");

      expect(repo.findById).toHaveBeenCalledWith("agent-1");
      expect(result).toEqual(agent);
    });

    it("throws ValidationError when id is empty", async () => {
      await expect(service.getAgentById("")).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when agent does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getAgentById("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("testAgent", () => {
    it("executes LLM_AGENT successfully with mock input and config", async () => {
      const result = await service.testAgent(
        "LLM_AGENT" as any,
        { promptTemplate: "Hello {{name}}" },
        { name: "World" },
      );

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.output).toBeDefined();
    });

    it("returns error result when LLM config is missing promptTemplate", async () => {
      const result = await service.testAgent("LLM_AGENT" as any, {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("requires a promptTemplate");
    });

    it("throws ValidationError when agent type is missing", async () => {
      await expect(
        service.testAgent(undefined as any, {}, {}),
      ).rejects.toThrow(ValidationError);
    });

    it("returns error result when agent type is unsupported", async () => {
      const result = await service.testAgent("INVALID_TYPE" as any, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported agent type");
    });
  });
});
