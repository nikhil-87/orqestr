import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { WebhookRepository } from "./webhook.repository";
import { WorkflowRepository } from "../workflow/workflow.repository";
import { WebhookService } from "./webhook.service";
import { WebhookController } from "./webhook.controller";
import { Orchestrator } from "../../orchestrator";
import { createRedisRateLimiter } from "../../middleware/rate-limiter.middleware";

export const createWebhookManagementRouter = (
  prisma: PrismaClient,
  orchestrator: Orchestrator,
) => {
  const router = Router({ mergeParams: true });

  const webhookRepo = new WebhookRepository(prisma);
  const workflowRepo = new WorkflowRepository(prisma);
  const service = new WebhookService(webhookRepo, workflowRepo, orchestrator);
  const controller = new WebhookController(service);

  router.get("/", controller.getWebhook);
  router.post("/", controller.createWebhook);
  router.patch("/toggle", controller.toggleWebhook);
  router.post("/regenerate", controller.regenerateToken);
  router.delete("/", controller.deleteWebhook);

  return router;
};

export const createWebhookPublicRouter = (
  prisma: PrismaClient,
  orchestrator: Orchestrator,
) => {
  const router = Router();

  const webhookRepo = new WebhookRepository(prisma);
  const workflowRepo = new WorkflowRepository(prisma);
  const service = new WebhookService(webhookRepo, workflowRepo, orchestrator);
  const controller = new WebhookController(service);

  const webhookLimiter = createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: "rl:webhook:trigger",
    message: "Webhook trigger rate limit exceeded. Please try again later.",
  });

  router.post("/trigger/:token", webhookLimiter, controller.triggerByToken);

  return router;
};
