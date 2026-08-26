import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { AgentRepository } from "./agent.repository";
import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";
import { createRedisRateLimiter } from "../../middleware/rate-limiter.middleware";

export const createAgentRouter = (prisma: PrismaClient) => {
  const router = Router();

  // wire dependencies
  const repository = new AgentRepository(prisma);
  const service = new AgentService(repository);
  const controller = new AgentController(service);

  const testAgentLimiter = createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 20,
    keyPrefix: "rl:agent:test",
    message: "Agent test execution rate limit exceeded. Please try again later.",
  });

  // mount routes
  router.get("/", controller.getAllAgents);
  router.post("/test", testAgentLimiter, controller.testAgent);
  router.get("/:id", controller.getAgentById);

  return router;
};
