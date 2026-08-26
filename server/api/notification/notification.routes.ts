import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { NotificationRepository } from "./notification.repository";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";

export const createNotificationRouter = (prisma: PrismaClient) => {
  const router = Router();

  const repository = new NotificationRepository(prisma);
  const service = new NotificationService(repository);
  const controller = new NotificationController(service);

  router.get("/", controller.getUserNotifications);
  router.patch("/:id/read", controller.markAsRead);
  router.post("/read-all", controller.markAllAsRead);
  router.delete("/:id", controller.deleteNotification);

  return router;
};
