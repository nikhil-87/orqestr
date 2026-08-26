import { AgentType } from "@prisma/client";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { AgentRepository } from "./agent.repository";
import { cacheService } from "../../cache";
import { CACHE } from "../../config/redis.config";
import { prisma } from "../../config/prisma.config";
import { LLMAgent } from "../../agents/llm.agent";
import { HttpAgent } from "../../agents/http.agent";
import { TransformAgent } from "../../agents/transform.agent";

export class AgentService {
  constructor(private readonly agentRepository: AgentRepository) {}

  async getAllAgents() {
    const cacheKey = CACHE.AGENTS.ALL.KEY();

    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const agents = await this.agentRepository.findAll();

    await cacheService.set(cacheKey, agents, CACHE.AGENTS.ALL.TTL);

    return agents;
  }

  async getAgentById(id: string) {
    if (!id) throw new ValidationError("Agent ID is required");

    const agent = await this.agentRepository.findById(id);

    if (agent === null) throw new NotFoundError("Agent", id);

    return agent;
  }

  async testAgent(type: AgentType, config: unknown, input: unknown) {
    if (!type) {
      throw new ValidationError("Agent type is required for testing");
    }

    const startTime = Date.now();
    try {
      let output: unknown;
      if (type === AgentType.LLM_AGENT) {
        const agent = new LLMAgent("TEST_LLM", 1, prisma);
        output = await agent.execute(input ?? {}, config ?? {});
      } else if (type === AgentType.HTTP_AGENT) {
        const agent = new HttpAgent("TEST_HTTP", 1, prisma);
        output = await agent.execute(input ?? {}, config ?? {});
      } else if (type === AgentType.TRANSFORM_AGENT) {
        const agent = new TransformAgent("TEST_TRANSFORM", 1, prisma);
        output = await agent.execute(input ?? {}, config ?? {});
      } else {
        throw new ValidationError(`Unsupported agent type for testing: ${type}`);
      }

      const durationMs = Date.now() - startTime;
      return {
        success: true,
        output,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: errorMsg,
        durationMs,
      };
    }
  }
}
