import { Router } from "express";
import { Orchestrator } from "../orchestrator";
import { PrismaClient } from "@prisma/client";
import { createAuthRouter } from "./auth/auth.routes";
import { createWorkflowRouter } from "./workflow/workflow.routes";
import { createWorkflowRunRouter } from "./run/route.routes";
import { createAgentRouter } from "./agent/agent.routes";
import { createDashboardRouter } from "./dashboard/dashboard.routes";
import { createSchedulerRouter } from "./scheduler/scheduler.routes";
import {
  createWebhookManagementRouter,
  createWebhookPublicRouter,
} from "./webhook/webhook.routes";
import { createOrganizationRouter } from "./organization/organization.routes";
import { createNotificationRouter } from "./notification/notification.routes";
import { createSseHandler } from "./run/run.sse";
import { authenticate } from "../middleware/auth.middleware";
import { createOrgMiddleware } from "../middleware/org.middleware";

export const createApiRoutes = (orchestrator: Orchestrator, prisma: PrismaClient) => {
  const router = Router();
  const orgMiddleware = createOrgMiddleware(prisma);

  const authRouter = createAuthRouter(prisma);
  const workflowRouter = createWorkflowRouter(orchestrator, prisma);
  const workflowRunRouter = createWorkflowRunRouter(prisma);
  const agentRouter = createAgentRouter(prisma);
  const dashboardRouter = createDashboardRouter(prisma);
  const schedulerRouter = createSchedulerRouter(prisma);
  const webhookManagementRouter = createWebhookManagementRouter(prisma, orchestrator);
  const webhookPublicRouter = createWebhookPublicRouter(prisma, orchestrator);
  const organizationRouter = createOrganizationRouter(prisma);
  const notificationRouter = createNotificationRouter(prisma);

  // Auth routes
  router.use("/api/auth", authRouter);

  // Public webhook trigger (unauthenticated, token-protected)
  router.use("/api/webhooks", webhookPublicRouter);

  // Nested workflow routes: scheduler and webhook management
  workflowRouter.use("/:id/schedule", schedulerRouter);
  workflowRouter.use("/:id/webhook", webhookManagementRouter);

  // Server-Sent Events (SSE) stream endpoint for live workflow runs (authenticated & authorized)
  router.get("/api/runs/:runId/stream", createSseHandler(prisma));

  // Protected application routes
  router.use("/api/workflow", authenticate, orgMiddleware, workflowRouter);
  router.use("/api/runs", authenticate, orgMiddleware, workflowRunRouter);
  router.use("/api/agents", authenticate, agentRouter);
  router.use("/api/dashboard", authenticate, orgMiddleware, dashboardRouter);
  router.use("/api/organizations", authenticate, organizationRouter);
  router.use("/api/notifications", authenticate, notificationRouter);

  return router;
};
