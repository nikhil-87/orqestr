import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { SchedulerRepository } from "./scheduler.repository";
import { WorkflowRepository } from "../workflow/workflow.repository";
import { SchedulerService } from "./scheduler.service";
import { SchedulerController } from "./scheduler.controller";

export const createSchedulerRouter = (prisma: PrismaClient) => {
  const router = Router({ mergeParams: true });

  const schedulerRepo = new SchedulerRepository(prisma);
  const workflowRepo = new WorkflowRepository(prisma);
  const service = new SchedulerService(schedulerRepo, workflowRepo);
  const controller = new SchedulerController(service);

  router.get("/", controller.getSchedule);
  router.post("/", controller.createSchedule);
  router.put("/", controller.updateSchedule);
  router.delete("/", controller.deleteSchedule);
  router.patch("/toggle", controller.toggleSchedule);

  return router;
};
