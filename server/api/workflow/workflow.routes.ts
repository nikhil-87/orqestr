import { PrismaClient } from "@prisma/client";
import { Orchestrator } from "../../orchestrator";
import { Router } from "express";
import { WorkflowRepository } from "./workflow.repository";
import { WorkflowService } from "./workflow.service";
import { WorkflowController } from "./workflow.controller";
import { SchedulerRepository } from "../scheduler/scheduler.repository";
import { SchedulerService } from "../scheduler/scheduler.service";

export const createWorkflowRouter = (
  orchestrator: Orchestrator,
  prisma: PrismaClient,
  schedulerService?: SchedulerService,
) => {
  const router = Router();

  // wire dependencies
  const repository = new WorkflowRepository(prisma);
  const schedService =
    schedulerService ??
    new SchedulerService(new SchedulerRepository(prisma), repository);
  const service = new WorkflowService(repository, orchestrator, schedService);
  const controller = new WorkflowController(service);

  // mount routes
  router.get("/", controller.getAllWorkflows);
  router.get("/:id", controller.getWorkflowById);
  router.post("/", controller.createWorkflow);
  router.put("/:id", controller.updateWorkflow);
  router.delete("/:id", controller.deleteWorkflow);
  router.post("/:id/run", controller.triggerRun);

  // versioning routes
  router.get("/:id/versions", controller.getWorkflowVersions);
  router.get("/:id/versions/:version", controller.getWorkflowVersion);
  router.post("/:id/versions/:version/restore", controller.restoreWorkflowVersion);

  return router;
};
