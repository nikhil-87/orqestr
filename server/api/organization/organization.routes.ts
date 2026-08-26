import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { OrganizationRepository } from "./organization.repository";
import { OrganizationService } from "./organization.service";
import { OrganizationController } from "./organization.controller";

export const createOrganizationRouter = (prisma: PrismaClient) => {
  const router = Router();

  const repository = new OrganizationRepository(prisma);
  const service = new OrganizationService(repository, prisma);
  const controller = new OrganizationController(service);

  router.get("/", controller.getUserOrganizations);
  router.post("/", controller.createOrganization);
  router.get("/:id", controller.getOrganizationById);
  router.patch("/:id", controller.updateOrganization);
  router.delete("/:id", controller.deleteOrganization);

  router.post("/:id/members", controller.addMember);
  router.patch("/:id/members/:userId", controller.updateMemberRole);
  router.delete("/:id/members/:userId", controller.removeMember);

  return router;
};
